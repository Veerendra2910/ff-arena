import os
import json
import time
import hashlib
import secrets
import http.server
import socketserver
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get('PORT', 8080))
APP_SECRET = 'ff_arena_internal_2026'
DATA_FILE = os.path.join(os.path.dirname(__file__), 'data.json')
CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'email_config.json')

# In-memory stores for rate limiting and server-side OTPs
SERVER_OTPS = {}       # { email: { "otp": str, "expires": float, "attempts": int } }
RATE_LIMITS = {}       # { f"{ip}:{endpoint}": [timestamp, ...] }
ACTIVE_SESSIONS = {}   # { token: { "userId": str, "expires": float } }

def hash_password(password, salt=None):
    if not salt:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode('utf-8')).hexdigest()
    return hashed, salt

def verify_password(password, stored_hash, salt):
    if not stored_hash or not salt:
        return False
    check_hash = hashlib.sha256((salt + password).encode('utf-8')).hexdigest()
    return secrets.compare_digest(check_hash, stored_hash)

def check_rate_limit(ip, endpoint, max_requests=10, window_secs=60):
    now = time.time()
    key = f"{ip}:{endpoint}"
    if key not in RATE_LIMITS:
        RATE_LIMITS[key] = []
    RATE_LIMITS[key] = [t for t in RATE_LIMITS[key] if now - t < window_secs]
    if len(RATE_LIMITS[key]) >= max_requests:
        return False
    RATE_LIMITS[key].append(now)
    return True

def get_email_credentials():
    gmail_user = os.environ.get('GMAIL_USER', '')
    gmail_pass = os.environ.get('GMAIL_APP_PASSWORD', '')

    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                if not gmail_user:
                    gmail_user = cfg.get('gmail_user', '')
                if not gmail_pass:
                    gmail_pass = cfg.get('gmail_app_password', '')
        except Exception as e:
            print(f"Error reading email_config.json: {e}")

    return gmail_user, gmail_pass

def send_real_email_otp(to_email, otp, subject='FF Arena - Account Verification Code'):
    gmail_user, gmail_pass = get_email_credentials()
    
    if not gmail_user or not gmail_pass or 'YOUR_GMAIL' in gmail_user or 'YOUR_GMAIL' in gmail_pass:
        print(f"\n[GMAIL SMTP INFO] Real Gmail credentials not set in email_config.json.")
        print(f"[SECURE SERVER OTP LOG] Generated for: {to_email} | Code: {otp}\n")
        return False, "Gmail credentials not configured. Check server terminal for OTP."

    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = f"FF Arena <{gmail_user}>"
        msg['To'] = to_email

        text = f"Welcome to FF Arena!\n\nYour 6-digit verification code is: {otp}\n\nThis code expires in 10 minutes."
        html = f"""
        <div style="font-family:'Segoe UI',Arial,sans-serif;background:#0b0e14;color:#e2e8f0;padding:32px;border-radius:12px;max-width:500px;margin:0 auto;border:1px solid #1e293b">
          <div style="text-align:center;margin-bottom:24px">
            <h1 style="color:#00d4ff;margin:0;font-size:28px;letter-spacing:2px">FF ARENA</h1>
            <p style="color:#94a3b8;font-size:12px;margin-top:4px">SECURITY VERIFICATION</p>
          </div>
          <p style="font-size:15px;color:#cbd5e1;line-height:1.5">Use the 6-digit verification code below to verify your identity:</p>
          <div style="background:linear-gradient(135deg, rgba(0,212,255,0.1), rgba(168,85,247,0.1));border:2px solid #00d4ff;padding:20px;text-align:center;border-radius:10px;font-size:36px;font-weight:bold;letter-spacing:8px;color:#ffd700;margin:24px 0;box-shadow:0 0 20px rgba(0,212,255,0.2)">
            {otp}
          </div>
          <p style="font-size:12px;color:#64748b;text-align:center;margin-top:20px">This code is valid for 10 minutes. If you did not request this code, please ignore this email.</p>
        </div>
        """

        msg.attach(MIMEText(text, 'plain'))
        msg.attach(MIMEText(html, 'html'))

        server = smtplib.SMTP('smtp.gmail.com', 587, timeout=10)
        server.starttls()
        server.login(gmail_user, gmail_pass)
        server.sendmail(gmail_user, to_email, msg.as_string())
        server.quit()
        print(f"\n[GMAIL SUCCESS] Verification code sent to {to_email}\n")
        return True, "Email sent successfully"
    except Exception as e:
        print(f"\n[GMAIL ERROR] Failed to send email to {to_email}: {e}\n")
        return False, str(e)

def send_rejection_email(to_email, username, display_name, reason):
    gmail_user, gmail_pass = get_email_credentials()
    
    if not to_email:
        return False, "No email address found for this player."

    if not gmail_user or not gmail_pass or 'YOUR_GMAIL' in gmail_user or 'YOUR_GMAIL' in gmail_pass:
        print(f"\n[GMAIL SMTP INFO] Real Gmail credentials not configured in email_config.json.")
        print(f"[REJECTION NOTICE LOG] Player: @{username} ({display_name}) | Email: {to_email}\n[REASON GIVEN BY ADMIN]: {reason}\n")
        return False, "Gmail credentials not configured. Rejection logged to server."

    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = 'FF Arena — Player Registration Status'
        msg['From'] = f"FF Arena Support <{gmail_user}>"
        msg['To'] = to_email

        text = f"Hello {display_name or username},\n\nYour player registration for FF Arena was reviewed.\n\nStatus: NOT APPROVED\nReason: {reason}\n\nYou may sign up again with updated information.\n\nBest regards,\nFF Arena Management"
        html = f"""
        <div style="font-family:'Segoe UI',Arial,sans-serif;background:#0b0e14;color:#e2e8f0;padding:32px;border-radius:12px;max-width:500px;margin:0 auto;border:1px solid #1e293b">
          <div style="text-align:center;margin-bottom:24px">
            <h1 style="color:#ff2e3f;margin:0;font-size:28px;letter-spacing:2px">FF ARENA</h1>
            <p style="color:#94a3b8;font-size:12px;margin-top:4px">REGISTRATION STATUS UPDATE</p>
          </div>
          <p style="font-size:15px;color:#cbd5e1;line-height:1.5">Hello <strong>{display_name or username}</strong> (@{username}),</p>
          <p style="font-size:14px;color:#94a3b8;line-height:1.5">Your registration request for the FF Arena platform was reviewed by administration. Unfortunately, your request could not be approved at this time.</p>
          
          <div style="background:rgba(255,46,63,0.1);border-left:4px solid #ff2e3f;padding:16px;border-radius:6px;margin:20px 0">
            <div style="font-size:12px;font-weight:bold;color:#ff2e3f;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Reason / Admin Note:</div>
            <div style="font-size:14px;color:#f1f5f9;line-height:1.4">{reason}</div>
          </div>

          <p style="font-size:13px;color:#94a3b8;line-height:1.5">You are welcome to register again with accurate details or reach out to administration if you believe this was in error.</p>
          <p style="font-size:12px;color:#64748b;text-align:center;margin-top:24px;border-top:1px solid #1e293b;padding-top:16px">FF Arena Tournament Management</p>
        </div>
        """

        msg.attach(MIMEText(text, 'plain'))
        msg.attach(MIMEText(html, 'html'))

        server = smtplib.SMTP('smtp.gmail.com', 587, timeout=10)
        server.starttls()
        server.login(gmail_user, gmail_pass)
        server.sendmail(gmail_user, to_email, msg.as_string())
        server.quit()
        print(f"\n[GMAIL SUCCESS] Rejection notification email dispatched to {to_email}\n")
        return True, "Email sent successfully"
    except Exception as e:
        print(f"\n[GMAIL ERROR] Failed to send rejection email to {to_email}: {e}\n")
        return False, str(e)

def migrate_and_hash_users(data):
    """Ensure all users have salted password hashes and no plaintext passwords exist in data."""
    changed = False
    for user in data.get('users', []):
        # Remove legacy fields
        user.pop('prizeWon', None)
        
        # If user has plaintext password and no passwordHash, migrate it
        if 'password' in user and 'passwordHash' not in user:
            pw = str(user.pop('password'))
            pw_hash, salt = hash_password(pw)
            user['passwordHash'] = pw_hash
            user['salt'] = salt
            changed = True
        elif 'password' in user:
            user.pop('password', None)
            changed = True

    # Remove prize fields from tournaments
    for t in data.get('tournaments', []):
        t.pop('prizePool', None)
        t.pop('entryFee', None)
        t.pop('prizeDistribution', None)

    return changed

def load_data():
    now = int(time.time() * 1000)
    default_pw_hash, default_salt = hash_password("admin123")
    default_state = {
        "users": [
            {
                "id": "u1", "username": "admin",
                "passwordHash": default_pw_hash, "salt": default_salt,
                "displayName": "Admin", "role": "admin", "status": "active",
                "playerId": "FF-2026-000", "createdAt": now, "lastLogin": now,
                "totalKills": 0, "totalAssists": 0, "totalDamage": 0,
                "bestKills": 0, "totalHeadshots": 0, "top3": 0, "wins": 0
            }
        ],
        "tournaments": [],
        "teams": [],
        "matchRooms": [],
        "matches": [],
        "leaderboard": [],
        "payments": [],
        "notifications": [],
        "chats": {"global": [], "room": [], "tourney": []},
        "_initialized": True,
        "_version": 2
    }

    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if migrate_and_hash_users(data):
                    save_data(data)
                return data
        except Exception as e:
            print(f"Error loading {DATA_FILE}: {e}")
    
    save_data(default_state)
    return default_state

def save_data(data):
    try:
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Error saving {DATA_FILE}: {e}")

def sanitize_user_for_client(u):
    """Return safe public user profile with zero credential/hash exposure."""
    safe = dict(u)
    safe.pop('password', None)
    safe.pop('passwordHash', None)
    safe.pop('salt', None)
    return safe

def get_sanitized_state():
    """Return full state where users list is strictly stripped of passwords/hashes."""
    raw = ArenaHandler.server_data
    safe = dict(raw)
    safe['users'] = [sanitize_user_for_client(u) for u in raw.get('users', [])]
    return safe


class ArenaHandler(http.server.SimpleHTTPRequestHandler):
    server_data = load_data()
    active_users = {}   # { userId: timestamp }
    live_streams = {}   # { roomId: { userId: { name, frame, ts } } }

    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-App-Token, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-App-Token, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def do_GET(self):
        client_ip = self.client_address[0]

        if self.path.startswith('/api/state'):
            query = parse_qs(urlparse(self.path).query)
            user_id = query.get('userId', [''])[0]
            now = time.time()
            if user_id:
                ArenaHandler.active_users[user_id] = now
            
            # Remove users inactive for > 15 seconds
            expired = [u for u, ts in ArenaHandler.active_users.items() if now - ts > 15]
            for u in expired:
                del ArenaHandler.active_users[u]

            response_data = get_sanitized_state()
            response_data['_online_users'] = list(ArenaHandler.active_users.keys())
            response_data['_online_count'] = max(1, len(ArenaHandler.active_users))

            self._send_json(200, response_data)
            return

        if self.path.startswith('/api/stream'):
            query = parse_qs(urlparse(self.path).query)
            room_id = query.get('roomId', [''])[0]

            now = time.time()
            active_list = []
            if room_id in ArenaHandler.live_streams:
                room_streams = ArenaHandler.live_streams[room_id]
                expired_users = [uid for uid, info in room_streams.items() if now - info['ts'] > 6]
                for uid in expired_users:
                    del room_streams[uid]
                
                for uid, info in room_streams.items():
                    active_list.append({
                        "userId": uid,
                        "name": info.get('name', 'Player'),
                        "frame": info.get('frame', ''),
                        "ts": info.get('ts', 0)
                    })

            self._send_json(200, active_list)
            return
        
        # Security: Prevent static file disclosure of sensitive files (.json, .py, .txt, .log, .env, hidden files)
        clean_path = urlparse(self.path).path.lstrip('/')
        if clean_path:
            lower = clean_path.lower()
            blocked_extensions = ('.json', '.py', '.txt', '.log', '.env', '.yaml', '.yml', '.ini', '.cfg', '.sh', '.bat')
            if any(lower.endswith(ext) for ext in blocked_extensions) or lower.startswith('.') or '..' in lower:
                self._send_json(403, {"error": "Access forbidden"})
                return

        # Default static file serving for safe files (html, css, js, images, fonts)
        return super().do_GET()

    def do_POST(self):
        client_ip = self.client_address[0]
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        
        try:
            payload = json.loads(post_data.decode('utf-8')) if post_data else {}
        except Exception:
            payload = {}

        # ── 1. SEND OTP (Server Generated & Verified) ──
        if self.path == '/api/send-otp' or self.path == '/api/send-email':
            if not check_rate_limit(client_ip, 'send_otp', max_requests=5, window_secs=60):
                self._send_json(429, {"status": "error", "message": "Too many requests. Please wait a minute before requesting another code."})
                return

            email = payload.get('email', '').strip().lower()
            purpose = payload.get('purpose', 'Account Verification')
            if not email or '@' not in email or '.' not in email:
                self._send_json(400, {"status": "error", "message": "Invalid email address."})
                return

            # Cryptographically secure random 6-digit OTP generated ON SERVER
            otp = f"{secrets.randbelow(900000) + 100000}"
            SERVER_OTPS[email] = {
                "otp": otp,
                "expires": time.time() + 600,  # 10 minutes
                "attempts": 0
            }

            subject = f"FF Arena - {purpose} Code"
            success, msg = send_real_email_otp(email, otp, subject)
            self._send_json(200, {
                "status": "ok",
                "sent_real_email": success,
                "message": msg,
                "email": email
            })
            return

        # ── 2. AUTH: LOGIN ──
        if self.path == '/api/auth/login':
            if not check_rate_limit(client_ip, 'auth_login', max_requests=12, window_secs=60):
                self._send_json(429, {"status": "error", "message": "Too many login attempts. Please try again in 1 minute."})
                return

            username = payload.get('username', '').strip().lower()
            password = payload.get('password', '')

            if not username or not password:
                self._send_json(400, {"status": "error", "message": "Username and password required."})
                return

            users = ArenaHandler.server_data.get('users', [])
            target = next((u for u in users if u.get('username', '').strip().lower() == username), None)

            if not target:
                self._send_json(401, {"status": "error", "message": "Invalid username or password."})
                return

            if target.get('status') == 'banned':
                self._send_json(403, {"status": "banned", "message": "Account is banned. Contact admin."})
                return

            # Verify password hash
            stored_hash = target.get('passwordHash')
            salt = target.get('salt')

            # Fallback legacy check
            valid = False
            if stored_hash and salt:
                valid = verify_password(password, stored_hash, salt)
            elif 'password' in target and target['password'] == password:
                # Migrate to hash
                pw_hash, new_salt = hash_password(password)
                target['passwordHash'] = pw_hash
                target['salt'] = new_salt
                target.pop('password', None)
                save_data(ArenaHandler.server_data)
                valid = True

            if not valid:
                self._send_json(401, {"status": "error", "message": "Invalid username or password."})
                return

            if target.get('status') == 'pending':
                self._send_json(200, {"status": "pending", "message": "Account pending approval.", "user": sanitize_user_for_client(target)})
                return

            target['lastLogin'] = int(time.time() * 1000)
            save_data(ArenaHandler.server_data)

            # Issue session token
            token = secrets.token_hex(24)
            ACTIVE_SESSIONS[token] = {"userId": target['id'], "expires": time.time() + 86400 * 7}

            self._send_json(200, {
                "status": "ok",
                "token": token,
                "user": sanitize_user_for_client(target)
            })
            return

        # ── 3. AUTH: SIGNUP ──
        if self.path == '/api/auth/signup':
            if not check_rate_limit(client_ip, 'auth_signup', max_requests=8, window_secs=60):
                self._send_json(429, {"status": "error", "message": "Too many requests. Please wait."})
                return

            username = payload.get('username', '').strip().lower()
            email = payload.get('email', '').strip().lower()
            otp = payload.get('otp', '').strip()
            displayName = payload.get('displayName', '').strip()
            playerId = payload.get('playerId', '').strip()
            password = payload.get('password', '')

            if not username or not email or not otp or not displayName or not password:
                self._send_json(400, {"status": "error", "message": "All fields are required."})
                return

            # Verify OTP on server
            otp_record = SERVER_OTPS.get(email)
            if not otp_record:
                self._send_json(400, {"status": "error", "message": "No verification code requested for this email."})
                return

            if time.time() > otp_record['expires']:
                SERVER_OTPS.pop(email, None)
                self._send_json(400, {"status": "error", "message": "Verification code has expired. Please request a new one."})
                return

            if otp_record['attempts'] >= 5:
                SERVER_OTPS.pop(email, None)
                self._send_json(400, {"status": "error", "message": "Too many incorrect attempts. Please request a new code."})
                return

            if otp_record['otp'] != otp:
                otp_record['attempts'] += 1
                self._send_json(400, {"status": "error", "message": "Invalid verification code."})
                return

            # OTP is valid! Consume it
            SERVER_OTPS.pop(email, None)

            # Check uniqueness
            users = ArenaHandler.server_data.get('users', [])
            if any(u.get('username', '').strip().lower() == username for u in users):
                self._send_json(400, {"status": "error", "message": f"Username '{username}' is already taken."})
                return

            if any(u.get('displayName', '').strip().lower() == displayName.lower() for u in users):
                self._send_json(400, {"status": "error", "message": f"Display Name '{displayName}' is already taken."})
                return

            pw_hash, salt = hash_password(password)
            now = int(time.time() * 1000)
            new_user = {
                "id": f"id_{secrets.token_hex(4)}",
                "username": username,
                "email": email,
                "passwordHash": pw_hash,
                "salt": salt,
                "displayName": displayName,
                "role": "player",
                "status": "pending",
                "playerId": playerId or f"FF-2026-{secrets.randbelow(900) + 100}",
                "createdAt": now,
                "lastLogin": now,
                "totalKills": 0, "totalAssists": 0, "totalDamage": 0,
                "bestKills": 0, "totalHeadshots": 0, "top3": 0, "wins": 0
            }

            users.append(new_user)
            save_data(ArenaHandler.server_data)

            self._send_json(200, {
                "status": "ok",
                "message": "Account created successfully",
                "user": sanitize_user_for_client(new_user)
            })
            return

        # ── 4. AUTH: RESET PASSWORD ──
        if self.path == '/api/auth/reset-password':
            if not check_rate_limit(client_ip, 'auth_reset', max_requests=6, window_secs=60):
                self._send_json(429, {"status": "error", "message": "Too many requests."})
                return

            email = payload.get('email', '').strip().lower()
            otp = payload.get('otp', '').strip()
            new_password = payload.get('newPassword', '')

            if not email or not otp or not new_password:
                self._send_json(400, {"status": "error", "message": "Email, verification code, and new password required."})
                return

            otp_record = SERVER_OTPS.get(email)
            if not otp_record or otp_record['otp'] != otp or time.time() > otp_record['expires']:
                self._send_json(400, {"status": "error", "message": "Invalid or expired verification code."})
                return

            SERVER_OTPS.pop(email, None)

            users = ArenaHandler.server_data.get('users', [])
            target = next((u for u in users if u.get('email', '').strip().lower() == email or u.get('username', '').strip().lower() == email), None)

            if not target:
                self._send_json(404, {"status": "error", "message": "User account not found."})
                return

            pw_hash, salt = hash_password(new_password)
            target['passwordHash'] = pw_hash
            target['salt'] = salt
            target.pop('password', None)
            save_data(ArenaHandler.server_data)

            self._send_json(200, {"status": "ok", "message": "Password reset successfully."})
            return

        # ── 5. STATE SYNCHRONIZATION (Protected) ──
        if self.path.startswith('/api/state'):
            token = self.headers.get('X-App-Token', '')
            if token != APP_SECRET:
                self._send_json(403, {'error': 'Unauthorized state write'})
                return

            try:
                new_state = payload
                new_state.pop('_online_users', None)
                new_state.pop('_online_count', None)

                # Preserve credentials from current server users
                existing_users_map = {u['id']: u for u in ArenaHandler.server_data.get('users', [])}
                if 'users' in new_state:
                    for u in new_state['users']:
                        uid = u.get('id')
                        if 'password' in u and u['password']:
                            # Password update requested -> hash with fresh salt
                            pw_hash, salt = hash_password(str(u.pop('password')))
                            u['passwordHash'] = pw_hash
                            u['salt'] = salt
                        elif uid in existing_users_map:
                            # Preserve server-side passwordHash and salt
                            if 'passwordHash' in existing_users_map[uid]:
                                u['passwordHash'] = existing_users_map[uid]['passwordHash']
                            if 'salt' in existing_users_map[uid]:
                                u['salt'] = existing_users_map[uid]['salt']
                        u.pop('password', None)

                ArenaHandler.server_data = new_state
                save_data(new_state)
                self._send_json(200, {"status": "ok"})
            except Exception as e:
                self._send_json(400, {"error": str(e)})
            return

        # ── 6. REJECT USER & SEND EMAIL NOTIFICATION ──
        if self.path == '/api/reject-user':
            user_id = payload.get('userId')
            reason = payload.get('reason', '').strip()
            
            if not user_id or not reason:
                self._send_json(400, {"status": "error", "message": "User ID and reason required."})
                return

            users = ArenaHandler.server_data.get('users', [])
            target = next((u for u in users if u.get('id') == user_id), None)

            if not target:
                self._send_json(404, {"status": "error", "message": "Player account not found."})
                return

            target_email = target.get('email', '')
            username = target.get('username', '')
            display_name = target.get('displayName', '')

            # Send rejection email notification
            email_sent, email_msg = send_rejection_email(target_email, username, display_name, reason)

            # Remove player from users roster
            ArenaHandler.server_data['users'] = [u for u in users if u.get('id') != user_id]
            save_data(ArenaHandler.server_data)

            self._send_json(200, {
                "status": "ok",
                "message": f"Player @{username} rejected and notified.",
                "emailSent": email_sent,
                "emailMsg": email_msg,
                "email": target_email
            })
            return

        # ── 7. STREAMING FRAMES ──
        if self.path == '/api/stream':
            room_id = payload.get('roomId')
            user_id = payload.get('userId')
            name    = payload.get('name', 'Player')
            frame   = payload.get('frame', '')

            if room_id and user_id:
                if room_id not in ArenaHandler.live_streams:
                    ArenaHandler.live_streams[room_id] = {}
                ArenaHandler.live_streams[room_id][user_id] = {
                    "name": name,
                    "frame": frame,
                    "ts": time.time()
                }

            self._send_json(200, {"status": "ok"})
            return

        self._send_json(404, {"error": "Endpoint not found"})


if __name__ == '__main__':
    handler = ArenaHandler
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), handler) as httpd:
        print(f"FF Arena Hardened Backend Server running on http://0.0.0.0:{PORT}")
        httpd.serve_forever()
