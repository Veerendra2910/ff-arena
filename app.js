/* =============================================================
   FF ARENA — COMPLETE APP LOGIC
   Free Fire Tournament Management Platform
   ============================================================= */

'use strict';

/* ─── 1. CONSTANTS ────────────────────────────────────────── */
const STORAGE_KEY   = 'ff_arena_data_v2';
const SESSION_KEY   = 'ff_arena_session';
const SESSION_TTL   = 30 * 60 * 1000; // 30 minutes
const MAPS          = ['Bermuda', 'Kalahari', 'Purgatory', 'Alpine'];
const GAME_MODES    = ['Squad', 'Duo', 'Solo'];
const MAX_PLAYERS   = [4, 8, 12, 16];

const PLACEMENT_PTS = { 1:12, 2:9, 3:7, 4:5, 5:3, 6:2, 7:1 };

// Prize pool removed — no payment gateway in this version

const ACHIEVEMENTS = [
  { id: 'a1', icon:'🔫', name:'First Blood',  desc:'Get 1 kill in a match',     cond: p => p.totalKills >= 1 },
  { id: 'a2', icon:'💀', name:'Killing Spree',desc:'Get 5+ kills in a match',    cond: p => p.bestKills >= 5 },
  { id: 'a3', icon:'🏆', name:'Champion',     desc:'Win a tournament',            cond: p => p.wins >= 1 },
  { id: 'a4', icon:'⚡', name:'Unstoppable', desc:'Get 10+ kills in a match',    cond: p => p.bestKills >= 10 },
  { id: 'a5', icon:'🎯', name:'Headhunter',   desc:'100+ headshots total',        cond: p => p.totalHeadshots >= 100 },
  { id: 'a6', icon:'🤝', name:'Team Player',  desc:'20+ assists total',           cond: p => p.totalAssists >= 20 },
  { id: 'a7', icon:'🛡️', name:'Survivor',    desc:'Survive 3 matches to top 3', cond: p => p.top3 >= 3 },
];

/* ─── 2. SEED DATA ───────────────────────────────────────── */
function buildSeedData() {
  const now = Date.now();

  const users = [
    {
      id: 'u1', username: 'admin', password: 'admin123',
      displayName: 'Admin', role: 'admin', status: 'active',
      playerId: 'FF-2026-000', createdAt: now, lastLogin: now,
      totalKills: 0, totalAssists: 0, totalDamage: 0,
      bestKills: 0, totalHeadshots: 0, top3: 0, wins: 0
    }
  ];

  return {
    users,
    tournaments:   [],
    teams:         [],
    matchRooms:    [],
    matches:       [],
    leaderboard:   [],
    payments:      [],
    notifications: [],
    _initialized: true,
    _createdAt: now
  };
}

/* ─── 3. STORAGE & SERVER SYNC ────────────────────────────── */
const Store = {
  data: null,
  isSyncing: false,
  _lastDataStr: '',
  _syncTimer: null,

  async init() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { this.data = JSON.parse(raw); } catch(e) { this.data = null; }
    }
    if (!this.data || !this.data._initialized) {
      this.data = buildSeedData();
    }
    this._lastDataStr = JSON.stringify(this.data);
    await this.fetchServerState();
    this.startAutoSync();
  },

  async fetchServerState() {
    try {
      const uid = Auth.current ? Auth.current.id : '';
      const t0 = performance.now();
      const res = await fetch(`/api/state?userId=${encodeURIComponent(uid)}`);
      if (res.ok) {
        const ping = Math.max(1, Math.round(performance.now() - t0));
        this.updateServerOnlineStatus(true, ping);

        const serverData = await res.json();
        
        const onlineCount = serverData._online_count || 1;
        this.updateOnlineCount(onlineCount);
        delete serverData._online_users;
        delete serverData._online_count;

        const serverStr = JSON.stringify(serverData);
        if (serverStr !== this._lastDataStr) {
          const isInitialLoad = (this._lastDataStr === '');
          this.data = serverData;
          this._lastDataStr = serverStr;
          localStorage.setItem(STORAGE_KEY, serverStr);
          
          // Re-sync active session user
          if (Auth.current) {
            const freshUser = (this.data.users || []).find(u => u.id === Auth.current.id);
            if (freshUser) Auth.current = freshUser;
          }

          // Process Continuous Live Notifications
          const allNotifs = serverData.notifications || [];
          if (allNotifs.length > 0) {
            const latest = allNotifs[allNotifs.length - 1];
            if (window._lastSeenNotifId && latest.id !== window._lastSeenNotifId) {
              const lastIdx = allNotifs.findIndex(n => n.id === window._lastSeenNotifId);
              const newNotifs = lastIdx !== -1 ? allNotifs.slice(lastIdx + 1) : [latest];
              newNotifs.forEach(n => {
                if (n.userId === 'all' || (Auth.current && n.userId === Auth.current.id)) {
                  const type = n.type && Toast[n.type] ? n.type : 'info';
                  Toast[type](`🔔 ${n.message}`);
                }
              });
            }
            window._lastSeenNotifId = latest.id;
          }

          // Trigger UI updates if app is already active
          if (!isInitialLoad) {
            if (window.Router && Router.current && window.Pages && Pages[Router.current]) {
              Pages[Router.current]();
            }
            if (window.Chat && Chat.renderMessages && Chat.isOpen) {
              Chat.renderMessages();
            }
            if (typeof updateNotifBadge === 'function') {
              updateNotifBadge();
            }
            // Continuous Room & Lobby Refresh
            const lobbyModal = document.getElementById('modal-lobby');
            if (lobbyModal && !lobbyModal.classList.contains('hidden') && window._currentActiveLobbyId) {
              if (typeof openLobby === 'function') {
                openLobby(window._currentActiveLobbyId);
              }
            }
          }
        }
      } else {
        this.updateServerOnlineStatus(false, 0);
      }
    } catch(e) {
      this.updateServerOnlineStatus(false, 0);
    }
  },

  updateServerOnlineStatus(isOnline, pingMs) {
    const pill = document.getElementById('server-status-pill');
    const text = document.getElementById('server-status-text');
    const ping = document.getElementById('server-status-ping');
    if (!pill || !text) return;

    if (isOnline) {
      pill.className = 'server-status-pill online';
      pill.title = 'Backend Server Connected (Sync Active)';
      text.textContent = 'ONLINE';
      if (ping) ping.textContent = `${pingMs}ms`;
    } else {
      pill.className = 'server-status-pill offline';
      pill.title = 'Backend Server Unreachable (Local Cache Only)';
      text.textContent = 'OFFLINE';
      if (ping) ping.textContent = 'local';
    }
  },

  updateOnlineCount(count) {
    const el = document.getElementById('chat-online-count');
    if (el) el.textContent = `${count} ${count === 1 ? 'online' : 'online'}`;
  },

  save() {
    if (!this.data) return;
    const str = JSON.stringify(this.data);
    this._lastDataStr = str;
    localStorage.setItem(STORAGE_KEY, str);
    this.pushServerState();
  },

  async pushServerState() {
    if (this.isSyncing || !this.data) return;
    this.isSyncing = true;
    try {
      const uid = Auth.current ? Auth.current.id : '';
      await fetch(`/api/state?userId=${encodeURIComponent(uid)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Token': 'ff_arena_internal_2026'
        },
        body: JSON.stringify(this.data)
      });
    } catch(e) {}
    this.isSyncing = false;
  },

  startAutoSync() {
    if (this._syncTimer) clearInterval(this._syncTimer);
    this._syncTimer = setInterval(() => this.fetchServerState(), 500);
  },


  get(key)        { return this.data ? (this.data[key] || []) : []; },
  set(key, val)   { if (this.data) { this.data[key] = val; this.save(); } },

  find(key, id)   { return (this.get(key) || []).find(x => x.id === id); },
  findWhere(key, fn) { return (this.get(key) || []).find(fn); },
  filter(key, fn) { return (this.get(key) || []).filter(fn); },

  push(key, item) {
    if (!this.data) return;
    if (!this.data[key]) this.data[key] = [];
    this.data[key].push(item);
    this.save();
  },

  update(key, id, patch) {
    if (!this.data || !this.data[key]) return;
    const arr = this.data[key];
    const idx = arr.findIndex(x => x.id === id);
    if (idx !== -1) { Object.assign(arr[idx], patch); this.save(); }
  },

  remove(key, id) {
    if (this.data && this.data[key]) {
      this.data[key] = this.data[key].filter(x => x.id !== id);
      this.save();
    }
  },

  reset() { this.data = buildSeedData(); this.save(); }
};


/* ─── 4. BROADCAST CHANNEL ───────────────────────────────── */
let channel;
try { channel = new BroadcastChannel('ff-tournament'); } catch(e) { channel = null; }

function broadcast(type, data) {
  if (channel) channel.postMessage({ type, data });
}

/* ─── 5. SESSION / AUTH ──────────────────────────────────── */
function getDeviceId() {
  let id = localStorage.getItem('ff_arena_device_id');
  if (!id) {
    id = 'dev_' + uid();
    localStorage.setItem('ff_arena_device_id', id);
  }
  return id;
}

/* ─── 5. SESSION / AUTH ──────────────────────────────────── */
const Auth = {
  current: null,

  init() {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        const sess = JSON.parse(raw);
        if (sess && sess.userId) {
          const user = Store.find('users', sess.userId) || sess.user;
          if (user && user.status !== 'banned') {
            this.current = user;
            return true;
          }
        }
      } catch(e) {}
    }
    return false;
  },

  async login(username, password) {
    const cleanUser = (username || '').trim().toLowerCase();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ok') {
          this.current = data.user;
          const sessObj = JSON.stringify({
            userId: data.user.id,
            username: data.user.username,
            user: data.user,
            token: data.token,
            ts: Date.now()
          });

          sessionStorage.setItem(SESSION_KEY, sessObj);
          localStorage.setItem(SESSION_KEY, sessObj);

          await Store.fetchServerState();
          return true;
        }
        if (data.status === 'banned') return 'banned';
        if (data.status === 'pending') return 'pending';
      }
    } catch(e) {
      // Backend not running / Netlify static hosting mode
    }

    // ── Static / Netlify Offline Fallback ──
    const users = Store.get('users') || [];
    let target = users.find(u => (u.username || '').trim().toLowerCase() === cleanUser);

    // Ensure default admin always exists
    if (!target && cleanUser === 'admin') {
      target = {
        id: 'u1', username: 'admin', password: 'admin123',
        displayName: 'Admin', role: 'admin', status: 'active',
        playerId: 'FF-2026-000', createdAt: Date.now(), lastLogin: Date.now(),
        totalKills: 0, totalAssists: 0, totalDamage: 0, bestKills: 0, totalHeadshots: 0, top3: 0, wins: 0
      };
      Store.push('users', target);
    }

    if (target) {
      if (target.status === 'banned') return 'banned';
      if (target.status === 'pending') return 'pending';

      const validPass = (cleanUser === 'admin' && (password === 'admin123' || target.password === password)) ||
                        target.password === password ||
                        !target.password;

      if (validPass) {
        this.current = target;
        const sessObj = JSON.stringify({
          userId: target.id,
          username: target.username,
          user: target,
          ts: Date.now()
        });
        sessionStorage.setItem(SESSION_KEY, sessObj);
        localStorage.setItem(SESSION_KEY, sessObj);
        return true;
      }
    }

    return false;
  },

  logout() {
    this.current = null;
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    showLogin();
  },

  is(role)    { return this.current && this.current.role === role; },
  isAdmin()   { return this.is('admin'); },
  isCoAdmin() { return this.is('coadmin'); },
  canManage() { return this.is('admin') || this.is('coadmin'); },
  isPlayer()  { return this.is('player') || this.is('admin') || this.is('coadmin'); },
  canJoin()   { return this.is('player') || this.is('admin') || this.is('coadmin'); },
};





/* ─── 6. TOAST NOTIFICATIONS ─────────────────────────────── */
const Toast = {
  show(msg, type='info', duration=4000) {
    const icons = { success:'✅', error:'❌', info:'ℹ️', warning:'⚠️' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 350);
    }, duration);
  },
  success(m) { this.show(m, 'success'); },
  error(m)   { this.show(m, 'error'); },
  warn(m)    { this.show(m, 'warning'); },
  info(m)    { this.show(m, 'info'); },
};

/* ─── 7. ROUTER ──────────────────────────────────────────── */
const Router = {
  current: 'dashboard',

  navigate(page) {
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(`page-${page}`);
    if (target) { target.classList.add('active'); this.current = page; }

    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    Pages[page] && Pages[page]();
    window.scrollTo(0, 0);
  }
};

/* ─── 8. UI HELPERS ──────────────────────────────────────── */
function uid()  { return 'id_' + Math.random().toString(36).slice(2,10); }
function ts()   { return Date.now(); }

/** Escape user-supplied strings before injecting into innerHTML to prevent XSS */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
}
function fmtDateTime(ms) { return `${fmtDate(ms)} ${fmtTime(ms)}`; }
function fmtCurrency(n)  { return '$' + Number(n || 0).toLocaleString(); }
function timeSince(ms) {
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60)   return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}
function getInitial(name='?') { return name.charAt(0).toUpperCase(); }
function avatarColor(name='?') {
  const colors = ['#ff2e3f','#2f7bff','#2f7bff','#7a8ba3','#5aa9ff','#ff2e3f'];
  return colors[name.charCodeAt(0) % colors.length];
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function genRoomCode() {
  const d = new Date();
  const Y = d.getFullYear();
  const M = String(d.getMonth()+1).padStart(2,'0');
  const D = String(d.getDate()).padStart(2,'0');
  const R = String(Math.floor(Math.random()*900)+100);
  return `FF-${Y}-${M}-${D}-${R}`;
}

function genPassword() {
  return String(Math.floor(Math.random()*9000)+1000);
}

function copyToClipboard(text, label='') {
  navigator.clipboard.writeText(text).then(() => {
    Toast.success(`${label || text} copied to clipboard!`);
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    ta.remove(); Toast.success('Copied!');
  });
}

function countdownStr(targetMs) {
  const diff = targetMs - Date.now();
  if (diff <= 0) return '00:00:00';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return [h,m,s].map(v => String(v).padStart(2,'0')).join(':');
}

function roleBadgeHTML(role) {
  const map = { admin:'role-admin', coadmin:'role-coadmin', player:'role-player', spectator:'role-spectator' };
  const labels = { admin:'ADMIN', coadmin:'CO-ADMIN', player:'PLAYER', spectator:'SPECTATOR' };
  return `<span class="role-badge ${map[role]||'role-player'}">${labels[role] || (role||'').toUpperCase()}</span>`;
}

function statusBadgeHTML(status) {
  const map = {
    registration: 'badge-info',    active:'badge-success',
    completed:    'badge-muted',   cancelled:'badge-danger',
    waiting:      'badge-info',    ready:'badge-warning',
    in_progress:  'badge-danger',  pending:'badge-warning',
    paid:         'badge-success', banned:'badge-danger',
  };
  const labels = {
    registration:'OPEN', active:'ACTIVE', completed:'ENDED',
    cancelled:'CANCELLED', waiting:'WAITING', ready:'READY',
    in_progress:'LIVE', pending:'PENDING', paid:'PAID', banned:'BANNED',
  };
  const cls = map[status] || 'badge-muted';
  const dot = ['active','waiting','in_progress'].includes(status) ? `<span class="badge-dot"></span>` : '';
  return `<span class="badge ${cls}">${dot}${labels[status]||status.toUpperCase()}</span>`;
}

/* ─── 9. PARTICLE BACKGROUND ─────────────────────────────── */
function initParticles() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];
  const NUM = 60;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function mkParticle() {
    return {
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.5 + 0.5,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      alpha: Math.random() * 0.5 + 0.2,
      color: Math.random() > 0.5 ? '#2f7bff' : '#ff2e3f',
    };
  }

  for (let i = 0; i < NUM; i++) particles.push(mkParticle());

  let lines_dist = 120;

  function animate() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
    });

    for (let i = 0; i < particles.length; i++) {
      for (let j = i+1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < lines_dist) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = '#2f7bff';
          ctx.globalAlpha = (1 - dist/lines_dist) * 0.15;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(animate);
  }
  animate();
}

/* ─── 10. LIVE CLOCK ─────────────────────────────────────── */
function initClock() {
  const el = document.getElementById('live-clock');
  if (!el) return;
  const update = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
  };
  update();
  setInterval(update, 1000);
}

/* ─── 11. NOTIFICATION BADGE ─────────────────────────────── */
function updateNotifBadge() {
  const notifs = Store.filter('notifications', n =>
    (n.userId === 'all' || n.userId === (Auth.current && Auth.current.id)) && !n.read
  );
  const el = document.getElementById('notif-count');
  if (el) { el.textContent = notifs.length; el.style.display = notifs.length ? 'flex' : 'none'; }
  const nb = document.querySelector('.nav-badge[data-notif]');
  if (nb) { nb.textContent = notifs.length; nb.style.display = notifs.length ? '' : 'none'; }
}

function addNotification(userId, message, type='info') {
  Store.push('notifications', { id: uid(), userId, message, type, read:false, createdAt: ts() });
  updateNotifBadge();
}

/* ─── 12. SETUP / SHOW AUTH SCREENS ──────────────────────── */
let _pendingPollingInterval = null;

function showAuthScreen(screen, username) {
  const loginScreen   = document.getElementById('screen-login');
  const signupScreen  = document.getElementById('screen-signup');
  const resetScreen   = document.getElementById('screen-reset-password');
  const pendingScreen = document.getElementById('screen-pending-approval');
  const appContainer  = document.getElementById('app');

  if (_pendingPollingInterval) {
    clearInterval(_pendingPollingInterval);
    _pendingPollingInterval = null;
  }

  appContainer.classList.remove('visible');

  if (loginScreen)   loginScreen.classList.add('hidden');
  if (signupScreen)  signupScreen.classList.add('hidden');
  if (resetScreen)   resetScreen.classList.add('hidden');
  if (pendingScreen) pendingScreen.classList.add('hidden');

  if (screen === 'signup' && signupScreen) {
    signupScreen.classList.remove('hidden');
  } else if (screen === 'reset' && resetScreen) {
    resetScreen.classList.remove('hidden');
    document.getElementById('reset-find-form').classList.remove('hidden');
    document.getElementById('reset-verify-form').classList.add('hidden');
    document.getElementById('reset-username').value = '';
    document.getElementById('reset-otp-input').value = '';
    document.getElementById('reset-new-password').value = '';
  } else if (screen === 'pending' && pendingScreen) {
    pendingScreen.classList.remove('hidden');
    if (username) {
      const displayEl = document.getElementById('pending-username-display');
      if (displayEl) displayEl.textContent = `@${username}`;
      startPendingApprovalCheck(username);
    }
  } else if (loginScreen) {
    loginScreen.classList.remove('hidden');
  }
}

function startPendingApprovalCheck(username) {
  if (_pendingPollingInterval) clearInterval(_pendingPollingInterval);

  _pendingPollingInterval = setInterval(() => {
    const users = Store.get('users') || [];
    const user = users.find(u => (u.username || '').trim().toLowerCase() === username.trim().toLowerCase());

    if (user && user.status === 'active') {
      clearInterval(_pendingPollingInterval);
      _pendingPollingInterval = null;
      Toast.success(`🎉 Congratulations @${user.username}! Your account has been approved by Admin!`);
      Auth.login(user.username, user.password);
      showApp();
    }
  }, 3000);
}



function showLogin() {
  showAuthScreen('login');
}

function showApp() {
  const loginScreen  = document.getElementById('screen-login');
  const signupScreen = document.getElementById('screen-signup');
  const resetScreen  = document.getElementById('screen-reset-password');
  if (loginScreen)  loginScreen.classList.add('hidden');
  if (signupScreen) signupScreen.classList.add('hidden');
  if (resetScreen)  resetScreen.classList.add('hidden');

  document.getElementById('app').classList.add('visible');
  buildSidebar();
  updateNotifBadge();
  Router.navigate(Router.current || 'dashboard');
}



function buildSidebar() {
  const u = Auth.current;
  // Avatar
  const av = document.getElementById('sidebar-avatar');
  const un = document.getElementById('sidebar-username');
  const ur = document.getElementById('sidebar-role');
  if (av) { av.textContent = getInitial(u.displayName); av.style.background = `linear-gradient(135deg, ${avatarColor(u.displayName)}, #7a8ba3)`; }
  if (un) un.textContent = u.displayName;
  if (ur) ur.innerHTML = roleBadgeHTML(u.role);

  // Toggle admin/coadmin nav items
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.style.display = Auth.canManage() ? '' : 'none';
  });
  document.querySelectorAll('[data-player-only]').forEach(el => {
    el.style.display = Auth.is('player') ? '' : 'none';
  });

  if (Auth.canManage()) {
    const pendings = Store.filter('users', u => u.status === 'pending');
    const badge = document.getElementById('waiting-hall-count-badge');
    if (badge) {
      badge.textContent = pendings.length;
      badge.style.display = pendings.length > 0 ? 'inline-block' : 'none';
    }
  }


}

/* ─── 13. LOGIN & SIGNUP FORMS ────────────────────────────── */
function isUsernameTaken(username) {
  if (!username) return false;
  const clean = username.trim().toLowerCase();
  const users = Store.get('users') || [];
  return users.some(u => (u.username || '').trim().toLowerCase() === clean);
}

function checkUsernameAvailability() {
  const input = document.getElementById('signup-username');
  const feedback = document.getElementById('signup-username-feedback');
  if (!input || !feedback) return false;

  const val = input.value.trim().toLowerCase();
  feedback.style.display = 'block';

  if (!val) {
    feedback.style.display = 'none';
    input.style.borderColor = '';
    return false;
  }

  if (val.length < 3) {
    feedback.textContent = '⚠️ Username must be at least 3 characters long.';
    feedback.style.color = 'var(--accent-gold)';
    input.style.borderColor = 'var(--accent-gold)';
    return false;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(val)) {
    feedback.textContent = '❌ Only letters, numbers, and underscores allowed.';
    feedback.style.color = 'var(--accent-red)';
    input.style.borderColor = 'var(--accent-red)';
    return false;
  }

  if (isUsernameTaken(val)) {
    feedback.textContent = '❌ Username "' + val + '" is already taken!';
    feedback.style.color = 'var(--accent-red)';
    input.style.borderColor = 'var(--accent-red)';
    return false;
  }

  feedback.textContent = '✅ Username "' + val + '" is available!';
  feedback.style.color = 'var(--accent-green)';
  input.style.borderColor = 'var(--accent-green)';
  return true;
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  if (!username || !password) { Toast.warn('Please enter your credentials.'); return; }
  
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Verifying...'; }

  const result = await Auth.login(username, password);

  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '🚀 LOGIN TO ARENA'; }

  if (result === true) {
    Toast.success(`Welcome back, ${Auth.current.displayName}! 🎮`);
    showApp();
    Chat.init();
  } else if (result === 'banned') {
    Toast.error('Account is banned. Contact admin.');
  } else if (result === 'pending') {
    Toast.warn('Your account is in the Waiting Room pending admin approval.');
    showAuthScreen('pending', username);
  } else {
    Toast.error('Invalid username or password.');
  }
}

/* ─── EMAIL OTP VERIFICATION SYSTEM (SERVER-BACKED) ───────── */
async function sendSignupEmailOTP() {
  const usernameInput = document.getElementById('signup-username');
  const username = usernameInput ? usernameInput.value.trim().toLowerCase() : '';

  // First blank MUST be filled first (Username)
  if (!username) {
    Toast.warn('⚠️ Please fill in your Username first before requesting a verification code.');
    if (usernameInput) {
      usernameInput.focus();
      usernameInput.style.borderColor = 'var(--accent-red)';
    }
    return;
  }

  if (username.length < 3) {
    Toast.warn('⚠️ Username must be at least 3 characters long.');
    if (usernameInput) { usernameInput.focus(); }
    return;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    Toast.warn('⚠️ Username can only contain letters, numbers, and underscores.');
    if (usernameInput) { usernameInput.focus(); }
    return;
  }

  if (isUsernameTaken(username)) {
    Toast.error(`❌ Username "${username}" is already taken. Please choose another username.`);
    if (usernameInput) { usernameInput.focus(); }
    return;
  }

  // Second blank: Email Address
  const emailInput = document.getElementById('signup-email');
  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';

  if (!email || !email.includes('@') || !email.includes('.')) {
    Toast.warn('⚠️ Please enter a valid Email Address.');
    if (emailInput) {
      emailInput.focus();
      emailInput.style.borderColor = 'var(--accent-red)';
    }
    return;
  }

  const btn = document.getElementById('btn-send-email-otp');
  const fb  = document.getElementById('otp-feedback');

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Sending...';
  }

  try {
    const res = await fetch('/api/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, purpose: 'Account Verification' })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.status === 'ok') {
        if (data.sent_real_email) {
          Toast.success(`✅ Verification code sent to ${email}! Check your inbox.`);
          if (fb) {
            fb.style.display = 'block';
            fb.style.color = 'var(--accent-green)';
            fb.innerHTML = `✅ Verification code sent to <strong>${escapeHtml(email)}</strong>! Please check your Gmail inbox.`;
          }
        } else {
          Toast.info(`📩 Verification code generated for ${email}. Check server log or email.`);
          if (fb) {
            fb.style.display = 'block';
            fb.style.color = 'var(--accent-cyan)';
            fb.innerHTML = `📩 Verification code dispatched to <strong>${escapeHtml(email)}</strong>.`;
          }
        }
        const otpInput = document.getElementById('signup-email-otp');
        if (otpInput) otpInput.focus();
        return;
      }
    }
  } catch(err) {
    // Netlify static mode fallback
  }

  // Static hosting auto OTP
  const mockOtp = '888222';
  window._staticMockOtp = mockOtp;
  const otpInput = document.getElementById('signup-email-otp');
  if (otpInput) { otpInput.value = mockOtp; otpInput.focus(); }
  if (fb) {
    fb.style.display = 'block';
    fb.style.color = 'var(--accent-green)';
    fb.innerHTML = `✅ Verification Code: <strong style="color:var(--accent-gold);letter-spacing:2px">${mockOtp}</strong> (Auto-filled for static demo)`;
  }
  Toast.success(`Verification Code: ${mockOtp} (Auto-filled)`);

  // Start 60s countdown on button
  if (btn) {
    let sec = 60;
    const interval = setInterval(() => {
      sec--;
      if (sec <= 0) {
        clearInterval(interval);
        btn.disabled = false;
        btn.textContent = '📩 Resend Code';
      } else {
        btn.textContent = `⏳ ${sec}s`;
      }
    }, 1000);
  }
}

function isDisplayNameTaken(displayName) {
  if (!displayName) return false;
  const clean = displayName.trim().toLowerCase();
  const users = Store.get('users') || [];
  return users.some(u => (u.displayName || '').trim().toLowerCase() === clean);
}

async function handleSignup(e) {
  e.preventDefault();

  const elUsername = document.getElementById('signup-username');
  const elEmail    = document.getElementById('signup-email');
  const elOtp      = document.getElementById('signup-email-otp');
  const elDisplay  = document.getElementById('signup-displayname');
  const elPlayerId = document.getElementById('signup-playerid');
  const elPassword = document.getElementById('signup-password');
  const elConfirm  = document.getElementById('signup-confirm-password');

  const username        = elUsername ? elUsername.value.trim().toLowerCase() : '';
  const email           = elEmail ? elEmail.value.trim().toLowerCase() : '';
  const enteredOTP      = elOtp ? elOtp.value.trim() : '';
  const displayName     = elDisplay ? elDisplay.value.trim() : username;
  const playerId        = elPlayerId ? elPlayerId.value.trim() : '';
  const password        = elPassword ? elPassword.value : '';
  const confirmPassword = elConfirm ? elConfirm.value : '';

  // 1. Validate Username (Blank 1)
  if (!username) {
    Toast.warn('⚠️ Please fill in your Username first.');
    if (elUsername) { elUsername.focus(); elUsername.style.borderColor = 'var(--accent-red)'; }
    return;
  }
  if (username.length < 3) {
    Toast.warn('⚠️ Username must be at least 3 characters long.');
    if (elUsername) elUsername.focus();
    return;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    Toast.warn('⚠️ Username can only contain letters, numbers, and underscores.');
    if (elUsername) elUsername.focus();
    return;
  }
  if (isUsernameTaken(username)) {
    Toast.error(`❌ Username "${username}" is already registered. Please choose another.`);
    if (elUsername) elUsername.focus();
    return;
  }

  // 2. Validate Email (Blank 2)
  if (!email || !email.includes('@') || !email.includes('.')) {
    Toast.warn('⚠️ Please enter a valid Email Address.');
    if (elEmail) { elEmail.focus(); elEmail.style.borderColor = 'var(--accent-red)'; }
    return;
  }

  // 3. Validate OTP Code (Blank 3)
  if (!enteredOTP) {
    Toast.warn('⚠️ Please click "Send Code" and enter the 6-digit Verification Code (OTP).');
    if (elOtp) { elOtp.focus(); elOtp.style.borderColor = 'var(--accent-gold)'; }
    return;
  }
  if (enteredOTP.length < 6) {
    Toast.warn('⚠️ Please enter the complete 6-digit verification code.');
    if (elOtp) elOtp.focus();
    return;
  }

  // 4. Validate Display Name (Blank 4)
  if (!displayName) {
    Toast.warn('⚠️ Please enter your Display Name (In-Game Alias).');
    if (elDisplay) { elDisplay.focus(); elDisplay.style.borderColor = 'var(--accent-red)'; }
    return;
  }
  if (isDisplayNameTaken(displayName)) {
    Toast.error(`❌ Display Name "${displayName}" is already taken. Please choose a unique alias.`);
    if (elDisplay) elDisplay.focus();
    return;
  }

  // 5. Validate Free Fire Player UID (Blank 5)
  if (!playerId) {
    Toast.warn('⚠️ Please enter your Free Fire Player UID (ID).');
    if (elPlayerId) { elPlayerId.focus(); elPlayerId.style.borderColor = 'var(--accent-red)'; }
    return;
  }

  // 6. Validate Password (Blank 6)
  if (!password) {
    Toast.warn('⚠️ Please create a Password.');
    if (elPassword) { elPassword.focus(); elPassword.style.borderColor = 'var(--accent-red)'; }
    return;
  }
  if (password.length < 4) {
    Toast.warn('⚠️ Password must be at least 4 characters long.');
    if (elPassword) elPassword.focus();
    return;
  }

  // 7. Validate Confirm Password (Blank 7)
  if (!confirmPassword) {
    Toast.warn('⚠️ Please re-enter your Password to confirm.');
    if (elConfirm) { elConfirm.focus(); elConfirm.style.borderColor = 'var(--accent-red)'; }
    return;
  }
  if (password !== confirmPassword) {
    Toast.error('❌ Passwords do not match! Please re-enter your password carefully.');
    if (elConfirm) { elConfirm.focus(); elConfirm.style.borderColor = 'var(--accent-red)'; }
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Creating Account...'; }

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email,
        otp: enteredOTP,
        displayName,
        playerId,
        password
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.status === 'ok') {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '✨ CREATE ACCOUNT & ENTER'; }
        await Store.fetchServerState();
        Toast.info(`⏳ Account created! Waiting for Admin Approval...`);
        showAuthScreen('pending', username);
        return;
      } else {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '✨ CREATE ACCOUNT & ENTER'; }
        Toast.error(data.message || 'Registration failed.');
        return;
      }
    }
  } catch(err) {
    // Netlify / Static hosting fallback
  }

  // Netlify / Static Mode creation
  const now = Date.now();
  const newUser = {
    id: uid(),
    username,
    email,
    password,
    displayName,
    playerId: playerId || `FF-2026-${Math.floor(Math.random() * 900 + 100)}`,
    role: 'player',
    status: 'pending',
    createdAt: now,
    lastLogin: now,
    totalKills: 0, totalAssists: 0, totalDamage: 0, bestKills: 0, totalHeadshots: 0, top3: 0, wins: 0
  };

  Store.push('users', newUser);
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '✨ CREATE ACCOUNT & ENTER'; }
  Toast.info(`⏳ Account created! Waiting for Admin Approval in Waiting Halls...`);
  showAuthScreen('pending', username);
}

/* ─── PASSWORD RESET HANDLERS (SERVER-BACKED) ─────────────── */
let _targetResetEmail = null;

async function sendResetEmailOTP() {
  if (!_targetResetEmail) {
    Toast.error('Please find your account first.');
    return;
  }

  const email = _targetResetEmail;
  const btn = document.getElementById('btn-resend-reset-otp');
  const fb = document.getElementById('reset-otp-feedback');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending...'; }

  try {
    const res = await fetch('/api/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, purpose: 'Password Reset' })
    });
    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      Toast.success(`✅ Password reset code dispatched to ${email}!`);
      if (fb) {
        fb.style.display = 'block';
        fb.style.color = 'var(--accent-green)';
        fb.innerHTML = `✅ Code sent to <strong>${escapeHtml(email)}</strong>. Check your inbox.`;
      }
    } else {
      Toast.error(data.message || 'Failed to send reset code.');
    }
  } catch(e) {
    Toast.error('Network error requesting reset code.');
  }

  if (btn) {
    let sec = 60;
    const interval = setInterval(() => {
      sec--;
      if (sec <= 0) { clearInterval(interval); btn.disabled = false; btn.textContent = '📩 Resend Code'; }
      else btn.textContent = `⏳ ${sec}s`;
    }, 1000);
  }
}

function handleResetFindAccount(e) {
  e.preventDefault();
  const query = document.getElementById('reset-username').value.trim().toLowerCase();
  if (!query) { Toast.warn('Please enter your username or email.'); return; }

  const users = Store.get('users') || [];
  const user = users.find(u => (u.username||'').trim().toLowerCase() === query || (u.email||'').trim().toLowerCase() === query);

  if (!user) {
    Toast.error(`No account found with username or email "${query}".`);
    return;
  }

  _targetResetEmail = user.email || user.username;
  const maskedEmail = user.email ? user.email.replace(/(.{2})(.*)(?=@)/, (gp1, gp2, gp3) => gp2 + "*".repeat(gp3.length)) : user.username + '@registered';
  document.getElementById('reset-email-display').textContent = `${user.displayName} (${maskedEmail})`;

  document.getElementById('reset-find-form').classList.add('hidden');
  document.getElementById('reset-verify-form').classList.remove('hidden');

  Toast.success('Account found! Sending password reset verification code...');
  sendResetEmailOTP();
}

async function handleResetVerifyAnswer(e) {
  e.preventDefault();
  if (!_targetResetEmail) { Toast.error('Session error. Please try again.'); return; }

  const enteredOTP = document.getElementById('reset-otp-input').value.trim();
  const newPassword = document.getElementById('reset-new-password').value;

  if (!enteredOTP || !newPassword) {
    Toast.warn('Please enter the verification code and new password.');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Saving...'; }

  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: _targetResetEmail,
        otp: enteredOTP,
        newPassword
      })
    });

    const data = await res.json();
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '🔐 RESET PASSWORD & SAVE'; }

    if (!res.ok || data.status === 'error') {
      Toast.error(data.message || 'Password reset failed. Invalid or expired verification code.');
      return;
    }

    Toast.success('🔐 Password reset successfully! Log in with your new password.');
    _targetResetEmail = null;
    showAuthScreen('login');
  } catch(err) {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '🔐 RESET PASSWORD & SAVE'; }
    Toast.error('Network error during password reset.');
  }
}

function switchAuthTab(tab) {
  showAuthScreen(tab);
}



/* ─── 14. STATS CALC ENGINE ──────────────────────────────── */
function calcPlacementPts(place) { return PLACEMENT_PTS[place] || 0; }

function calcMatchTeamStats(teamEntry) {
  const kills   = teamEntry.players.reduce((s,p) => s + (p.kills||0), 0);
  const damage  = teamEntry.players.reduce((s,p) => s + (p.damage||0), 0);
  const assists = teamEntry.players.reduce((s,p) => s + (p.assists||0), 0);
  const pts     = calcPlacementPts(teamEntry.placement);
  return { totalKills:kills, totalDamage:damage, totalAssists:assists, placementPoints:pts, killPoints:kills };
}

function determineMVP(matchData) {
  let mvp = null; let bestKD = -1;
  Object.values(matchData.teamStats).forEach(team => {
    team.players.forEach(p => {
      const kd = (p.kills||0) / Math.max(1, (p.deaths||1));
      if (kd > bestKD || (kd === bestKD && (p.kills||0) > (mvp&&mvp.kills||0))) {
        bestKD = kd; mvp = { ...p, kd: +kd.toFixed(2) };
      }
    });
  });
  return mvp;
}

function updateLeaderboardFromMatch(matchData) {
  const lb = Store.get('leaderboard');
  Object.entries(matchData.teamStats).forEach(([teamId, team]) => {
    let entry = lb.find(e => e.teamId === teamId && e.tournamentId === matchData.tournamentId);
    const isWinner = matchData.winner === teamId;
    const isTop3   = team.placement <= 3;
    if (!entry) {
      entry = {
        tournamentId: matchData.tournamentId, teamId, teamName: team.teamName,
        matchesPlayed:0, wins:0, top3:0, totalKills:0, totalDamage:0,
        totalAssists:0, kdRatio:0, points:0, prizeWon:0
      };
      lb.push(entry);
    }
    entry.matchesPlayed++;
    if (isWinner) entry.wins++;
    if (isTop3)   entry.top3++;
    entry.totalKills   += (team.totalKills || team.kills || 0);
    entry.totalDamage  += (team.totalDamage || team.damage || 0);
    entry.totalAssists += (team.totalAssists || team.assists || 0);
    const totalDeaths = Math.max(1, entry.matchesPlayed * 4 - entry.totalKills);
    entry.kdRatio  = +(entry.totalKills / totalDeaths).toFixed(2);
    entry.points   += (team.totalPoints || (team.placementPoints||0) + (team.killPoints||0) + (team.bonusPoints||0));
  });
  lb.sort((a,b) => b.points - a.points);
  Store.set('leaderboard', lb);
}

/* ─── 15. PAGES ──────────────────────────────────────────── */
const Pages = {};

/* === DASHBOARD === */
Pages.dashboard = function() {
  const u = Auth.current;
  const rooms    = Store.filter('matchRooms', r => r.status === 'waiting' || r.status === 'in_progress');
  const upcoming = Store.filter('tournaments', t => t.status === 'registration');
  const notifs   = Store.filter('notifications', n => (n.userId === 'all' || n.userId === u.id));

  // Stats
  const userTeams = Store.filter('teams', t => t.players.some(p => p.userId === u.id));
  const myTotalPoints = userTeams.reduce((s, t) => s + (t.totalPoints||0), 0);

  let liveHTML = rooms.length ? rooms.map(r => `
    <div class="live-match-card mb-12">
      <div class="live-indicator"><div class="live-dot"></div><span class="live-text">LIVE</span></div>
      <div class="flex-between mb-8">
        <div>
          <div class="font-orbitron" style="font-size:13px;color:var(--accent-cyan)">${r.roomCode}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Host: ${r.hostName} · ${r.map} · ${r.mode}</div>
        </div>
        ${statusBadgeHTML(r.status)}
      </div>
      <div class="players-bar mb-8"><div class="players-fill" style="width:${(r.players.length/r.maxPlayers*100)}%"></div></div>
      <div class="flex-between">
        <span style="font-size:12px;color:var(--text-secondary)">${r.players.length}/${r.maxPlayers} Players</span>
        <div style="display:flex;gap:6px">
          ${Auth.canJoin() && r.status === 'waiting' ? `<button class="btn btn-cyan btn-sm" onclick="joinRoomPrompt('${r.id}')">Join Room</button>` : ''}
          ${Auth.isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();endAndDeleteRoom('${r.id}')">🛑 End Room</button>` : ''}
        </div>
      </div>
    </div>
  `).join('') : `<div class="empty-state"><div class="empty-icon">🎮</div><p>No active rooms right now</p></div>`;


  let upcomingHTML = upcoming.slice(0,3).map(t => {
    const deadline = new Date(t.registrationDeadline).getTime();
    return `
    <div class="countdown-card mb-12">
      <div class="flex-between mb-8">
        <div>
          <div class="font-orbitron" style="font-size:12px">${escapeHtml(t.name)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t.gameMode)} · ${escapeHtml(t.map||'TBD')}</div>
        </div>
        ${statusBadgeHTML(t.status)}
      </div>
      <div class="countdown-timer" id="cd-${t.id}">${countdownStr(deadline)}</div>
      <div class="countdown-label">Registration closes</div>
    </div>
    `;
  }).join('') || `<div class="empty-state"><div class="empty-icon">📅</div><p>No upcoming events</p></div>`;

  let notifHTML = notifs.slice(0,8).map(n => `
    <div class="notif-item ${n.read?'':'unread'}" id="notif-${n.id}">
      <div class="notif-icon">${n.type==='success'?'✅':n.type==='warning'?'⚠️':'ℹ️'}</div>
      <div class="notif-content">
        <div class="notif-msg">${n.message}</div>
        <div class="notif-time">${timeSince(n.createdAt)}</div>
      </div>
    </div>
  `).join('') || `<div class="empty-state"><div class="empty-icon">🔔</div><p>No notifications</p></div>`;

  // My stats card
  let myStats = '';
  if (Auth.is('player')) {
    const ud = Store.find('users', u.id);
    myStats = `
    <div class="card mb-20">
      <div class="card-header"><span class="card-title">⚡ MY PERFORMANCE</span></div>
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
        <div class="stat-card red"><div class="stat-label">Total Kills</div><div class="stat-value">${ud.totalKills||0}</div></div>
        <div class="stat-card cyan"><div class="stat-label">Assists</div><div class="stat-value">${ud.totalAssists||0}</div></div>
        <div class="stat-card gold"><div class="stat-label">Wins</div><div class="stat-value">${ud.wins||0}</div></div>
        <div class="stat-card green"><div class="stat-label">Top 3</div><div class="stat-value">${ud.top3||0}</div></div>
      </div>
    </div>`;
  }

  document.getElementById('page-dashboard').innerHTML = `
    <div style="
      width: 100%;
      border-radius: 16px;
      overflow: hidden;
      margin-bottom: 24px;
      position: relative;
      box-shadow: 0 0 40px rgba(255,46,63,0.3), 0 8px 32px rgba(0,0,0,0.6);
      border: 1px solid rgba(255,46,63,0.25);
      max-height: 280px;
    ">
      <img src="ff-banner.png" alt="Free Fire Banner"
        style="width:100%;display:block;object-fit:cover;max-height:280px;filter:brightness(0.92) saturate(1.2);">
      <div style="
        position:absolute;inset:0;
        background: linear-gradient(to right, rgba(10,14,23,0.55) 0%, transparent 50%, rgba(10,14,23,0.3) 100%);
        pointer-events:none;
      "></div>
      <div style="
        position:absolute;bottom:0;left:0;right:0;
        background: linear-gradient(to top, rgba(10,14,23,0.85) 0%, transparent 100%);
        padding: 20px 24px 16px;
        pointer-events:none;
      ">
        <div style="font-family:'Orbitron',sans-serif;font-size:11px;letter-spacing:3px;color:var(--accent-red);font-weight:700;margin-bottom:4px">FF ARENA TOURNAMENT PLATFORM</div>
        <div style="font-size:13px;color:var(--text-secondary)">Welcome back, <strong style="color:var(--accent-cyan)">${u.displayName}</strong> — Ready to dominate?</div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card red"><div class="stat-icon">🎮</div><div class="stat-label">Active Rooms</div><div class="stat-value">${rooms.length}</div><div class="stat-sub">Match rooms open</div></div>
      <div class="stat-card cyan"><div class="stat-icon">🏆</div><div class="stat-label">Tournaments</div><div class="stat-value">${Store.get('tournaments').length}</div><div class="stat-sub">Total events</div></div>
      <div class="stat-card gold"><div class="stat-icon">👥</div><div class="stat-label">Players</div><div class="stat-value">${Store.filter('users', u=>u.role==='player').length}</div><div class="stat-sub">Registered</div></div>
      <div class="stat-card green"><div class="stat-icon">⚔️</div><div class="stat-label">Teams</div><div class="stat-value">${Store.get('teams').length}</div><div class="stat-sub">Registered teams</div></div>
    </div>

    ${myStats}

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <span class="card-title">🎯 LIVE MATCH ROOMS</span>
          ${Auth.isAdmin() ? `<button class="btn btn-primary btn-sm" onclick="openModal('modal-create-room')">+ Create Room</button>` : ''}
        </div>
        ${liveHTML}
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">📅 UPCOMING EVENTS</span>
          <button class="btn btn-ghost btn-sm" onclick="Router.navigate('tournaments')">View All</button>
        </div>
        ${upcomingHTML}
      </div>
    </div>

    <div class="card mt-20">
      <div class="card-header">
        <span class="card-title">🔔 NOTIFICATIONS</span>
        <button class="btn btn-ghost btn-sm" onclick="markAllNotifRead()">Mark All Read</button>
      </div>
      <div class="notif-feed" id="notif-feed-dash">${notifHTML}</div>
    </div>
  `;

  // Start countdown timers
  upcoming.forEach(t => {
    const el = document.getElementById(`cd-${t.id}`);
    if (!el) return;
    const deadline = new Date(t.registrationDeadline).getTime();
    setInterval(() => { if(el) el.textContent = countdownStr(deadline); }, 1000);
  });
};

function markAllNotifRead() {
  Store.get('notifications').forEach(n => { n.read = true; });
  Store.save();
  updateNotifBadge();
  Pages.dashboard();
}

/* === TOURNAMENTS === */
Pages.tournaments = function() {
  const tournaments = Store.get('tournaments');
  const rooms = Store.get('matchRooms');
  const el = document.getElementById('page-tournaments');

  // ── Header ──
  let html = `
    <div class="page-header">
      <div class="page-header-left"><h2>🏆 Tournaments</h2><p>Browse tournaments and join active match rooms</p></div>
      <div class="page-actions">
        ${Auth.canManage() ? `<button class="btn btn-cyan" onclick="openModal('modal-create-room')">+ Create Room</button>` : ''}
        ${Auth.canManage() ? `<button class="btn btn-primary" onclick="openModal('modal-create-tournament')">+ Create Tournament</button>` : ''}
      </div>
    </div>
  `;

  // ── Live Match Rooms Section ──
  html += `
    <div class="section-divider-label" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <span style="font-family:'Orbitron',sans-serif;font-size:13px;font-weight:700;color:var(--accent-red);letter-spacing:1px">🎮 LIVE MATCH ROOMS</span>
      <div style="flex:1;height:1px;background:var(--border-dim)"></div>
      <button class="btn btn-ghost btn-sm" onclick="Pages.tournaments()">⟳ Refresh</button>
    </div>
  `;

  if (!rooms.length) {
    html += `<div class="card" style="margin-bottom:28px"><div class="empty-state"><div class="empty-icon">🎮</div><p>No match rooms yet. ${Auth.isAdmin() ? 'Create one above!' : 'Check back soon!'}</p></div></div>`;
  } else {
    html += `<div class="grid-auto" style="margin-bottom:28px">`;
    rooms.forEach(r => {
      html += `
      <div class="room-card ${r.status}" onclick="openLobby('${r.id}')" style="cursor:pointer">
        <div class="room-header">
          <div>
            <div class="room-code">${r.roomCode}</div>
            <div class="room-host">Host: ${r.hostName}</div>
          </div>
          ${statusBadgeHTML(r.status)}
        </div>
        <div class="room-details">
          <span class="room-detail">🗺️ ${r.map}</span>
          <span class="room-detail">⚔️ ${r.mode}</span>
          <span class="room-detail">🔒 ${r.password ? 'Password Protected' : 'Open'}</span>
        </div>
        <div class="room-players">
          <div class="players-label">Players Joined</div>
          <div class="players-bar"><div class="players-fill" style="width:${Math.round((r.players.length/r.maxPlayers)*100)}%"></div></div>
          <div class="players-count">${r.players.length}/${r.maxPlayers} players · Created ${timeSince(r.createdAt)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-cyan btn-sm" onclick="openLobby('${r.id}')">View Lobby</button>
          ${Auth.canJoin() && r.status==='waiting' && !r.players.find(p=>p.userId===Auth.current?.id) ?
            `<button class="btn btn-ghost btn-sm" onclick="joinRoom('${r.id}')">Join</button>` : ''}
          ${Auth.isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();endAndDeleteRoom('${r.id}')">🛑 End & Delete</button>` : ''}
          ${Auth.isAdmin() && r.status==='in_progress' ? `<button class="btn btn-gold btn-sm" onclick="openEnterStats(null,'${r.id}')">Enter Stats</button>` : ''}
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // ── Tournaments Grid Section ──
  html += `
    <div class="section-divider-label" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <span style="font-family:'Orbitron',sans-serif;font-size:13px;font-weight:700;color:var(--accent-gold);letter-spacing:1px">🏆 TOURNAMENT EVENTS</span>
      <div style="flex:1;height:1px;background:var(--border-dim)"></div>
    </div>
    <div class="grid-auto" id="tournament-grid">
  `;

  if (!tournaments.length) {
    html += `<div class="empty-state"><div class="empty-icon">🏆</div><p>No tournaments yet</p></div>`;
  } else {
    tournaments.forEach(t => {
      const pct = Math.round((t.currentTeams / t.maxTeams) * 100);
      html += `
      <div class="tournament-card">
        <div class="tc-header">
          <div>
            <div class="tc-name">${escapeHtml(t.name)}</div>
            <div class="tc-mode">🎮 ${escapeHtml(t.gameMode)} · 🗺️ ${escapeHtml(t.map||'TBD')}</div>
          </div>
          <div class="text-right">
            ${statusBadgeHTML(t.status)}
          </div>
        </div>
        <div class="tc-info">
          <div class="tc-info-item"><label>Status</label><span>${statusBadgeHTML(t.status)}</span></div>
          <div class="tc-info-item"><label>Reg. Deadline</label><span>${escapeHtml(t.registrationDeadline)}</span></div>
          <div class="tc-info-item"><label>Tournament Date</label><span>${escapeHtml(t.tournamentDate)}</span></div>
        </div>
        <div class="tc-progress-bar"><div class="tc-progress-fill" style="width:${pct}%"></div></div>
        <div class="tc-progress-label">${t.currentTeams}/${t.maxTeams} teams registered</div>
        <div class="tc-footer" style="flex-wrap:wrap">
          <button class="btn btn-cyan btn-sm" onclick="viewTournament('${t.id}')">View Details</button>
          ${Auth.is('player') && t.status==='registration' ? `<button class="btn btn-ghost btn-sm" onclick="openRegModal('${t.id}')">Register Team</button>` : ''}
          ${Auth.canManage() ? `<button class="btn btn-ghost btn-sm" onclick="editTournamentStatus('${t.id}')">Manage</button>` : ''}
          ${Auth.canManage() ? `<button class="btn btn-danger btn-sm" onclick="deleteTournament('${t.id}')" style="background:rgba(255,46,63,0.15);border:1px solid rgba(255,46,63,0.4);color:var(--accent-red)">🗑️ Delete</button>` : ''}
        </div>
      </div>`;
    });
  }

  html += `</div>`;
  el.innerHTML = html;
};

function viewTournament(id) {
  const t = Store.find('tournaments', id);
  if (!t) return;
  const teams = Store.filter('teams', tm => tm.tournamentId === id);
  const lbData = Store.filter('leaderboard', l => l.tournamentId === id);
  lbData.sort((a,b) => b.points - a.points);

  const teamsHTML = teams.length ? `
    <table><thead><tr>
      <th>Team Name</th><th>Captain</th><th>Players</th>
    </tr></thead><tbody>
    ${teams.map(tm => `<tr>
      <td class="font-orbitron" style="font-size:13px">${escapeHtml(tm.teamName)}</td>
      <td>${escapeHtml(tm.captainName)}</td>
      <td>${tm.players.length}</td>
    </tr>`).join('')}
    </tbody></table>
  ` : '<p class="text-muted" style="padding:20px 0">No teams registered yet.</p>';

  const schedHTML = t.schedule && t.schedule.length ? t.schedule.map(s => `
    <div class="flex-between" style="padding:10px 0; border-bottom:1px solid var(--border-dim)">
      <span class="font-orbitron" style="font-size:12px;color:var(--accent-cyan)">${s.round}</span>
      <span style="font-size:13px;color:var(--text-secondary)">${s.date} at ${s.time}</span>
    </div>
  `).join('') : '<p class="text-muted">No schedule set yet.</p>';

  const lbHTML = lbData.length ? `
    <div class="table-wrapper"><table><thead><tr>
      <th>Rank</th><th>Team</th><th>W</th><th>Kills</th><th>K/D</th><th>Points</th>
    </tr></thead><tbody>
    ${lbData.map((l,i) => `<tr>
      <td><span class="rank-badge rank-${i<3?i+1:'n'}">${i+1}</span></td>
      <td class="font-orbitron" style="font-size:13px">${escapeHtml(l.teamName)}</td>
      <td>${l.wins}</td>
      <td>${l.totalKills}</td>
      <td style="color:var(--accent-cyan)">${l.kdRatio}</td>
      <td style="color:var(--accent-gold);font-weight:700">${l.points}</td>
    </tr>`).join('')}
    </tbody></table></div>
  ` : '<p class="text-muted">Leaderboard will appear after matches are played.</p>';

  document.getElementById('modal-tournament-detail-title').textContent = t.name;
  document.getElementById('modal-tournament-detail-body').innerHTML = `
    <div class="mb-20">
      <div class="flex-center gap-12 flex-wrap mb-16">
        ${statusBadgeHTML(t.status)}
        <span class="badge badge-info">🎮 ${escapeHtml(t.gameMode)}</span>
        <span class="badge badge-info">🗺️ ${escapeHtml(t.map||'TBD')}</span>
      </div>
      <div class="grid-2 mb-16">
        <div class="stat-card cyan"><div class="stat-label">Teams</div><div class="stat-value">${t.currentTeams}/${t.maxTeams}</div></div>
        <div class="stat-card gold"><div class="stat-label">Max Teams</div><div class="stat-value">${t.maxTeams}</div></div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="mb-20">
      <div class="card-title mb-12">📅 MATCH SCHEDULE</div>
      ${schedHTML}
    </div>
    <div class="divider"></div>
    <div class="mb-20">
      <div class="card-title mb-12">👥 REGISTERED TEAMS</div>
      <div class="table-wrapper">${teamsHTML}</div>
    </div>
    ${lbData.length ? `<div class="divider"><div class="card-title mb-12">🏆 LEADERBOARD</div>${lbHTML}</div>` : ''}
  `;
  openModal('modal-tournament-detail');
}

function editTournamentStatus(id) {
  const t = Store.find('tournaments', id);
  if (!t) return;
  const STATUSES = ['registration','active','completed','cancelled'];
  const opts = STATUSES.map(s => `<option value="${s}" ${t.status===s?'selected':''}>${s.toUpperCase()}</option>`).join('');
  document.getElementById('modal-edit-tournament-id').value = id;
  document.getElementById('modal-edit-tournament-name').textContent = t.name;
  document.getElementById('edit-tournament-status').innerHTML = opts;
  openModal('modal-edit-tournament');
}

function saveEditTournament() {
  const id = document.getElementById('modal-edit-tournament-id').value;
  const status = document.getElementById('edit-tournament-status').value;
  Store.update('tournaments', id, { status });
  closeModal('modal-edit-tournament');
  Pages.tournaments();
  Toast.success('Tournament status updated!');
  broadcast('TOURNAMENT_UPDATED', { id, status });
}

function deleteTournament(id) {
  const t = Store.find('tournaments', id);
  if (!t) return;
  if (!Auth.canManage()) {
    Toast.error('⛔ Only Admin or Co-Admin can delete tournaments.');
    return;
  }
  if (!confirm(`Are you sure you want to permanently delete tournament "${t.name}"? This action cannot be undone.`)) {
    return;
  }

  // Remove tournament
  Store.remove('tournaments', id);

  // Clean up registered teams for this tournament
  const teams = Store.get('teams') || [];
  const updatedTeams = teams.filter(tm => tm.tournamentId !== id);
  Store.set('teams', updatedTeams);

  // Clean up leaderboard for this tournament
  const lb = Store.get('leaderboard') || [];
  const updatedLb = lb.filter(l => l.tournamentId !== id);
  Store.set('leaderboard', updatedLb);

  closeModal('modal-edit-tournament');
  closeModal('modal-tournament-detail');
  Pages.tournaments();
  populateTournamentDropdowns();

  addNotification('all', `🗑️ Tournament "${t.name}" was deleted by ${Auth.current.displayName}.`, 'warning');
  Toast.success(`Tournament "${t.name}" deleted.`);
  broadcast('TOURNAMENT_DELETED', { id, name: t.name });
}

function openRegModal(tid) {
  const t = Store.find('tournaments', tid);
  if (!t) return;
  document.getElementById('reg-tournament-id').value = tid;
  document.getElementById('reg-tournament-name').textContent = t.name;
  document.getElementById('reg-entry-fee').textContent = 'FREE';
  const mode = t.gameMode;
  const playerCount = mode==='Squad'?4:mode==='Duo'?2:1;
  let playerFields = '';
  for(let i=1;i<=playerCount;i++){
    playerFields += `<div class="form-group"><label>Player ${i} Name</label><input type="text" id="reg-p${i}" placeholder="Player ${i}" ${i===1?'required':''}></div>`;
  }
  document.getElementById('reg-players-section').innerHTML = playerFields;
  openModal('modal-register-team');
}

function submitTeamReg() {
  const tid = document.getElementById('reg-tournament-id').value;
  const teamName = document.getElementById('reg-team-name').value.trim();
  const captain = document.getElementById('reg-captain').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  if (!teamName || !captain) { Toast.warn('Team name and captain required.'); return; }

  const t = Store.find('tournaments', tid);
  if (!t) return;
  if (t.currentTeams >= t.maxTeams) { Toast.error('Tournament is full!'); return; }

  const mode = t.gameMode;
  const pc = mode==='Squad'?4:mode==='Duo'?2:1;
  const players = [];
  for(let i=1;i<=pc;i++){
    const el = document.getElementById(`reg-p${i}`);
    if (el && el.value.trim()) players.push({ name: el.value.trim(), userId: null });
  }
  if (!players.length) players.push({ name: captain, userId: Auth.current?.id||null });

  const team = {
    id: uid(), tournamentId: tid, teamName, captainName: captain,
    captainId: Auth.current?.id||null, contactEmail: email,
    players, paymentStatus: 'free',
    registeredAt: ts(), totalPoints:0, totalKills:0
  };
  Store.push('teams', team);
  Store.update('tournaments', tid, { currentTeams: t.currentTeams+1 });
  addNotification(Auth.current?.id||'all', `✅ Team "${teamName}" registered for ${t.name}`, 'success');
  closeModal('modal-register-team');
  Pages.tournaments();
  Toast.success('Team registered successfully! 🎉');
  broadcast('TEAM_REGISTERED', { teamName, tournamentName: t.name });

  document.getElementById('reg-team-name').value='';
  document.getElementById('reg-captain').value='';
  document.getElementById('reg-email').value='';
}

/* === LIVE MATCHES (ROOMS) === */
Pages['live-matches'] = function() {
  const rooms = Store.get('matchRooms');
  const el = document.getElementById('page-live-matches');

  let html = `
    <div class="page-header">
      <div class="page-header-left"><h2>🎮 Match Rooms</h2><p>Active and upcoming match rooms</p></div>
      <div class="page-actions">
        ${Auth.isAdmin() ? `<button class="btn btn-cyan" onclick="openModal('modal-create-room')">+ Create Room</button>` : ''}
        <button class="btn btn-ghost" onclick="Pages['live-matches']()">⟳ Refresh</button>
      </div>

    </div>
  `;

  if (!rooms.length) {
    html += `<div class="card"><div class="empty-state"><div class="empty-icon">🎮</div><p>No match rooms yet. Create one to get started!</p></div></div>`;
  } else {
    html += `<div class="grid-auto">`;
    rooms.forEach(r => {
      html += `
      <div class="room-card ${r.status}" onclick="openLobby('${r.id}')" style="cursor:pointer">

        <div class="room-header">
          <div>
            <div class="room-code">${r.roomCode}</div>
            <div class="room-host">Host: ${r.hostName}</div>
          </div>
          ${statusBadgeHTML(r.status)}
        </div>
        <div class="room-details">
          <span class="room-detail">🗺️ ${r.map}</span>
          <span class="room-detail">⚔️ ${r.mode}</span>
          <span class="room-detail">🔒 ${r.password ? 'Password Protected' : 'Open'}</span>
        </div>
        <div class="room-players">
          <div class="players-label">Players Joined</div>
          <div class="players-bar"><div class="players-fill" style="width:${Math.round((r.players.length/r.maxPlayers)*100)}%"></div></div>
          <div class="players-count">${r.players.length}/${r.maxPlayers} players · Created ${timeSince(r.createdAt)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-cyan btn-sm" onclick="openLobby('${r.id}')">View Lobby</button>
          ${Auth.canJoin() && r.status==='waiting' && !r.players.find(p=>p.userId===Auth.current?.id) ?
            `<button class="btn btn-ghost btn-sm" onclick="joinRoom('${r.id}')">Join</button>` : ''}
          ${Auth.isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();endAndDeleteRoom('${r.id}')">🛑 End & Delete</button>` : ''}
          ${Auth.isAdmin() && r.status==='in_progress' ? `<button class="btn btn-gold btn-sm" onclick="openEnterStats(null,'${r.id}')">Enter Stats</button>` : ''}
        </div>
      </div>`;

    });
    html += `</div>`;
  }
  el.innerHTML = html;
};

function joinRoom(roomId) {
  if (!Auth.current) { Toast.warn('Please login first.'); return; }
  if (Auth.isAdmin()) {
    Toast.info('👑 Admin manages and spectates match rooms.');
    openLobby(roomId);
    return;
  }
  const room = Store.find('matchRooms', roomId);
  if (!room) return;
  if (room.players.find(p => p.userId === Auth.current.id)) { Toast.info('You are already in this room.'); openLobby(roomId); return; }
  if (room.players.length >= room.maxPlayers) { Toast.error('Room is full!'); return; }

  room.players.push({ userId: Auth.current.id, name: Auth.current.displayName, ready: false });

  // Auto-trigger 3-minute release timer when room becomes completely full
  if (room.players.length >= room.maxPlayers && !room.releaseCountdownStarted) {
    room.releaseCountdownStarted = true;
    room.releaseTimeTarget = Date.now() + (3 * 60 * 1000); // 3 mins
    addNotification('all', `🚨 Room ${room.roomCode} is FULL (${room.maxPlayers}/${room.maxPlayers})! Room details will be released in 3 minutes! Get ready!`, 'warning');
    Toast.warn(`🚨 Room is FULL! 3-minute details release timer started.`);
  }

  Store.save();
  addNotification('all', `👤 ${Auth.current.displayName} joined room ${room.roomCode}`, 'info');
  broadcast('PLAYER_JOINED', { roomId, playerName: Auth.current.displayName, roomCode: room.roomCode });
  Toast.success(`Joined room ${room.roomCode}! 🎮`);
  openLobby(roomId);
}

function joinRoomPrompt(roomId) {
  joinRoom(roomId);
}

function lockAndStartTimer(roomId) {
  const room = Store.find('matchRooms', roomId);
  if (!room) return;
  room.releaseCountdownStarted = true;
  room.releaseTimeTarget = Date.now() + (3 * 60 * 1000); // 3 mins
  Store.save();
  addNotification('all', `🔒 Lobby locked for room ${room.roomCode}! Room details will be released in 3 minutes!`, 'warning');
  Toast.warn('🔒 Lobby locked! 3-minute details release timer started.');
  openLobby(roomId);
}

function releaseDetailsNow(roomId) {
  const room = Store.find('matchRooms', roomId);
  if (!room) return;
  room.detailsReleased = true;
  room.releaseCountdownStarted = true;
  room.releaseTimeTarget = Date.now();
  Store.save();
  addNotification('all', `🔓 Room details for ${room.roomCode} have been RELEASED! Join Free Fire now!`, 'success');
  Toast.success('🔓 Room details released to players!');
  openLobby(roomId);
}

let lobbyTimerInterval = null;
let lobbyCountdownTarget = null;

function openLobby(roomId) {
  window._currentActiveLobbyId = roomId;
  const room = Store.find('matchRooms', roomId);
  if (!room) return;

  // Check 3-minute release timer
  const now = Date.now();
  if (room.releaseCountdownStarted && room.releaseTimeTarget && now >= room.releaseTimeTarget) {
    if (!room.detailsReleased) {
      room.detailsReleased = true;
      Store.save();
      addNotification('all', `🔓 Room details for ${room.roomCode} are RELEASED! Enter Free Fire now!`, 'success');
    }
  }

  const isDetailsVisible = room.detailsReleased || Auth.isAdmin();
  const isInRoom = room.players.find(p => p.userId === Auth.current?.id);
  const isHost   = room.hostId === Auth.current?.id;

  const playersHTML = room.players.map(p => `
    <div class="lobby-player ${p.ready?'ready':'not-ready'}">
      <span class="player-status-icon">${p.ready ? '✅' : '⏳'}</span>
      <span class="player-name">${p.name}${p.userId===room.hostId?' 👑':''}</span>
      <span class="player-ready-label ${p.ready?'ready':'not-ready'}">${p.ready?'READY':'NOT READY'}</span>
    </div>
  `).join('');

  const emptySlots = Math.max(0, room.maxPlayers - room.players.length);
  const emptyHTML  = Array(emptySlots).fill(`
    <div class="lobby-player" style="opacity:0.3">
      <span class="player-status-icon">⬜</span>
      <span class="player-name" style="color:var(--text-muted)">Waiting for player...</span>
    </div>
  `).join('');

  const elRoomCode  = document.getElementById('lobby-room-code');
  const elPassword  = document.getElementById('lobby-password');
  const elRoomCode2 = document.getElementById('lobby-room-code-2');
  const elMap       = document.getElementById('lobby-map');
  const elMode      = document.getElementById('lobby-mode');
  const elMax       = document.getElementById('lobby-max');
  const elHost      = document.getElementById('lobby-host');
  const elList      = document.getElementById('lobby-players-list');
  const elCount     = document.getElementById('lobby-player-count');
  const elBadge     = document.getElementById('lobby-status-badge');

  if (elRoomCode)  elRoomCode.textContent  = isDetailsVisible ? room.roomCode : '🔒 LOCKED (Releasing soon)';
  if (elPassword)  elPassword.textContent  = isDetailsVisible ? (room.password || '—') : '🔒 HIDDEN';
  if (elRoomCode2) elRoomCode2.textContent = isDetailsVisible ? room.roomCode : '🔒 HIDDEN';
  if (elMap)       elMap.textContent       = room.map;
  if (elMode)      elMode.textContent      = room.mode;
  if (elMax)       elMax.textContent       = room.maxPlayers;
  if (elHost)      elHost.textContent      = room.hostName;
  if (elList)      elList.innerHTML        = playersHTML + emptyHTML;
  if (elCount)     elCount.textContent     = `${room.players.length}/${room.maxPlayers}`;
  if (elBadge)     elBadge.innerHTML       = statusBadgeHTML(room.status);

  // Render Release Banner
  const bannerEl = document.getElementById('lobby-release-banner');
  if (bannerEl) {
    if (room.detailsReleased) {
      bannerEl.innerHTML = `
        <div style="background:rgba(90,169,255,0.1);border:1px solid rgba(90,169,255,0.35);border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px">
          <span style="font-size:22px">🔓</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--accent-green)">ROOM DETAILS RELEASED!</div>
            <div style="font-size:12px;color:var(--text-secondary)">Room Code & Password are unlocked. Copy details and enter Free Fire now!</div>
          </div>
        </div>`;
    } else if (room.releaseCountdownStarted && room.releaseTimeTarget && now < room.releaseTimeTarget) {
      const remainingSec = Math.ceil((room.releaseTimeTarget - now) / 1000);
      const m = String(Math.floor(remainingSec / 60)).padStart(2, '0');
      const s = String(remainingSec % 60).padStart(2, '0');
      bannerEl.innerHTML = `
        <div style="background:rgba(47,123,255,0.1);border:1px solid rgba(47,123,255,0.35);border-radius:8px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:22px">⏱️</span>
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--accent-gold)">LOBBY LOCKED — DETAILS RELEASING IN 3 MINS</div>
              <div style="font-size:12px;color:var(--text-secondary)">Room code & password will be revealed automatically when timer reaches 00:00</div>
            </div>
          </div>
          <div style="font-family:'Orbitron',sans-serif;font-size:20px;font-weight:700;color:var(--accent-gold);background:rgba(0,0,0,0.4);padding:6px 14px;border-radius:6px;border:1px solid rgba(47,123,255,0.3)">
            ${m}:${s}
          </div>
        </div>`;
    } else {
      bannerEl.innerHTML = `
        <div style="background:rgba(47,123,255,0.08);border:1px solid rgba(47,123,255,0.25);border-radius:8px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:22px">⏳</span>
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--accent-cyan)">WAITING FOR PLAYERS (${room.players.length}/${room.maxPlayers})</div>
              <div style="font-size:12px;color:var(--text-secondary)">Details auto-release 3 mins after lobby is full or locked by admin.</div>
            </div>
          </div>
          ${Auth.isAdmin() ? `
            <button class="btn btn-warning btn-sm" onclick="lockAndStartTimer('${room.id}')">🔒 Lock & 3m Timer</button>
          ` : ''}
        </div>`;
    }
  }

  // QR code
  const qrEl = document.getElementById('lobby-qr');
  qrEl.innerHTML = '';
  try {
    new QRCode(qrEl, { text: isDetailsVisible ? room.roomCode : 'LOCKED', width:100, height:100, colorDark:'#000', colorLight:'#fff' });
  } catch(e) { qrEl.textContent = isDetailsVisible ? room.roomCode : 'LOCKED'; }

  // Action buttons
  const actEl = document.getElementById('lobby-actions');
  let actHTML = '';
  if (isDetailsVisible) {
    actHTML += `
      <button class="btn btn-ghost btn-sm" onclick="copyToClipboard('${room.roomCode}','Room Code')">📋 Copy Code</button>
      <button class="btn btn-ghost btn-sm" onclick="copyToClipboard('${room.password}','Password')">🔑 Copy Password</button>
    `;
  }
  if (isInRoom && !isHost) {
    const myEntry = room.players.find(p => p.userId === Auth.current?.id);
    if (myEntry && !myEntry.ready) {
      actHTML += `<button class="btn btn-success btn-sm" onclick="markReady('${roomId}')">✅ Mark Ready</button>`;
    }
    actHTML += `<button class="btn btn-danger btn-sm" onclick="leaveRoom('${roomId}')">❌ Leave</button>`;
  }
  if (isInRoom) {
    actHTML += `<button class="btn btn-primary" id="play-ff-btn" onclick="ScreenShare.launchAndStream('${roomId}')" style="background:linear-gradient(135deg,#ff2e3f,#7a8ba3);box-shadow:0 0 24px rgba(255,46,63,0.5);font-size:14px;padding:12px 20px">
      🎮 PLAY FREE FIRE + STREAM
    </button>`;
  }
  if (isHost || Auth.isAdmin()) {
    if (!room.detailsReleased) {
      if (!room.releaseCountdownStarted) {
        actHTML += `<button class="btn btn-warning btn-sm" onclick="lockAndStartTimer('${roomId}')">🔒 Lock Lobby (3m Timer)</button>`;
      }
      actHTML += `<button class="btn btn-success btn-sm" onclick="releaseDetailsNow('${roomId}')">🔓 Release Details Now</button>`;
    }
    actHTML += `<button class="btn btn-ghost btn-sm" onclick="startMatch('${roomId}')">🚀 Start Match</button>`;
    if (room.status === 'in_progress') {
      actHTML += `<button class="btn btn-gold btn-sm" onclick="openEnterStats(null,'${roomId}')">📊 Enter Stats</button>`;
    }
    if (Auth.isAdmin()) {
      actHTML += `<button class="btn btn-danger btn-sm" onclick="endAndDeleteRoom('${roomId}')" style="background:linear-gradient(135deg, #ff2e3f, #ff2e3f);border:none;box-shadow:0 0 12px rgba(255,46,63,0.4)">🛑 End Match & Auto-Delete Room</button>`;
    }
  }

  if (!isInRoom && Auth.canJoin() && room.status === 'waiting') {
    actHTML += `<button class="btn btn-cyan btn-sm" onclick="joinRoom('${roomId}');openLobby('${roomId}')">Join Room</button>`;
  }
  actEl.innerHTML = actHTML;


  // Screen share live video streams section
  const liveSection = document.getElementById('lobby-live-streams');
  if (liveSection) {
    fetch(`/api/stream?roomId=${roomId}`)
      .then(res => res.json())
      .then(streams => {
        if (streams && streams.length) {
          liveSection.innerHTML = `
            <div class="neon-divider" style="margin:20px 0"></div>
            <div class="card-title mb-12" style="color:var(--accent-red);display:flex;align-items:center;gap:8px">
              <span style="width:10px;height:10px;border-radius:50%;background:var(--accent-red);animation:pulse-green 1s infinite"></span>
              🔴 LIVE GAMEPLAY STREAMS (${streams.length})
            </div>
            <div style="display:flex;gap:16px;flex-wrap:wrap">
              ${streams.map(s => `
                <div style="position:relative;background:#000;border:2px solid var(--accent-red);border-radius:10px;overflow:hidden;width:320px;height:190px;box-shadow:0 0 20px rgba(255,46,63,0.3)">
                  <div style="position:absolute;top:8px;left:8px;background:var(--accent-red);color:white;font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;letter-spacing:1px;z-index:2">🔴 LIVE FEED</div>
                  <div style="position:absolute;bottom:8px;left:8px;background:rgba(0,0,0,0.7);color:var(--accent-cyan);font-size:12px;font-weight:700;padding:3px 10px;border-radius:4px;z-index:2;border:1px solid rgba(47,123,255,0.3)">🎮 ${s.name}</div>
                  ${s.frame ? `<img src="${s.frame}" style="width:100%;height:100%;object-fit:contain;display:block" />` : `
                    <div style="background:#05070b;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:13px">Connecting video stream...</div>
                  `}
                </div>
              `).join('')}
            </div>`;
        } else {
          liveSection.innerHTML = '';
        }
      })
      .catch(() => {});
  }


  // Timer
  if (lobbyTimerInterval) clearInterval(lobbyTimerInterval);
  const timerEl = document.getElementById('lobby-timer');
  if (room.status === 'in_progress' && room.startedAt) {
    const matchLen = 25 * 60 * 1000;
    lobbyCountdownTarget = room.startedAt + matchLen;
    lobbyTimerInterval = setInterval(() => {
      if (timerEl) timerEl.textContent = countdownStr(lobbyCountdownTarget);
    }, 1000);
  } else {
    const defaultStart = room.createdAt + 15*60*1000;
    lobbyCountdownTarget = defaultStart;
    lobbyTimerInterval = setInterval(() => {
      if (timerEl) timerEl.textContent = countdownStr(lobbyCountdownTarget);
    }, 1000);
  }
  if (timerEl) timerEl.textContent = countdownStr(lobbyCountdownTarget);

  openModal('modal-lobby');

  // Inject live streams section if not already present
  const lobbyBody = document.querySelector('.lobby-body');
  if (lobbyBody && !document.getElementById('lobby-live-streams')) {
    const div = document.createElement('div');
    div.id = 'lobby-live-streams';
    lobbyBody.appendChild(div);
  }
}

function markReady(roomId) {
  const room = Store.find('matchRooms', roomId);
  if (!room) return;
  const player = room.players.find(p => p.userId === Auth.current?.id);
  if (player) {
    player.ready = true;
    Store.save();
    Toast.success('You are now ready! ✅');
    broadcast('PLAYER_READY', { roomId, playerName: Auth.current.displayName });
    openLobby(roomId);
    // Check if all ready
    if (room.players.length >= 2 && room.players.every(p => p.ready)) {
      Toast.info('All players ready! Admin can start the match.');
    }
  }
}

function leaveRoom(roomId) {
  const room = Store.find('matchRooms', roomId);
  if (!room) return;
  room.players = room.players.filter(p => p.userId !== Auth.current?.id);
  Store.save();
  closeModal('modal-lobby');
  Pages['live-matches']();
  Toast.info('You left the room.');
  broadcast('PLAYER_LEFT', { roomId, playerName: Auth.current.displayName });
}

function startMatch(roomId) {
  const room = Store.find('matchRooms', roomId);
  if (!room) return;
  Store.update('matchRooms', roomId, { status: 'in_progress', startedAt: ts() });
  addNotification('all', `🚀 Match ${room.roomCode} has started!`, 'warning');
  broadcast('MATCH_STARTED', { roomId, roomCode: room.roomCode });
  Toast.warn('⚡ Match started! Enter stats after the match.');
  closeModal('modal-lobby');
  openLobby(roomId);
}

function closeRoom(roomId) {
  endAndDeleteRoom(roomId);
}

function endAndDeleteRoom(roomId) {
  const room = Store.find('matchRooms', roomId);
  const code = room ? room.roomCode : '';

  if (lobbyTimerInterval) {
    clearInterval(lobbyTimerInterval);
    lobbyTimerInterval = null;
  }

  Store.remove('matchRooms', roomId);
  closeModal('modal-lobby');
  window._currentActiveLobbyId = null;

  if (window.Router && Router.current && Pages[Router.current]) {
    Pages[Router.current]();
  }

  addNotification('all', `🏁 Match room ${code} was ended and auto-deleted by admin.`, 'warning');
  Toast.success(`🏁 Match ended & room auto-deleted!`);
  broadcast('ROOM_DELETED', { roomId, roomCode: code });
}


/* ─── SCREEN SHARE MODULE ─────────────────────────────────── */
window._liveStreamers = {};

const ScreenShare = {
  stream:             null,
  roomId:             null,
  previewEl:          null,
  panelEl:            null,
  _frameCanvas:       null,
  _broadcastInterval: null,

  /* Direct entry point — called when player taps "Play Free Fire + Stream" */
  async launchAndStream(roomId) {
    this.roomId = roomId;
    await this._startCapture(roomId);
  },

  /* Show the launch/instructions modal */
  _showLaunchModal(roomId) {
    const room = Store.find('matchRooms', roomId);
    const modal = document.getElementById('modal-screen-share');
    if (!modal) return;

    document.getElementById('ss-room-code-display').textContent = room ? room.roomCode : roomId;
    document.getElementById('ss-start-btn').onclick = () => this._startCapture(roomId);
    document.getElementById('ss-open-ff-btn').onclick = () => this._openFreefire();
    openModal('modal-screen-share');
  },

  /* Try to open Free Fire app */
  _openFreefire() {
    Toast.info('🎮 Opening Free Fire app...');

    // Try deep link first (works on Android with Free Fire installed)
    const deepLinkAttempt = document.createElement('iframe');
    deepLinkAttempt.style.display = 'none';
    deepLinkAttempt.src = 'freefire://launch';
    document.body.appendChild(deepLinkAttempt);

    setTimeout(() => {
      try { document.body.removeChild(deepLinkAttempt); } catch(e) {}
    }, 2000);

    // Fallback: open Play Store / App Store after short delay
    setTimeout(() => {
      const isIOS     = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isAndroid = /Android/.test(navigator.userAgent);

      if (isIOS) {
        window.open('https://apps.apple.com/app/garena-free-fire/id1300146617', '_blank');
      } else if (isAndroid) {
        window.open('market://details?id=com.dts.freefireth', '_blank');
        setTimeout(() => window.open('https://play.google.com/store/apps/details?id=com.dts.freefireth', '_blank'), 500);
      } else {
        window.open('https://play.google.com/store/apps/details?id=com.dts.freefireth', '_blank');
        Toast.info('Open Free Fire on your mobile device to play.');
      }
    }, 1500);
  },

  /* Start screen capture using getDisplayMedia */
  async _startCapture(roomId) {
    closeModal('modal-screen-share');

    // Check browser support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      Toast.error('Screen sharing is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    try {
      Toast.info('🔴 Select Free Fire screen to start streaming...');

      // Request screen + audio capture
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 60 },
          width:     { ideal: 1280 },
          height:    { ideal: 720 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        preferCurrentTab: false,
      });

      this.stream  = stream;
      this.roomId  = roomId;

      // Show floating preview
      this._showPreviewPanel(stream, roomId);

      // Automatically launch Free Fire app
      this._openFreefire();

      // Setup hidden canvas for frame broadcasting
      this._frameCanvas = document.createElement('canvas');
      this._frameCanvas.width = 320;
      this._frameCanvas.height = 180;
      const ctx = this._frameCanvas.getContext('2d');

      // Start continuous frame broadcast to server /api/stream (5 FPS)
      if (this._broadcastInterval) clearInterval(this._broadcastInterval);
      this._broadcastInterval = setInterval(() => {
        if (!this.stream || !this.previewEl) return;
        try {
          ctx.drawImage(this.previewEl, 0, 0, 320, 180);
          const frame = this._frameCanvas.toDataURL('image/jpeg', 0.45);
          fetch('/api/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              roomId,
              userId: Auth.current?.id,
              name: Auth.current?.displayName,
              frame
            })
          }).catch(() => {});
        } catch(e) {}
      }, 200);

      // Broadcast event
      broadcast('SCREEN_SHARE_STARTED', {
        roomId,
        userId:      Auth.current?.id,
        displayName: Auth.current?.displayName,
      });

      addNotification('u1', `📺 ${Auth.current?.displayName} is now LIVE streaming in room ${Store.find('matchRooms', roomId)?.roomCode}`, 'warning');
      Toast.success(`🔴 You are now LIVE streaming your gameplay!`);

      // When stream ends (user stops sharing), clean up
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        this._stopCapture(roomId);
      });

    } catch (err) {
      if (err.name === 'NotAllowedError') {
        Toast.warn('Screen share permission canceled.');
      } else {
        Toast.error('Could not start screen share: ' + err.message);
      }
    }
  },


  /* Show the floating picture-in-picture preview panel */
  _showPreviewPanel(stream, roomId) {
    // Remove old panel if exists
    this._removePreviewPanel();

    const panel = document.createElement('div');
    panel.id = 'ss-preview-panel';
    panel.innerHTML = `
      <div id="ss-panel-header">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:8px;height:8px;border-radius:50%;background:#ff2e3f;animation:pulse-green 1s infinite"></div>
          <span style="font-family:'Orbitron',sans-serif;font-size:11px;font-weight:700;color:#ff2e3f;letter-spacing:1px">LIVE STREAMING</span>
        </div>
        <div style="display:flex;gap:6px">
          <button id="ss-pip-btn" title="Picture in Picture" style="background:rgba(47,123,255,0.2);border:1px solid rgba(47,123,255,0.3);color:#2f7bff;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px">⊡ PiP</button>
          <button id="ss-stop-btn" title="Stop streaming" style="background:rgba(255,46,63,0.2);border:1px solid rgba(255,46,63,0.3);color:#ff2e3f;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px">■ Stop</button>
        </div>
      </div>
      <video id="ss-preview-video" autoplay muted playsinline style="width:100%;height:calc(100% - 38px);object-fit:contain;background:#000;display:block"></video>
      <div id="ss-panel-footer">
        <span id="ss-timer-display" style="font-family:'Orbitron',sans-serif;font-size:11px;color:#2f7bff">00:00</span>
        <span style="font-size:11px;color:#a0aab8">Streaming to FF Arena</span>
      </div>
    `;

    document.body.appendChild(panel);
    this.panelEl = panel;

    // Attach stream to video
    const video = panel.querySelector('#ss-preview-video');
    video.srcObject = stream;
    this.previewEl = video;

    // PiP button
    panel.querySelector('#ss-pip-btn').addEventListener('click', async () => {
      if (!document.pictureInPictureEnabled) {
        Toast.warn('Picture-in-Picture not supported in this browser.');
        return;
      }
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await video.requestPictureInPicture();
          Toast.info('PiP mode activated — now switch to Free Fire!');
        }
      } catch(e) { Toast.warn('PiP mode unavailable.'); }
    });

    // Stop button
    panel.querySelector('#ss-stop-btn').addEventListener('click', () => {
      this._stopCapture(roomId);
    });

    // Make panel draggable
    this._makeDraggable(panel, panel.querySelector('#ss-panel-header'));

    // Start timer
    const startTime = Date.now();
    this._timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      const el = document.getElementById('ss-timer-display');
      if (el) el.textContent = `${m}:${s}`;
    }, 1000);
  },

  /* Stop capture and clean up */
  _stopCapture(roomId) {
    if (this._broadcastInterval) {
      clearInterval(this._broadcastInterval);
      this._broadcastInterval = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    clearInterval(this._timerInterval);
    this._removePreviewPanel();


    // Remove from live streamers
    if (window._liveStreamers[roomId]) {
      window._liveStreamers[roomId] = window._liveStreamers[roomId].filter(
        v => v.userId !== Auth.current?.id
      );
    }

    broadcast('SCREEN_SHARE_STOPPED', {
      roomId,
      userId:      Auth.current?.id,
      displayName: Auth.current?.displayName,
    });

    Toast.info('Screen sharing stopped.');
  },

  _removePreviewPanel() {
    const existing = document.getElementById('ss-preview-panel');
    if (existing) existing.remove();
    this.panelEl  = null;
    this.previewEl = null;
  },

  /* Make element draggable by a handle */
  _makeDraggable(el, handle) {
    let startX, startY, startLeft, startTop;
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', (e) => {
      startX    = e.clientX;
      startY    = e.clientY;
      startLeft = el.offsetLeft;
      startTop  = el.offsetTop;
      const onMove = (e) => {
        el.style.left = (startLeft + e.clientX - startX) + 'px';
        el.style.top  = (startTop  + e.clientY - startY) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  },
};

/* Update BroadcastChannel to handle screen share events */
if (channel) {
  const _baseHandler = channel.onmessage;
  channel.onmessage = (ev) => {
    _baseHandler && _baseHandler(ev);
    const { type, data } = ev.data || {};

    if (type === 'SCREEN_SHARE_STARTED') {
      if (!window._liveStreamers[data.roomId]) window._liveStreamers[data.roomId] = [];
      // Avoid duplicate entries
      if (!window._liveStreamers[data.roomId].find(v => v.userId === data.userId)) {
        window._liveStreamers[data.roomId].push({ userId: data.userId, name: data.displayName, ts: ts() });
      }
      Toast.warn(`📺 ${data.displayName} is now LIVE in the match room!`);
      // Refresh lobby if open
      const modal = document.getElementById('modal-lobby');
      if (modal && !modal.classList.contains('hidden')) {
        openLobby(data.roomId);
      }
    }

    if (type === 'SCREEN_SHARE_STOPPED') {
      if (window._liveStreamers[data.roomId]) {
        window._liveStreamers[data.roomId] = window._liveStreamers[data.roomId].filter(v => v.userId !== data.userId);
      }
      Toast.info(`📺 ${data.displayName} stopped screen sharing.`);
    }
  };
}

function createRoom() {
  if (!Auth.canManage()) {
    Toast.error('⛔ Only Admin or Co-Admin accounts can create match rooms.');
    return;
  }

  const map  = document.getElementById('room-map').value;
  const mode = document.getElementById('room-mode').value;
  const maxP = parseInt(document.getElementById('room-max-players').value) || 12;
  const tid  = document.getElementById('room-tournament').value;
  const code = genRoomCode();
  const pass = genPassword();

  // Admin NEVER plays any games — players roster starts empty for Admin created rooms
  const initialPlayers = [];


  const room = {
    id: uid(), roomCode: code,
    tournamentId: tid || null, matchId: null,
    hostId: Auth.current.id, hostName: Auth.current.displayName,
    map, mode, maxPlayers: maxP, password: pass,
    status: 'waiting',
    players: initialPlayers,
    detailsReleased: false,
    releaseCountdownStarted: false,
    releaseTimeTarget: null,
    createdAt: ts(), startedAt: null, completedAt: null
  };

  Store.push('matchRooms', room);
  addNotification('all', `🎮 New match room ${code} (Max ${maxP} Players) created by ${Auth.current.displayName}!`, 'info');
  broadcast('ROOM_CREATED', room);
  closeModal('modal-create-room');
  Pages['live-matches']();
  Toast.success(`Room ${code} created! (Max ${maxP} Players) 🎮`);
  setTimeout(() => openLobby(room.id), 300);
}


function populateTournamentDropdowns() {
  const tournaments = Store.filter('tournaments', t => t.status !== 'completed');
  const opts = `<option value="">— No Tournament —</option>` + tournaments.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  ['room-tournament','stats-tournament'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts;
  });
}

/* === LEADERBOARD === */
Pages.leaderboard = function() {
  const el = document.getElementById('page-leaderboard');
  const tournaments = Store.get('tournaments');
  const lb = Store.get('leaderboard');

  const tournFilter = document.getElementById('lb-tournament-filter')?.value || 'all';

  const filtLB = tournFilter === 'all' ? lb : lb.filter(l => l.tournamentId === tournFilter);
  const sortedTeam = [...filtLB].sort((a,b) => b.points - a.points);

  const tOpts = `<option value="all">All Tournaments</option>` + tournaments.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

  // Player stats (aggregate from matches)
  const playerStats = {};
  Store.get('matches').forEach(m => {
    Object.values(m.teamStats||{}).forEach(team => {
      (team.players||[]).forEach(p => {
        if (!playerStats[p.name]) playerStats[p.name] = { name:p.name, team:team.teamName, kills:0, assists:0, damage:0, headshots:0, survTime:0, matches:0 };
        const ps = playerStats[p.name];
        ps.kills    += p.kills||0;
        ps.assists  += p.assists||0;
        ps.damage   += p.damage||0;
        ps.headshots+= p.headshots||0;
        ps.matches  += 1;
      });
    });
  });
  const sortedPlayers = Object.values(playerStats).sort((a,b) => b.kills - a.kills);

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left"><h2>🏆 Leaderboard</h2><p>Rankings and stats across all tournaments</p></div>
      <div class="page-actions">
        <select id="lb-tournament-filter" class="form-group" style="margin:0;background:var(--bg-card);border:1px solid var(--border-dim);border-radius:6px;padding:9px 14px;color:var(--text-primary);font-family:Rajdhani,sans-serif;font-size:14px" onchange="Pages.leaderboard()">
          ${tOpts}
        </select>
      </div>
    </div>

    <div class="lb-tabs">
      <button class="lb-tab active" id="tab-team" onclick="switchLbTab('team')">🏅 Team Rankings</button>
      <button class="lb-tab" id="tab-player" onclick="switchLbTab('player')">⚡ Player Stats</button>
    </div>

    <div id="lb-team-view">
      <div class="card">
        <div class="table-wrapper">
          <table><thead><tr>
            <th>Rank</th><th>Team</th><th>Matches</th><th>Wins</th><th>Top 3</th>
            <th>Kills</th><th>K/D</th><th>Damage</th><th>Points</th>
          </tr></thead><tbody>
          ${sortedTeam.length ? sortedTeam.map((l,i) => `<tr>
            <td><span class="rank-badge rank-${i<3?i+1:'n'}">${i+1}</span></td>
            <td class="font-orbitron" style="font-size:13px">${escapeHtml(l.teamName)}</td>
            <td>${l.matchesPlayed}</td>
            <td style="color:var(--accent-gold)">${l.wins}</td>
            <td>${l.top3}</td>
            <td style="color:var(--accent-red);font-weight:700">${l.totalKills}</td>
            <td style="color:var(--accent-cyan)">${l.kdRatio}</td>
            <td>${(l.totalDamage||0).toLocaleString()}</td>
            <td style="color:var(--accent-gold);font-weight:700;font-family:'Orbitron',sans-serif">${l.points}</td>
          </tr>`).join('') : `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted)">No leaderboard data yet</td></tr>`}
          </tbody></table>
        </div>
      </div>
    </div>

    <div id="lb-player-view" style="display:none">
      <div class="card">
        <div class="table-wrapper">
          <table><thead><tr>
            <th>Rank</th><th>Player</th><th>Team</th><th>Kills</th><th>Assists</th>
            <th>Damage</th><th>Headshots</th><th>Matches</th>
          </tr></thead><tbody>
          ${sortedPlayers.length ? sortedPlayers.map((p,i) => `<tr>
            <td><span class="rank-badge rank-${i<3?i+1:'n'}">${i+1}</span></td>
            <td style="font-weight:600">${p.name}</td>
            <td style="color:var(--text-secondary)">${p.team}</td>
            <td style="color:var(--accent-red);font-weight:700">${p.kills}</td>
            <td>${p.assists}</td>
            <td>${(p.damage||0).toLocaleString()}</td>
            <td>${p.headshots}</td>
            <td>${p.matches}</td>
          </tr>`).join('') : `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">No player stats yet</td></tr>`}
          </tbody></table>
        </div>
      </div>
    </div>
  `;
};

function switchLbTab(tab) {
  document.getElementById('lb-team-view').style.display   = tab==='team'?'block':'none';
  document.getElementById('lb-player-view').style.display = tab==='player'?'block':'none';
  document.getElementById('tab-team').classList.toggle('active', tab==='team');
  document.getElementById('tab-player').classList.toggle('active', tab==='player');
}

/* === MY TEAM === */
Pages['my-team'] = function() {
  const el = document.getElementById('page-my-team');
  const u = Auth.current;
  const myTeams = Store.filter('teams', t => t.players.some(p => p.userId === u.id) || t.captainId === u.id);
  const ud = Store.find('users', u.id);

  const achieveHTML = ACHIEVEMENTS.map(a => {
    const unlocked = a.cond(ud||{});
    return `
    <div class="achievement-card ${unlocked?'unlocked':'locked'}">
      <div class="achievement-icon">${a.icon}</div>
      <div class="achievement-name">${a.name}</div>
      <div class="achievement-desc">${a.desc}</div>
      ${unlocked ? '<div style="margin-top:6px;font-size:10px;color:var(--accent-gold);font-weight:700">UNLOCKED</div>' : ''}
    </div>`;
  }).join('');

  const teamsHTML = myTeams.length ? myTeams.map(tm => {
    const t = Store.find('tournaments', tm.tournamentId);
    return `
    <div class="card mb-16">
      <div class="card-header">
        <div>
          <div class="font-orbitron" style="font-size:15px">${tm.teamName}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${t?t.name:'Unknown Tournament'}</div>
        </div>
        ${statusBadgeHTML(tm.paymentStatus)}
      </div>
      <div class="grid-2">
        <div>
          <div style="font-size:11px;color:var(--text-muted);letter-spacing:1px;margin-bottom:8px">PLAYERS</div>
          ${tm.players.map(p => `
            <div class="flex-center gap-8 mb-8">
              <div class="user-avatar" style="width:30px;height:30px;font-size:13px;background:linear-gradient(135deg,${avatarColor(p.name)},#7a8ba3)">${getInitial(p.name)}</div>
              <span style="font-size:13px">${p.name}</span>
              ${p.userId===u.id?'<span class="badge badge-info" style="font-size:9px">YOU</span>':''}
              ${p.userId===tm.captainId?'<span class="badge badge-gold" style="font-size:9px">CAPTAIN</span>':''}
            </div>
          `).join('')}
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);letter-spacing:1px;margin-bottom:8px">TEAM STATS</div>
          <div class="mb-8"><span style="color:var(--text-muted);font-size:12px">Total Points: </span><span style="color:var(--accent-gold);font-weight:700">${tm.totalPoints||0}</span></div>
          <div class="mb-8"><span style="color:var(--text-muted);font-size:12px">Total Kills: </span><span style="color:var(--accent-red);font-weight:700">${tm.totalKills||0}</span></div>
          <div><span style="color:var(--text-muted);font-size:12px">Payment: </span>${statusBadgeHTML(tm.paymentStatus)}</div>
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state"><div class="empty-icon">👥</div><p>You're not in any teams yet. Register for a tournament!</p><button class="btn btn-cyan mt-16" onclick="Router.navigate('tournaments')">Browse Tournaments</button></div>`;

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left"><h2>👥 My Team</h2><p>Your teams and achievements</p></div>
    </div>

    <div class="card mb-20">
      <div class="card-header"><span class="card-title">🏅 ACHIEVEMENTS</span></div>
      <div class="achievement-grid">${achieveHTML}</div>
    </div>

    <div class="card-title mb-12">🎮 MY TEAMS</div>
    ${teamsHTML}

    <div class="card mt-20">
      <div class="card-header"><span class="card-title">🔍 TEAM FINDER</span></div>
      <p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px">Looking for teammates? Connect with other players!</p>
      <div class="grid-auto" id="team-finder-list">
        ${Store.filter('users', u2 => u2.role==='player' && u2.id!==u.id).slice(0,6).map(p => `
          <div class="player-finder-card">
            <div class="pfc-header">
              <div class="pfc-avatar" style="background:linear-gradient(135deg,${avatarColor(p.displayName)},#7a8ba3)">${getInitial(p.displayName)}</div>
              <div>
                <div style="font-size:14px;font-weight:600">${p.displayName}</div>
                <div style="font-size:11px;color:var(--text-muted)">${p.playerId}</div>
              </div>
            </div>
            <div class="grid-2 mb-12" style="gap:8px">
              <div><div style="font-size:10px;color:var(--text-muted)">KILLS</div><div style="font-size:16px;font-weight:700;color:var(--accent-red)">${p.totalKills||0}</div></div>
              <div><div style="font-size:10px;color:var(--text-muted)">WINS</div><div style="font-size:16px;font-weight:700;color:var(--accent-gold)">${p.wins||0}</div></div>
            </div>
            <button class="btn btn-ghost btn-sm btn-full" onclick="invitePlayer('${p.id}')">📨 Invite</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
};

function invitePlayer(uid) {
  const player = Store.find('users', uid);
  if (!player) return;
  addNotification(uid, `📨 ${Auth.current.displayName} wants to team up with you!`, 'info');
  Toast.success(`Invite sent to ${player.displayName}!`);
}

function approveUser(id) {
  const user = Store.find('users', id);
  if (!user) return;

  Store.update('users', id, { status: 'active' });
  addNotification(id, `🎉 Congratulations @${user.username}! Your account has been APPROVED by Admin!`, 'success');
  Toast.success(`✅ Account @${user.username} APPROVED!`);
  broadcast('USER_APPROVED', { userId: id, username: user.username });
  if (Router.current === 'waiting-halls') Pages['waiting-halls']();
  else renderAdminPanel('pending');
}

function openRejectPlayerModal(id) {
  const u = Store.find('users', id);
  if (!u) return;

  document.getElementById('reject-user-id').value = id;
  document.getElementById('reject-player-display').textContent = `${u.displayName} (@${u.username}) · UID: ${u.playerId}`;
  document.getElementById('reject-player-email').textContent = u.email ? `📧 Notification will be sent to: ${u.email}` : '⚠️ No registered email address on file';
  document.getElementById('reject-preset-reason').selectedIndex = 0;
  document.getElementById('reject-reason-text').value = '';

  openModal('modal-reject-player');
}

function applyRejectPreset(val) {
  if (val) {
    document.getElementById('reject-reason-text').value = val;
  }
}

async function confirmRejectUser() {
  const id = document.getElementById('reject-user-id').value;
  const reason = document.getElementById('reject-reason-text').value.trim();
  const u = Store.find('users', id);

  if (!u) {
    Toast.error('Player not found.');
    return;
  }

  if (!reason) {
    Toast.warn('⚠️ Please enter a rejection reason / message to email to the player.');
    const el = document.getElementById('reject-reason-text');
    if (el) el.focus();
    return;
  }

  const btn = document.getElementById('btn-confirm-reject');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending Email & Removing...'; }

  try {
    const res = await fetch('/api/reject-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: id,
        reason,
        adminName: Auth.current?.displayName || 'Admin'
      })
    });

    const data = await res.json();
    if (btn) { btn.disabled = false; btn.textContent = '📩 Reject & Send Email'; }

    if (res.ok && data.status === 'ok') {
      Store.remove('users', id);
      closeModal('modal-reject-player');
      
      if (data.emailSent) {
        Toast.success(`❌ Player @${u.username} rejected. Notification email sent to ${u.email}!`);
      } else {
        Toast.warn(`❌ Player @${u.username} rejected. Notification logged.`);
      }

      broadcast('USER_DELETED', { userId: id, username: u.username });

      if (Router.current === 'waiting-halls') {
        Pages['waiting-halls']();
      } else {
        renderAdminPanel('pending');
      }
    } else {
      Toast.error(data.message || 'Failed to reject player.');
    }
  } catch(err) {
    if (btn) { btn.disabled = false; btn.textContent = '📩 Reject & Send Email'; }
    Store.remove('users', id);
    closeModal('modal-reject-player');
    Toast.success(`Player @${u.username} removed.`);
    if (Router.current === 'waiting-halls') Pages['waiting-halls']();
    else renderAdminPanel('pending');
  }
}

/* === WAITING HALLS (ADMIN / CO-ADMIN DEDICATED SECTION) === */
Pages['waiting-halls'] = function() {
  const el = document.getElementById('page-waiting-halls');
  if (!el) return;
  if (!Auth.canManage()) { el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔐</div><p>Access denied. Admin or Co-Admin authorization required.</p></div>`; return; }

  const pendings = Store.filter('users', u => u.status === 'pending');

  // Update sidebar badge
  const badge = document.getElementById('waiting-hall-count-badge');
  if (badge) {
    badge.textContent = pendings.length;
    badge.style.display = pendings.length > 0 ? 'inline-block' : 'none';
  }

  el.innerHTML = `
    <div class="page-header mb-24">
      <div class="page-header-left">
        <h2 style="color:var(--accent-gold);display:flex;align-items:center;gap:10px">
          ⏳ WAITING HALLS
          <span class="badge badge-gold" style="font-size:13px">${pendings.length} PENDING PLAYERS</span>
        </h2>
        <p>Review and allow new player registrations into the FF Arena platform</p>
      </div>
    </div>

    ${pendings.length ? `
      <div class="card" style="border:1px solid var(--accent-gold);box-shadow:0 0 25px rgba(47,123,255,0.15)">
        <div class="card-header">
          <span class="card-title" style="color:var(--accent-gold)">⏳ PLAYER APPROVAL QUEUE</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>AVATAR</th>
                <th>USERNAME</th>
                <th>DISPLAY NAME</th>
                <th>FF PLAYER UID</th>
                <th>REGISTERED EMAIL</th>
                <th>REGISTRATION TIME</th>
                <th>APPROVAL ACTION</th>
              </tr>
            </thead>
            <tbody>
              ${pendings.map(u => `
                <tr>
                  <td>
                    <div class="user-avatar" style="width:36px;height:36px;font-size:14px;background:linear-gradient(135deg,${avatarColor(u.displayName)},#7a8ba3)">
                      ${getInitial(u.displayName)}
                    </div>
                  </td>
                  <td style="font-weight:700;color:var(--accent-cyan)">@${u.username}</td>
                  <td style="font-weight:700">${u.displayName || u.username}</td>
                  <td><span class="font-orbitron" style="font-size:12px;color:var(--accent-gold);background:rgba(47,123,255,0.1);padding:4px 8px;border-radius:4px;border:1px solid rgba(47,123,255,0.3)">${u.playerId || 'N/A'}</span></td>
                  <td>${u.email || 'N/A'}</td>
                  <td style="color:var(--text-secondary);font-size:12px">${timeSince(u.createdAt)}</td>
                  <td>
                    <div style="display:flex;gap:8px">
                      <button class="btn btn-gold btn-sm" onclick="approveUser('${u.id}')">
                        ✅ Allow Entry
                      </button>
                      <button class="btn btn-danger btn-sm" onclick="openRejectPlayerModal('${u.id}')">
                        ❌ Reject & Email
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : `
      <div class="empty-state" style="padding:60px;background:rgba(15,23,42,0.6);border-radius:12px;border:1px dashed rgba(47,123,255,0.3)">
        <div class="empty-icon" style="font-size:48px">🎉</div>
        <h3 style="color:var(--accent-gold);margin-top:12px">Waiting Hall is Empty!</h3>
        <p style="color:var(--text-secondary)">All player registrations have been processed and allowed into the platform.</p>
      </div>
    `}
  `;
};

/* === ADMIN PANEL === */
Pages['admin'] = function() {

  const el = document.getElementById('page-admin');
  if (!Auth.canManage()) { el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔐</div><p>Access denied. Admin authorization required.</p></div>`; return; }
  const pendingCount = Store.filter('users', u => u.status === 'pending').length;
  renderAdminPanel(pendingCount > 0 ? 'pending' : 'users');
};

function renderAdminPanel(tab) {
  const el = document.getElementById('page-admin');
  if (!Auth.canManage()) return;

  const pendingUsers = Store.filter('users', u => u.status === 'pending');

  const tabsHTML = `
    <div class="page-header">
      <div class="page-header-left"><h2>🔐 Admin Panel</h2><p>Full platform management</p></div>
    </div>
    <div class="admin-section-tabs">
      <button class="admin-tab ${tab==='pending'?'active':''}" onclick="renderAdminPanel('pending')" style="${pendingUsers.length?'border-color:var(--accent-gold);color:var(--accent-gold)':''}">
        ⏳ Pending (${pendingUsers.length})
      </button>
      <button class="admin-tab ${tab==='users'?'active':''}" onclick="renderAdminPanel('users')">👤 Users</button>
      <button class="admin-tab ${tab==='rooms'?'active':''}" onclick="renderAdminPanel('rooms')">🎯 Rooms</button>
      <button class="admin-tab ${tab==='stats'?'active':''}" onclick="renderAdminPanel('stats')">📈 Stats Entry</button>
      <button class="admin-tab ${tab==='sessions'?'active':''}" onclick="renderAdminPanel('sessions')">🔑 Sessions</button>
    </div>
  `;

  let body = '';

  if (tab === 'pending') {
    const pendings = Store.filter('users', u => u.status === 'pending');
    body = `
      <div class="card mb-20" style="border:1px solid var(--accent-gold)">
        <div class="card-header">
          <span class="card-title" style="color:var(--accent-gold)">⏳ PENDING ACCOUNT APPROVALS (${pendings.length})</span>
        </div>
        ${pendings.length ? `
          <div class="table-wrapper">
            <table><thead><tr>
              <th>Player ID</th><th>Username</th><th>Email</th><th>Registered</th><th>Actions</th>
            </tr></thead><tbody>
            ${pendings.map(u => `<tr>
              <td class="font-orbitron" style="font-size:12px;color:var(--accent-cyan)">${u.playerId}</td>
              <td style="font-weight:700">@${u.username}</td>
              <td>${u.email || 'N/A'}</td>
              <td style="color:var(--text-secondary)">${timeSince(u.createdAt)}</td>
              <td>
                <div style="display:flex;gap:8px">
                  <button class="btn btn-gold btn-sm" onclick="approveUser('${u.id}')">✅ Approve Account</button>
                  <button class="btn btn-danger btn-sm" onclick="openRejectPlayerModal('${u.id}')">❌ Reject & Email</button>
                </div>
              </td>
            </tr>`).join('')}
            </tbody></table>
          </div>
        ` : `<div class="empty-state" style="padding:40px"><div class="empty-icon">🎉</div><p>No pending account approvals! All registrations are processed.</p></div>`}
      </div>
    `;
  }
  else if (tab === 'users') {

    const users = Store.get('users');
    body = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">USER MANAGEMENT</span>
          <button class="btn btn-primary btn-sm" onclick="openModal('modal-create-user')">+ Add User</button>
        </div>
        <div class="table-wrapper">
          <table><thead><tr>
            <th>Player ID</th><th>Username</th><th>Display Name</th><th>Role</th>
            <th>Status</th><th>Last Login</th><th>Actions</th>
          </tr></thead><tbody>
          ${users.map(u => `<tr>
            <td class="font-orbitron" style="font-size:12px;color:var(--accent-cyan)">${u.playerId}</td>
            <td>${u.username}</td>
            <td>${u.displayName}</td>
            <td>${roleBadgeHTML(u.role)}</td>
            <td>${statusBadgeHTML(u.status||'active')}</td>
            <td style="color:var(--text-secondary)">${u.lastLogin?timeSince(u.lastLogin):'Never'}</td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${u.status === 'pending' ? `<button class="btn btn-gold btn-sm" onclick="approveUser('${u.id}')">✅ Approve</button>` : ''}
                ${Auth.isAdmin() && u.id!=='u1' && u.username!=='admin' ? (
                  u.role === 'coadmin' ?
                    `<button class="btn btn-warning btn-sm" style="background:rgba(245,158,11,0.2);color:var(--accent-gold);border:1px solid rgba(245,158,11,0.4)" onclick="setUserRole('${u.id}', 'player')">👤 Demote to Player</button>` :
                    `<button class="btn btn-gold btn-sm" style="background:linear-gradient(135deg, #f59e0b, #d97706);color:#000;font-weight:700" onclick="setUserRole('${u.id}', 'coadmin')">⭐ Make Co-Admin</button>`
                ) : ''}
                <button class="btn btn-ghost btn-sm" onclick="editUser('${u.id}')">Edit</button>
                ${Auth.isAdmin() && u.id!=='u1' && u.username!=='admin' ? `
                  <button class="btn btn-danger btn-sm" onclick="toggleBanUser('${u.id}')">${u.status==='banned'?'Unban':'Ban'}</button>
                  <button class="btn btn-ghost btn-sm" style="color:var(--accent-red);border-color:rgba(255,46,63,0.3)" onclick="deleteUser('${u.id}')">🗑️ Delete</button>
                ` : ''}
              </div>

            </td>

          </tr>`).join('')}
          </tbody></table>
        </div>
      </div>
    `;
  }

  else if (tab === 'rooms') {
    const rooms = Store.get('matchRooms');
    body = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">MATCH ROOMS</span>
          <button class="btn btn-primary btn-sm" onclick="openModal('modal-create-room')">+ Create Room</button>
        </div>
        <div class="table-wrapper">
          <table><thead><tr>
            <th>Room Code</th><th>Host</th><th>Map</th><th>Mode</th>
            <th>Players</th><th>Status</th><th>Created</th><th>Actions</th>
          </tr></thead><tbody>
          ${rooms.length ? rooms.map(r => `<tr>
            <td class="font-orbitron" style="font-size:12px;color:var(--accent-cyan)">${r.roomCode}</td>
            <td>${r.hostName}</td>
            <td>${r.map}</td>
            <td>${r.mode}</td>
            <td>${r.players.length}/${r.maxPlayers}</td>
            <td>${statusBadgeHTML(r.status)}</td>
            <td style="color:var(--text-secondary)">${timeSince(r.createdAt)}</td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn btn-ghost btn-sm" onclick="openLobby('${r.id}')">Lobby</button>
                ${r.status!=='completed' ? `<button class="btn btn-danger btn-sm" onclick="closeRoom('${r.id}');renderAdminPanel('rooms')">Close</button>` : ''}
                ${r.status==='in_progress'||r.status==='waiting' ? `<button class="btn btn-gold btn-sm" onclick="openEnterStats(null,'${r.id}')">Stats</button>` : ''}
              </div>
            </td>
          </tr>`).join('') : `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">No rooms created yet</td></tr>`}
          </tbody></table>
        </div>
      </div>
    `;
  }

  else if (tab === 'stats') {
    const matches = Store.get('matches');
    body = `
      <div class="card mb-20">
        <div class="card-header">
          <span class="card-title">STATS ENTRY</span>
          <button class="btn btn-primary btn-sm" onclick="openEnterStats()">+ Enter Match Stats</button>
        </div>
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">Record match results and update leaderboard automatically.</p>
        <div class="table-wrapper">
          <table><thead><tr>
            <th>Match ID</th><th>Room Code</th><th>Teams</th><th>Winner</th><th>MVP</th><th>Status</th><th>Date</th>
          </tr></thead><tbody>
          ${matches.length ? matches.map(m => `<tr>
            <td class="font-orbitron" style="font-size:11px;color:var(--text-muted)">${m.id}</td>
            <td style="color:var(--accent-cyan)">${m.roomCode}</td>
            <td>${Object.values(m.teamStats||{}).map(t=>t.teamName).join(' vs ')}</td>
            <td style="color:var(--accent-gold)">${m.teamStats?.[m.winner]?.teamName||'—'}</td>
            <td>${m.mvp?`${m.mvp.name} (${m.mvp.kills}K)`:'—'}</td>
            <td>${statusBadgeHTML(m.status)}</td>
            <td style="color:var(--text-secondary)">${fmtDate(m.playedAt)}</td>
          </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">No matches recorded yet</td></tr>`}
          </tbody></table>
        </div>
      </div>
    `;
  }

  // Financial tab removed — no payment gateway in this version

  else if (tab === 'sessions') {
    const users = Store.filter('users', u => u.lastLogin);
    body = `
      <div class="card">
        <div class="card-header"><span class="card-title">ACTIVE SESSIONS</span></div>
        <div class="table-wrapper">
          <table><thead><tr>
            <th>User</th><th>Role</th><th>Last Login</th><th>Player ID</th>
          </tr></thead><tbody>
          ${users.map(u => `<tr>
            <td>
              <div class="flex-center gap-8">
                <div class="user-avatar" style="width:30px;height:30px;font-size:12px;background:linear-gradient(135deg,${avatarColor(u.displayName)},#7a8ba3)">${getInitial(u.displayName)}</div>
                <div>
                  <div style="font-size:13px;font-weight:600">${u.displayName}</div>
                  <div style="font-size:11px;color:var(--text-muted)">@${u.username}</div>
                </div>
              </div>
            </td>
            <td>${roleBadgeHTML(u.role)}</td>
            <td style="color:var(--text-secondary)">${timeSince(u.lastLogin)}</td>
            <td class="font-orbitron" style="font-size:12px;color:var(--accent-cyan)">${u.playerId}</td>
          </tr>`).join('')}
          </tbody></table>
        </div>
        <div class="mt-16" style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-danger" onclick="confirmResetData()">⚠️ Reset All Data</button>
        </div>
      </div>
    `;
  }

  el.innerHTML = tabsHTML + body;
}

function setUserRole(id, newRole) {
  const u = Store.find('users', id);
  if (!u) return;
  if (!Auth.isAdmin()) {
    Toast.error('⛔ Only the Super Admin can promote or demote Co-Admins.');
    return;
  }
  if (u.id === 'u1' || u.username === 'admin') {
    Toast.error('Cannot change role of primary Super Admin.');
    return;
  }

  const roleLabel = newRole === 'coadmin' ? 'Co-Admin' : (newRole === 'player' ? 'Player' : newRole);
  if (!confirm(`Are you sure you want to change @${u.username}'s role to ${roleLabel}?`)) {
    return;
  }

  Store.update('users', id, { role: newRole });
  renderAdminPanel('users');
  Toast.success(`User @${u.username} is now ${roleLabel}! 🛡️`);
  addNotification(id, `⭐ Your account role has been updated to ${roleLabel} by Admin!`, 'success');
  broadcast('USER_UPDATED', { userId: id, role: newRole });
}

function editUser(id) {
  const u = Store.find('users', id);
  if (!u) return;
  document.getElementById('edit-user-id').value    = id;
  document.getElementById('edit-user-display').value = u.displayName;
  document.getElementById('edit-user-role').value  = u.role;
  document.getElementById('edit-user-password').value = '';
  openModal('modal-edit-user');
}

function saveEditUser() {
  const id      = document.getElementById('edit-user-id').value;
  const display = document.getElementById('edit-user-display').value.trim();
  const role    = document.getElementById('edit-user-role').value;
  const pass    = document.getElementById('edit-user-password').value;
  if (!display) { Toast.warn('Display name required.'); return; }
  const patch = { displayName: display, role };
  if (pass) patch.password = pass;
  Store.update('users', id, patch);
  closeModal('modal-edit-user');
  renderAdminPanel('users');
  Toast.success('User updated!');
}

function toggleBanUser(id) {
  const u = Store.find('users', id);
  if (!u) return;
  const newStatus = u.status === 'banned' ? 'active' : 'banned';
  Store.update('users', id, { status: newStatus });
  renderAdminPanel('users');
  Toast.warn(`User ${u.displayName} ${newStatus === 'banned' ? 'banned' : 'unbanned'}.`);
}

function deleteUser(id) {
  const u = Store.find('users', id);
  if (!u) return;
  if (u.id === 'u1' || u.username === 'admin') {
    Toast.error('Cannot delete primary Admin account.');
    return;
  }

  if (!confirm(`Are you sure you want to permanently delete user @${u.username} (${u.displayName})?`)) {
    return;
  }

  Store.remove('users', id);

  // Clean up user references in match rooms if any
  const rooms = Store.get('matchRooms') || [];
  rooms.forEach(r => {
    if (r.players && r.players.some(p => p.userId === id)) {
      r.players = r.players.filter(p => p.userId !== id);
    }
  });
  Store.save();

  broadcast('USER_DELETED', { userId: id, username: u.username });
  renderAdminPanel('users');
  Toast.info(`User @${u.username} deleted.`);
}


function createUser() {
  const username = document.getElementById('new-user-username').value.trim();
  const display  = document.getElementById('new-user-display').value.trim();
  const password = document.getElementById('new-user-password').value;
  const role     = document.getElementById('new-user-role').value;
  if (!username || !display || !password) { Toast.warn('All fields required.'); return; }
  if (isUsernameTaken(username)) { Toast.error(`Username "${username}" is already taken.`); return; }


  const users  = Store.get('users');
  const nextId = users.length + 1;
  const user   = {
    id: uid(), username, password, displayName: display, role, status: 'active',
    playerId: `FF-2026-${String(nextId).padStart(3,'0')}`,
    createdAt: ts(), lastLogin: null,
    totalKills:0, totalAssists:0, totalDamage:0, bestKills:0, totalHeadshots:0, top3:0, wins:0
  };
  Store.push('users', user);
  closeModal('modal-create-user');
  renderAdminPanel('users');
  Toast.success(`User @${username} created!`);
  document.getElementById('new-user-username').value='';
  document.getElementById('new-user-display').value='';
  document.getElementById('new-user-password').value='';
}

function markPaid(payId) {
  Store.update('payments', payId, { status:'paid', paidAt: ts(), transactionId: 'TXN-'+Date.now().toString(36).toUpperCase() });
  renderAdminPanel('financial');
  Toast.success('Payment marked as paid!');
  broadcast('PAYMENT_UPDATED', { payId });
}

function exportPaymentsCSV() {
  const payments = Store.get('payments');
  const rows = [['Team','Tournament','Amount','Status','Date','Transaction ID']];
  payments.forEach(p => {
    const t = Store.find('tournaments', p.tournamentId);
    rows.push([p.teamName, t?t.name:'—', p.amount, p.status, p.paidAt?fmtDate(p.paidAt):'—', p.transactionId||'—']);
  });
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ff_arena_payments.csv';
  a.click();
  Toast.success('CSV exported!');
}

function confirmResetData() {
  document.getElementById('confirm-msg').textContent = 'Are you sure you want to reset ALL data? This cannot be undone.';
  document.getElementById('confirm-action-btn').onclick = () => {
    Store.reset();
    closeModal('modal-confirm');
    Toast.warn('All data has been reset to defaults.');
    setTimeout(() => { showApp(); Router.navigate('dashboard'); }, 500);
  };
  openModal('modal-confirm');
}

/* === ENTER MATCH STATS === */
function openEnterStats(matchId, roomId) {
  populateTournamentDropdowns();
  const teams = Store.get('teams');

  // Pre-fill room code if provided
  const room = roomId ? Store.find('matchRooms', roomId) : null;
  document.getElementById('stats-room-code').value = room ? room.roomCode : '';

  // Team selects
  const teamOpts = teams.map(t => `<option value="${t.id}" data-players='${JSON.stringify(t.players)}'>${t.teamName}</option>`).join('');
  document.getElementById('stats-team-a').innerHTML = teamOpts;
  document.getElementById('stats-team-b').innerHTML = teamOpts;
  if (teams.length > 1) document.getElementById('stats-team-b').selectedIndex = 1;

  renderStatsForms();
  openModal('modal-enter-stats');
}

function renderStatsForms() {
  const teamAId = document.getElementById('stats-team-a').value;
  const teamBId = document.getElementById('stats-team-b').value;
  const teamA   = Store.find('teams', teamAId);
  const teamB   = Store.find('teams', teamBId);

  ['a','b'].forEach(side => {
    const team = side==='a' ? teamA : teamB;
    if (!team) return;
    const container = document.getElementById(`stats-form-${side}`);
    container.innerHTML = `
      <div class="card-title mb-12" style="color:var(--accent-cyan)">${team.teamName}</div>
      <div class="form-row mb-12">
        <div class="form-group"><label>Placement (1 = 1st)</label><input type="number" id="place-${side}" min="1" max="16" value="${side==='a'?1:2}"></div>
      </div>
      <div class="stat-entry-grid">
      ${team.players.map((p,i) => `
        <div class="player-stat-card">
          <h5>${p.name}</h5>
          <div class="form-group"><label>Kills</label><input type="number" id="k-${side}-${i}" value="0" min="0"></div>
          <div class="form-group"><label>Assists</label><input type="number" id="a-${side}-${i}" value="0" min="0"></div>
          <div class="form-group"><label>Damage</label><input type="number" id="d-${side}-${i}" value="0" min="0"></div>
          <div class="form-group"><label>Headshots</label><input type="number" id="h-${side}-${i}" value="0" min="0"></div>
          <div class="form-group"><label>Survival (mm:ss)</label><input type="text" id="s-${side}-${i}" value="10:00" placeholder="10:00"></div>
        </div>
      `).join('')}
      </div>
    `;
  });
}

function submitMatchStats() {
  const teamAId = document.getElementById('stats-team-a').value;
  const teamBId = document.getElementById('stats-team-b').value;
  const tid     = document.getElementById('stats-tournament').value;
  const roomCode= document.getElementById('stats-room-code').value.trim();
  if (!teamAId || !teamBId || teamAId === teamBId) { Toast.warn('Select two different teams.'); return; }

  const teams = { a: Store.find('teams', teamAId), b: Store.find('teams', teamBId) };
  const matchStats = {};

  ['a','b'].forEach(side => {
    const team = teams[side];
    const placement = parseInt(document.getElementById(`place-${side}`).value)||1;
    const players = team.players.map((p,i) => ({
      name:      p.name,
      kills:     parseInt(document.getElementById(`k-${side}-${i}`)?.value)||0,
      assists:   parseInt(document.getElementById(`a-${side}-${i}`)?.value)||0,
      damage:    parseInt(document.getElementById(`d-${side}-${i}`)?.value)||0,
      headshots: parseInt(document.getElementById(`h-${side}-${i}`)?.value)||0,
      survivalTime: document.getElementById(`s-${side}-${i}`)?.value||'0:00',
      position:  placement
    }));

    const totalKills  = players.reduce((s,p)=>s+(p.kills||0),0);
    const totalDamage = players.reduce((s,p)=>s+(p.damage||0),0);
    const plPts = calcPlacementPts(placement);

    matchStats[side==='a'?teamAId:teamBId] = {
      teamName: team.teamName,
      players, placement,
      kills: totalKills, damage: totalDamage,
      totalKills, totalDamage,
      placementPoints: plPts, killPoints: totalKills, bonusPoints: 0,
      totalPoints: plPts + totalKills,
    };
  });

  // Add team kill bonus
  const pointsA = matchStats[teamAId].totalKills;
  const pointsB = matchStats[teamBId].totalKills;
  if (pointsA > pointsB) matchStats[teamAId].bonusPoints = 2;
  else if (pointsB > pointsA) matchStats[teamBId].bonusPoints = 2;
  matchStats[teamAId].totalPoints += matchStats[teamAId].bonusPoints;
  matchStats[teamBId].totalPoints += matchStats[teamBId].bonusPoints;

  const winnerKey = matchStats[teamAId].placement < matchStats[teamBId].placement ? teamAId : teamBId;

  const matchRecord = {
    id: uid(), roomCode: roomCode||genRoomCode(),
    tournamentId: tid||null,
    teamStats: matchStats,
    winner: winnerKey,
    mvp: determineMVP({ teamStats: matchStats }),
    status: 'confirmed',
    playedAt: ts(), confirmedBy: Auth.current.id
  };

  Store.push('matches', matchRecord);
  updateLeaderboardFromMatch(matchRecord);

  // Update room status if found
  if (roomCode) {
    const room = Store.findWhere('matchRooms', r => r.roomCode === roomCode);
    if (room) Store.update('matchRooms', room.id, { status:'completed', completedAt:ts() });
  }

  // Update team totals
  [teamAId, teamBId].forEach(tid2 => {
    const st = matchStats[tid2];
    const team = Store.find('teams', tid2);
    if (team) {
      Store.update('teams', tid2, {
        totalPoints: (team.totalPoints||0) + st.totalPoints,
        totalKills:  (team.totalKills||0)  + st.totalKills
      });
    }
  });

  addNotification('all', `📊 Match stats confirmed! Winner: ${matchStats[winnerKey].teamName} 🏆`, 'success');
  broadcast('STATS_UPDATED', { matchId: matchRecord.id });

  closeModal('modal-enter-stats');
  Toast.success('Match stats saved and leaderboard updated! 🏆');
  Router.navigate('leaderboard');
}

/* ─── 16. BROADCAST LISTENER ─────────────────────────────── */
if (channel) {
  channel.onmessage = (ev) => {
    const { type, data } = ev.data;
    switch (type) {
      case 'ROOM_CREATED':
        Store.data.matchRooms.push(data);
        Toast.info(`🎮 New room ${data.roomCode} created!`);
        updateNotifBadge();
        if (Router.current === 'live-matches') Pages['live-matches']();
        if (Router.current === 'dashboard')    Pages.dashboard();
        break;
      case 'PLAYER_JOINED':
        Toast.info(`👤 ${data.playerName} joined ${data.roomCode}`);
        if (Router.current === 'live-matches') Pages['live-matches']();
        break;
      case 'MATCH_STARTED':
        Toast.warn(`⚡ Match ${data.roomCode} started!`);
        break;
      case 'STATS_UPDATED':
        if (Router.current === 'leaderboard') Pages.leaderboard();
        break;
      case 'TOURNAMENT_UPDATED':
        if (Router.current === 'tournaments') Pages.tournaments();
        break;
    }
  };
}

/* ─── 17. CREATE TOURNAMENT ──────────────────────────────── */
function createTournament() {
  if (!Auth.canManage()) {
    Toast.error('⛔ Only Admin or Co-Admin accounts can create tournaments.');
    return;
  }

  const name     = document.getElementById('t-name').value.trim();
  const mode     = document.getElementById('t-mode').value;
  const map      = document.getElementById('t-map').value;
  const maxTeams = parseInt(document.getElementById('t-maxteams').value)||8;
  const regDeadline = document.getElementById('t-deadline').value;
  const tDate    = document.getElementById('t-date').value;

  if (!name || !regDeadline || !tDate) { Toast.warn('Please fill all required fields.'); return; }

  // Sanitize name
  const safeName = escapeHtml(name);

  // Parse schedule
  const schedule = [];
  const rounds = ['Quarter Finals','Semi Finals','Grand Finals'];
  rounds.forEach((r,i) => {
    const dateEl = document.getElementById(`t-sched-date-${i}`);
    const timeEl = document.getElementById(`t-sched-time-${i}`);
    if (dateEl?.value) schedule.push({ round:r, date:dateEl.value, time:timeEl?.value||'18:00' });
  });

  const tourn = {
    id: uid(), name, gameMode:mode, map,
    maxTeams, currentTeams:0, registrationDeadline:regDeadline, tournamentDate:tDate,
    status:'registration', schedule, createdAt:ts()
  };

  Store.push('tournaments', tourn);
  addNotification('all', `🏆 New tournament "${safeName}" is now open for registration!`, 'info');
  broadcast('TOURNAMENT_CREATED', tourn);
  closeModal('modal-create-tournament');
  Pages.tournaments();
  Toast.success('Tournament created! 🏆');
  populateTournamentDropdowns();
}

/* ─── 19. CHAT MODULE ────────────────────────────────────── */
const CHAT_KEY = 'ff_arena_chat_v2';
const EMOJIS   = ['😀','😂','🔥','💀','🎮','🏆','⚡','🎯','💪','👑','🤝','💥','😤','😎','🙌','👏','🚀','❤️','💯','✅','😈','🤣','😭','🥵','🥶','😡','👻','💣','🎉','🎊','🫡','🤙'];

const Chat = {
  isOpen:   false,
  activeTab: 'global',
  unreadCount: 0,
  typingTimer: null,
  typingActive: false,

  /* ── Storage ── */
  getMessages(tab) {
    if (!Store.data) return [];
    if (!Store.data.chats) Store.data.chats = { global:[], room:[], tourney:[] };
    return Store.data.chats[tab] || [];
  },

  saveMessage(tab, msg) {
    if (!Store.data) return;
    if (!Store.data.chats) Store.data.chats = { global:[], room:[], tourney:[] };
    if (!Store.data.chats[tab]) Store.data.chats[tab] = [];
    Store.data.chats[tab].push(msg);
    if (Store.data.chats[tab].length > 200) {
      Store.data.chats[tab] = Store.data.chats[tab].slice(-200);
    }
    Store.save();
  },

  /* ── Init ── */
  init() {
    const fab       = document.getElementById('chat-fab');
    const panel     = document.getElementById('chat-panel');
    const closeBtn  = document.getElementById('chat-close-btn');
    const sendBtn   = document.getElementById('chat-send-btn');
    const input     = document.getElementById('chat-input');
    const emojiBtn  = document.getElementById('emoji-toggle-btn');
    const picker    = document.getElementById('emoji-picker');

    if (!fab) return;

    // Show FAB only when logged in
    fab.classList.add('visible');

    // FAB toggle
    fab.addEventListener('click', () => this.toggle());
    closeBtn.addEventListener('click', () => this.close());

    // Send on button
    sendBtn.addEventListener('click', () => this.send());

    // Send on Enter (Shift+Enter = new line)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    });

    // Typing broadcast
    input.addEventListener('input', () => {
      this.autoResize(input);
      this.broadcastTyping();
    });

    // Emoji picker populate
    const grid = document.getElementById('emoji-grid');
    grid.innerHTML = EMOJIS.map(em => `<div class="emoji-item" onclick="Chat.insertEmoji('${em}')">${em}</div>`).join('');

    // Emoji toggle
    emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      picker.classList.toggle('open');
    });
    // Close picker on outside click
    document.addEventListener('click', (e) => {
      if (!picker.contains(e.target) && e.target !== emojiBtn) {
        picker.classList.remove('open');
      }
    });

    // BroadcastChannel listener
    if (channel) {
      const origHandler = channel.onmessage;
      channel.onmessage = (ev) => {
        origHandler && origHandler(ev);
        const { type, data } = ev.data;
        if (type === 'CHAT_MESSAGE') {
          Chat.saveMessage(data.tab, data.msg);
          if (!Chat.isOpen || Chat.activeTab !== data.tab) {
            Chat.unreadCount++;
            Chat.updateUnreadBadge();
          } else {
            Chat.renderMessages();
          }
        }
        if (type === 'CHAT_TYPING') {
          if (data.userId !== Auth.current?.id) {
            Chat.showTyping(data.displayName);
          }
        }
      };
    }

    // Render initial messages
    this.renderMessages();

    // Add welcome system message if no messages exist
    if (this.getMessages('global').length === 0) {
      const welcomeMsg = {
        id: uid(), tab:'global', userId:'system', displayName:'FF Arena',
        text:'👋 Welcome to FF Arena Chat! Say hello to your fellow players.', 
        type:'system', ts: ts()
      };
      this.saveMessage('global', welcomeMsg);
    }
  },

  /* ── Toggle / Open / Close ── */
  toggle() {
    this.isOpen ? this.close() : this.open();
  },

  open() {
    this.isOpen = true;
    document.getElementById('chat-panel').classList.add('open');
    this.unreadCount = 0;
    this.updateUnreadBadge();
    this.renderMessages();
    setTimeout(() => document.getElementById('chat-input')?.focus(), 300);
  },

  close() {
    this.isOpen = false;
    document.getElementById('chat-panel').classList.remove('open');
    document.getElementById('emoji-picker').classList.remove('open');
  },

  /* ── Tab Switching ── */
  switchTab(tab) {
    this.activeTab = tab;
    ['global','room','tourney'].forEach(t => {
      document.getElementById(`chat-tab-${t}`)?.classList.toggle('active', t === tab);
    });
    this.renderMessages();
  },

  /* ── Send Message ── */
  send() {
    const input = document.getElementById('chat-input');
    const text  = input.value.trim();
    if (!text || !Auth.current) return;

    const msg = {
      id:          uid(),
      tab:         this.activeTab,
      userId:      Auth.current.id,
      displayName: Auth.current.displayName,
      text,
      type:        'user',
      ts:          ts()
    };

    this.saveMessage(this.activeTab, msg);
    broadcast('CHAT_MESSAGE', { tab: this.activeTab, msg });
    this.renderMessages();

    input.value = '';
    this.autoResize(input);
    document.getElementById('emoji-picker').classList.remove('open');
  },

  /* ── Render Messages ── */
  renderMessages() {
    const container = document.getElementById('chat-messages-list');
    if (!container) return;

    const msgs = this.getMessages(this.activeTab);
    if (!msgs.length) {
      container.innerHTML = `
        <div class="chat-empty">
          <div class="empty-emoji">💬</div>
          <p>No messages in ${this.tabLabel(this.activeTab)}.<br>Start the conversation!</p>
        </div>`;
      return;
    }

    const me = Auth.current?.id;
    container.innerHTML = msgs.map(m => {
      if (m.type === 'system') {
        return `<div class="msg-row"><div class="msg-bubble system">${m.text}</div></div>`;
      }
      const isOwn  = m.userId === me;
      const color  = avatarColor(m.displayName);
      const initial = getInitial(m.displayName);
      const timeStr = this.formatMsgTime(m.ts);
      return `
        <div class="msg-row ${isOwn ? 'own' : ''}">
          <div class="msg-avatar" style="background:linear-gradient(135deg,${color},#7a8ba3)">${initial}</div>
          <div class="msg-content">
            <div class="msg-name">${isOwn ? 'You' : escapeHtml(m.displayName)}</div>
            <div class="msg-bubble ${isOwn ? 'own' : 'other'}">${this.escapeHTML(m.text)}</div>
            <div class="msg-time">${timeStr}</div>
          </div>
        </div>`;
    }).join('');

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
  },

  /* ── Emoji ── */
  insertEmoji(em) {
    const input = document.getElementById('chat-input');
    input.value += em;
    input.focus();
    document.getElementById('emoji-picker').classList.remove('open');
  },

  /* ── Typing ── */
  broadcastTyping() {
    if (this.typingActive) return;
    this.typingActive = true;
    broadcast('CHAT_TYPING', { userId: Auth.current?.id, displayName: Auth.current?.displayName });
    setTimeout(() => { this.typingActive = false; }, 2500);
  },

  showTyping(name) {
    const el   = document.getElementById('chat-typing');
    const nameEl = document.getElementById('chat-typing-name');
    if (!el) return;
    if (nameEl) nameEl.textContent = name;
    el.classList.add('visible');
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => el.classList.remove('visible'), 3000);
  },

  /* ── Unread Badge ── */
  updateUnreadBadge() {
    const badge = document.getElementById('chat-unread');
    if (!badge) return;
    if (this.unreadCount > 0) {
      badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
      badge.classList.add('has-unread');
    } else {
      badge.classList.remove('has-unread');
    }
  },

  /* ── Helpers ── */
  tabLabel(tab) {
    return { global:'Global Chat', room:'Room Chat', tourney:'Tournament Chat' }[tab] || tab;
  },

  formatMsgTime(ms) {
    const d = new Date(ms);
    const h = String(d.getHours()).padStart(2,'0');
    const m = String(d.getMinutes()).padStart(2,'0');
    return `${h}:${m}`;
  },

  escapeHTML(str) {
    return str
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/\n/g,'<br>');
  },

  autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 90) + 'px';
  },
};

/* === EDIT PROFILE PAGE === */
Pages['edit-profile'] = function() {
  const u = Auth.current;
  if (!u) return;
  const freshUser = Store.find('users', u.id) || u;
  const el = document.getElementById('page-edit-profile');
  if (!el) return;

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h2>👤 My Profile Settings</h2>
        <p>Manage your gaming profile, account details, and password recovery settings</p>
      </div>
    </div>

    <div class="grid-2">
      <!-- Left Column: User Summary Badge -->
      <div class="card" style="text-align:center;padding:32px 20px">
        <div class="user-avatar" style="width:84px;height:84px;font-size:34px;margin:0 auto 16px;background:linear-gradient(135deg, ${avatarColor(freshUser.displayName)}, #7a8ba3);display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:700;box-shadow:0 0 24px rgba(47,123,255,0.4)">
          ${getInitial(freshUser.displayName)}
        </div>
        <h3 class="font-orbitron" style="font-size:20px;color:var(--text-primary)">${freshUser.displayName}</h3>
        <p style="color:var(--accent-cyan);font-size:13px;margin-top:4px">@${freshUser.username}</p>
        <div style="margin-top:16px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap">
          ${roleBadgeHTML(freshUser.role)}
          <span class="badge badge-success">ACTIVE</span>
        </div>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border-dim);font-size:12px;color:var(--text-muted)">
          Member since ${fmtDate(freshUser.createdAt)}
        </div>
      </div>

      <!-- Right Column: Profile Form -->
      <div class="card">
        <div class="card-header"><span class="card-title">✏️ ACCOUNT DETAILS</span></div>
        <form id="form-page-edit-profile">
          <div class="form-group">
            <label>DISPLAY NAME *</label>
            <input type="text" id="page-edit-displayname" value="${freshUser.displayName || freshUser.username}" required>
          </div>

          <div class="form-group">
            <label>FREE FIRE PLAYER ID</label>
            <input type="text" id="page-edit-playerid" value="${freshUser.playerId || ''}" placeholder="e.g. 123456789">
          </div>

          <button type="submit" class="btn btn-gold btn-full btn-lg" style="margin-top:20px">
            💾 SAVE PROFILE CHANGES
          </button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('form-page-edit-profile').onsubmit = handlePageSaveProfile;
};

function handlePageSaveProfile(e) {
  e.preventDefault();
  const u = Auth.current;
  if (!u) return;

  const displayName = document.getElementById('page-edit-displayname').value.trim();
  const playerId    = document.getElementById('page-edit-playerid').value.trim();

  if (!displayName) {
    Toast.error('Display name cannot be empty.');
    return;
  }

  const patch = {
    displayName,
    playerId: playerId || u.playerId
  };

  Store.update('users', u.id, patch);
  Object.assign(Auth.current, patch);
  
  buildSidebar();
  Pages['edit-profile']();
  Toast.success('✅ Profile updated successfully!');
  broadcast('USER_UPDATED', { userId: u.id, displayName });
}



/* === CHALLENGES MODULE === */
Pages.challenges = function() {
  const challenges = Store.get('challenges') || [];
  const u = Auth.current;
  const el = document.getElementById('page-challenges');
  if (!el) return;

  let cardsHTML = '';
  if (!challenges.length) {
    cardsHTML = `<div class="card"><div class="empty-state"><div class="empty-icon">⚔️</div><p>No active challenges yet. Be the first to issue a challenge!</p></div></div>`;
  } else {
    cardsHTML = `<div class="grid-auto">` + challenges.map(c => {
      const isMine = u && c.challengerId === u.id;
      const isOpponent = u && c.opponentId === u.id;
      const isOpen = c.status === 'open';
      const isAccepted = c.status === 'accepted';

      let actionsHTML = '';
      if (isOpen) {
        if (!isMine) {
          actionsHTML = `<button class="btn btn-cyan btn-sm" onclick="acceptChallenge('${c.id}')">⚔️ Accept Challenge</button>`;
        }
        if (isMine || Auth.isAdmin()) {
          actionsHTML += ` <button class="btn btn-danger btn-sm" onclick="cancelChallenge('${c.id}')">✕ Delete</button>`;
        }
      } else if (isAccepted) {
        actionsHTML = `<span class="badge badge-success">ACCEPTED by ${c.opponentName}</span>`;
        if (isMine || isOpponent || Auth.isAdmin()) {
          actionsHTML += ` <button class="btn btn-danger btn-sm" onclick="cancelChallenge('${c.id}')">✕ Delete</button>`;
        }
      }

      return `
        <div class="card" style="border:1px solid ${isOpen ? 'rgba(47,123,255,0.3)' : 'rgba(90,169,255,0.3)'};position:relative;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
            <div>
              <div class="font-orbitron" style="font-size:16px;font-weight:700;color:var(--text-primary)">
                ⚔️ ${c.challengerName}'s Challenge
              </div>
              <div style="font-size:12px;color:var(--accent-cyan);margin-top:2px">${c.gameMode} · 🗺️ ${c.map}</div>
            </div>
            ${statusBadgeHTML(c.status)}
          </div>

          <div style="margin-bottom:12px;padding:10px 14px;background:rgba(0,0,0,0.3);border-radius:6px;font-size:13px;color:var(--text-secondary)">
            <div><strong>Stake / Prize:</strong> <span style="color:var(--accent-gold);font-weight:700">${c.stake ? c.stake + ' Coins' : 'FREE / FOR GLORY'}</span></div>
            ${c.note ? `<div style="margin-top:4px;font-style:italic">"${c.note}"</div>` : ''}
            ${c.opponentName ? `<div style="margin-top:4px;color:var(--accent-green)">Opponent: <strong>${c.opponentName}</strong></div>` : ''}
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
            <span style="font-size:11px;color:var(--text-muted)">Created ${timeSince(c.createdAt)}</span>
            <div>${actionsHTML}</div>
          </div>
        </div>
      `;
    }).join('') + `</div>`;
  }

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h2>⚔️ Player & Admin Challenges</h2>
        <p>Issue 1v1, 2v2, or 4v4 challenges or accept open duels!</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-gold" onclick="openModal('modal-create-challenge')">⚔️ Create Challenge</button>
        <button class="btn btn-ghost" onclick="Pages.challenges()">⟳ Refresh</button>
      </div>
    </div>

    ${cardsHTML}
  `;
};

function createChallenge() {
  const u = Auth.current;
  if (!u) { Toast.warn('Please login to create a challenge.'); return; }

  const mode  = document.getElementById('challenge-mode').value;
  const map   = document.getElementById('challenge-map').value;
  const stake = parseInt(document.getElementById('challenge-stake').value) || 0;
  const note  = document.getElementById('challenge-note').value.trim();

  const challenge = {
    id: uid(),
    challengerId: u.id,
    challengerName: u.displayName || u.username,
    gameMode: mode,
    map: map,
    stake: stake,
    note: note,
    status: 'open',
    opponentId: null,
    opponentName: null,
    createdAt: ts()
  };

  const challenges = Store.get('challenges') || [];
  challenges.unshift(challenge);
  Store.set('challenges', challenges);

  addNotification('all', `⚔️ ${u.displayName} issued a new ${mode} Challenge!`, 'warning');
  Toast.success('⚔️ Challenge created and posted live!');
  closeModal('modal-create-challenge');
  Pages.challenges();
  broadcast('CHALLENGE_CREATED', challenge);
}

function acceptChallenge(id) {
  const u = Auth.current;
  if (!u) { Toast.warn('Please login to accept challenge.'); return; }

  const challenges = Store.get('challenges') || [];
  const challenge = challenges.find(c => c.id === id);
  if (!challenge) return;

  if (challenge.challengerId === u.id) {
    Toast.warn('You cannot accept your own challenge!');
    return;
  }

  challenge.status = 'accepted';
  challenge.opponentId = u.id;
  challenge.opponentName = u.displayName || u.username;

  Store.set('challenges', challenges);
  addNotification(challenge.challengerId, `⚔️ ${u.displayName} ACCEPTED your ${challenge.gameMode} challenge!`, 'success');
  Toast.success(`⚔️ You accepted ${challenge.challengerName}'s challenge!`);
  Pages.challenges();
  broadcast('CHALLENGE_ACCEPTED', challenge);
}

function cancelChallenge(id) {
  let challenges = Store.get('challenges') || [];
  challenges = challenges.filter(c => c.id !== id);
  Store.set('challenges', challenges);
  Toast.info('Challenge deleted.');
  Pages.challenges();
}

/* ─── 18. INIT ───────────────────────────────────────────── */
async function init() {


  await Store.init();
  initParticles();
  initClock();


  // Login, Signup, Reset Password & Edit Profile forms
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('signup-form').addEventListener('submit', handleSignup);
  document.getElementById('signup-username').addEventListener('input', checkUsernameAvailability);
  ['signup-username', 'signup-email', 'signup-email-otp', 'signup-displayname', 'signup-playerid', 'signup-password', 'signup-confirm-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { el.style.borderColor = ''; });
  });
  document.getElementById('reset-find-form').addEventListener('submit', handleResetFindAccount);
  document.getElementById('reset-verify-form').addEventListener('submit', handleResetVerifyAnswer);
  const editForm = document.getElementById('form-edit-profile');
  if (editForm) editForm.addEventListener('submit', handleSaveProfile);





  // Sidebar nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      if (page) {
        Router.navigate(page);
        // Mobile: close sidebar
        document.querySelector('.sidebar').classList.remove('open');
        document.querySelector('.sidebar-overlay').classList.remove('open');
      }
    });
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    Auth.logout();
  });

  // Mobile sidebar toggle
  document.getElementById('mobile-toggle').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
    document.querySelector('.sidebar-overlay').classList.toggle('open');
  });
  document.querySelector('.sidebar-overlay').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.remove('open');
    document.querySelector('.sidebar-overlay').classList.remove('open');
  });

  // Notification bell
  document.getElementById('notif-bell-btn').addEventListener('click', () => {
    Router.navigate('dashboard');
    setTimeout(() => {
      const feed = document.getElementById('notif-feed-dash');
      if (feed) feed.scrollIntoView({ behavior:'smooth' });
    }, 100);
  });

  // Create room & create challenge forms
  document.getElementById('form-create-room').addEventListener('submit', (e) => { e.preventDefault(); createRoom(); });
  const cForm = document.getElementById('form-create-challenge');
  if (cForm) cForm.addEventListener('submit', (e) => { e.preventDefault(); createChallenge(); });


  // Modal close buttons
  document.querySelectorAll('.modal-close, [data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      if (modal) modal.classList.add('hidden');
    });
  });

  // Click outside to close modals
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // Lobby copy buttons
  document.getElementById('lobby-copy-code').addEventListener('click', () => {
    copyToClipboard(document.getElementById('lobby-room-code').textContent, 'Room Code');
  });
  document.getElementById('lobby-copy-pass').addEventListener('click', () => {
    copyToClipboard(document.getElementById('lobby-password').textContent, 'Password');
  });

  // Stats form team change
  document.getElementById('stats-team-a').addEventListener('change', renderStatsForms);
  document.getElementById('stats-team-b').addEventListener('change', renderStatsForms);

  // Populate tournament dropdowns
  populateTournamentDropdowns();

  // Check session
  if (Auth.init()) {
    showApp();
    Chat.init();
  } else {
    showLogin();
  }
}

// Also init chat after login
const _origShowApp = window.showApp;

document.addEventListener('DOMContentLoaded', init);
