/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK ADMIN — core
   Firebase wiring, admin allowlist gate, router, and shared UI helpers.

   DESIGN NOTE — why a single-file HTML app rather than React+Vite:
   RankSpark itself ships as one self-contained HTML file. Matching that means
   the admin can be hosted anywhere (Firebase Hosting, a static bucket, even
   opened locally) with no build step, no node_modules and no version drift
   between the two codebases. The tradeoff is no JSX/HMR; for a ~15-screen
   internal tool that is a good trade. Everything below is plain ES modules,
   so porting to Vite later is a copy-paste, not a rewrite.

   MOCK MODE
   With no Firebase config the whole app runs against an in-memory dataset so
   every screen can be reviewed, clicked and demoed before real keys exist.
   Nothing is faked once real config is supplied — the same code paths run
   against Firestore.
   ═══════════════════════════════════════════════════════════════════════════ */

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const CFG_KEY = 'rsadmin-firebase-config';

export const state = {
  ready: false,
  live: false,          // true once a real Firebase project is attached
  user: null,
  isAdmin: false,
  fb: null,             // { app, auth, db, storage, mods }
  route: 'dashboard',
  cache: new Map()
};

/* ─── tiny DOM helpers ───────────────────────────────────────────────── */
export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

export const fmt = {
  n: v => (v ?? 0).toLocaleString('en-IN'),
  money: v => '₹' + (v ?? 0).toLocaleString('en-IN'),
  pct: v => (v ?? 0).toFixed(1) + '%',
  date: v => {
    if (!v) return '—';
    const d = v.toDate ? v.toDate() : new Date(v);
    return isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  },
  dt: v => {
    if (!v) return '—';
    const d = v.toDate ? v.toDate() : new Date(v);
    return isNaN(d) ? '—' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  },
  ago: v => {
    if (!v) return '—';
    const d = v.toDate ? v.toDate() : new Date(v);
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  },
  bytes: b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB'
};

/* ─── icons (inline, no icon-font dependency) ────────────────────────── */
const ICONS = {
  bolt: 'M13 2 4 13h6l-1 9 9-12h-6z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  book: 'M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-2H4zM20 4h-6a3 3 0 0 0-3 3v13a3 3 0 0 1 3-2h6z',
  tag: 'M20.6 13.4 12 22l-9-9V4h9zM7.5 7.5h.01',
  card: 'M2 7h20v12H2zM2 11h20',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9',
  radio: 'M12 12h.01M8.5 8.5a5 5 0 0 0 0 7M15.5 15.5a5 5 0 0 0 0-7M5.5 5.5a9 9 0 0 0 0 13M18.5 18.5a9 9 0 0 0 0-13',
  bell: 'M18 10a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8M10 21h4',
  msg: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  mail: 'M4 4h16v16H4zM4 6l8 6 8-6',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6',
  cone: 'M12 2 4 20h16zM9 12h6',
  chart: 'M4 19V5M4 19h17M7 15l3-4 3 2 5-6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2h-2.6v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 4.6 15H4.4v-2.6h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1 1.8-1.8.1.1A1.7 1.7 0 0 0 10.5 6.6V6.4h2.6v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2V15z',
  search: 'M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13M16 16l5 5',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12l4 4L19 6',
  x: 'M6 6l12 12M18 6 6 18',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 8h.01M11 12h1v4h1',
  warn: 'M12 3 2 20h20zM12 9v5M12 17h.01',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  menu: 'M4 6h16M4 12h16M4 18h16',
  refresh: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  dl: 'M12 3v12M7 11l5 5 5-5M4 21h16',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4'
};
export const ico = (n, sz = 16) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
     stroke-linecap="round" stroke-linejoin="round" style="width:${sz}px;height:${sz}px"
     aria-hidden="true"><path d="${ICONS[n] || ICONS.info}"/></svg>`;

/* ─── toasts ─────────────────────────────────────────────────────────── */
export function toast(msg, kind = 'ok') {
  let w = $('.toast-wrap');
  if (!w) { w = document.createElement('div'); w.className = 'toast-wrap'; document.body.appendChild(w); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.setAttribute('role', 'status');
  t.innerHTML = ico(kind === 'bad' ? 'warn' : 'check', 15) + `<span>${esc(msg)}</span>`;
  w.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 3200);
}

/* ─── confirmation that cannot be clicked through by muscle memory ───── */
export function confirmTyped({ title, body, word = 'CONFIRM', danger = true }) {
  return new Promise(resolve => {
    const scrim = document.createElement('div');
    scrim.className = 'scrim on';
    scrim.style.display = 'grid';
    scrim.style.placeItems = 'center';
    scrim.style.padding = '20px';
    scrim.innerHTML = `
      <div class="card" style="width:min(440px,100%)" role="alertdialog" aria-modal="true">
        <div class="card-h"><div><h2>${esc(title)}</h2></div></div>
        <div class="card-b">
          <p style="margin:0 0 14px;font-size:13px;color:var(--tx-2);line-height:1.6">${body}</p>
          <div class="field">
            <label>Type <b class="mono" style="color:var(--tx)">${esc(word)}</b> to continue</label>
            <input id="cf-in" autocomplete="off" spellcheck="false" placeholder="${esc(word)}">
          </div>
        </div>
        <div class="drawer-f">
          <button class="btn btn-g" id="cf-no">Cancel</button>
          <button class="btn ${danger ? 'btn-d' : 'btn-p'}" id="cf-yes" disabled>Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(scrim);
    const inp = $('#cf-in', scrim), yes = $('#cf-yes', scrim);
    inp.focus();
    inp.addEventListener('input', () => { yes.disabled = inp.value.trim() !== word; });
    const done = v => { scrim.remove(); resolve(v); };
    $('#cf-no', scrim).onclick = () => done(false);
    yes.onclick = () => done(true);
    scrim.addEventListener('click', e => { if (e.target === scrim) done(false); });
    document.addEventListener('keydown', function k(e) {
      if (!document.body.contains(scrim)) { document.removeEventListener('keydown', k); return; }
      if (e.key === 'Escape') { done(false); document.removeEventListener('keydown', k); }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   MOCK BACKEND
   Realistic shapes so every screen is reviewable before Firebase exists.
   ═══════════════════════════════════════════════════════════════════════ */
const D = n => new Date(Date.now() - n * 86400000).toISOString();
export const MOCK = {
  admins: { 'demo-admin': { email: 'admin@rankspark.app', role: 'owner', addedAt: D(90) } },
  config: {
    app: {
      configVersion: 7,
      maintenance: { enabled: false, message: '', allowedUids: [], scheduledStart: null, scheduledEnd: null },
      featureFlags: { leaderboard: true, rankedSubmissions: true, paperLab: true, cloudSync: true, presence: false },
      minAppVersion: 0
    },
    pricing: {
      plans: [
        { id: 'spark', name: 'Spark', price: 0, interval: 'forever', order: 0, badge: '', archived: false,
          features: ['2 Physics + 1 Chemistry volume', '1 mock test / week', '20 PYQs weekly', 'Basic analytics'] },
        { id: 'blaze', name: 'Blaze', price: 149, interval: 'month', order: 1, badge: 'Most Popular', archived: false,
          stripePriceId: 'price_blaze_monthly',
          features: ['Full exam library', '8 mocks / month', '30-day analytics', 'Unlimited custom practice'] },
        { id: 'inferno', name: 'Inferno', price: 399, interval: 'month', order: 2, badge: '', archived: false,
          stripePriceId: 'price_inferno_monthly',
          features: ['Everything unlimited', 'Topic-level diagnosis', 'All exam streams', 'Priority support'] }
      ]
    }
  },
  books: [
    { id: 'hcv-1', name: 'HC Verma Vol 1', description: 'Concepts of Physics — mechanics and waves.',
      subjects: ['Physics'], exams: ['JEE Main', 'JEE Advanced'], tier: 'free', active: true,
      questionCount: 812, family: 'exemplar', source: 'zip', updatedAt: D(3) },
    { id: 'ncert-chem-12', name: 'NCERT Chemistry XII', description: 'Full NCERT class 12 chemistry.',
      subjects: ['Chemistry'], exams: ['NEET UG', 'JEE Main'], tier: 'paid', active: true,
      questionCount: 640, family: 'chemistry_module', source: 'metadata', updatedAt: D(9) },
    { id: 'allen-bio', name: 'Allen Biology Module', description: 'Allen NEET biology question bank.',
      subjects: ['Biology'], exams: ['NEET UG'], tier: 'plan', active: true,
      questionCount: 1180, family: 'allen_index', source: 'zip', updatedAt: D(14) },
    { id: 'aiims-pyq', name: 'AIIMS PYQ Archive', description: 'Previous-year AIIMS papers.',
      subjects: ['Physics', 'Chemistry', 'Biology'], exams: ['NEET UG'], tier: 'paid', active: false,
      questionCount: 430, family: 'aiims', source: 'metadata', updatedAt: D(28) }
  ],
  users: Array.from({ length: 46 }, (_, i) => {
    const plans = ['spark', 'spark', 'spark', 'blaze', 'blaze', 'inferno'];
    const names = ['Aarav Sharma','Diya Patel','Vihaan Reddy','Ananya Iyer','Arjun Nair','Ishita Rao',
                   'Kabir Singh','Meera Joshi','Rohan Gupta','Saanvi Menon','Aditya Bose','Nisha Verma'];
    return {
      uid: 'u_' + (1000 + i),
      profile: { displayName: names[i % names.length] + (i > 11 ? ' ' + (i + 1) : ''),
                 email: 'user' + i + '@example.com', photoURL: '' },
      plan: plans[i % plans.length],
      status: i % 17 === 0 ? 'suspended' : 'active',
      progress: { totalXp: 400 + i * 137, rankedXp: 120 + i * 61, level: 1 + (i % 24),
                  streak: i % 12, totalTests: 3 + (i % 40), accuracy: 44 + (i % 45) },
      createdAt: D(120 - i * 2),
      lastActive: D(i % 9)
    };
  }),
  payments: Array.from({ length: 18 }, (_, i) => ({
    id: 'pay_' + (9000 + i),
    uid: 'u_' + (1000 + (i % 46)),
    customer: 'user' + (i % 46) + '@example.com',
    amount: [149, 149, 399, 1199, 2999][i % 5],
    plan: ['Blaze', 'Blaze', 'Inferno', 'Blaze annual', 'Inferno annual'][i % 5],
    status: i % 11 === 0 ? 'refunded' : i % 7 === 0 ? 'failed' : 'paid',
    createdAt: D(i * 2)
  })),
  sessions: Array.from({ length: 7 }, (_, i) => ({
    id: 's_' + i,
    uid: 'u_' + (1000 + i),
    name: ['Aarav Sharma','Guest','Diya Patel','Vihaan Reddy','Guest','Ananya Iyer','Arjun Nair'][i],
    view: ['runtime','home','analytics','practice','question-bank','runtime','home'][i],
    device: i % 3 === 0 ? 'desktop' : 'mobile',
    startedAt: Date.now() - (i + 1) * 420000,
    lastSeen: Date.now() - i * 9000
  })),
  notifications: [
    { id: 'n1', title: 'New book added', body: 'Allen Biology Module is now live.', audience: 'all',
      status: 'sent', sentAt: D(2), opens: 318, delivered: 1204 },
    { id: 'n2', title: 'Your streak is about to break', body: 'Practise today to keep it alive.',
      audience: 'inactive7', status: 'sent', sentAt: D(5), opens: 96, delivered: 210 }
  ],
  messages: [
    { id: 'm1', text: 'New JEE Main 2026 mock series is live.', style: 'promo', placement: 'banner',
      audience: 'all', enabled: true, startAt: D(1), endAt: null, ctaLabel: 'Explore', ctaHref: '#', updatedAt: 3 }
  ],
  content: [
    { slug: 'about', title: 'About RankSpark', status: 'published', updatedAt: D(20),
      body: '# About RankSpark\n\nRankSpark helps competitive-exam aspirants practise deliberately.' },
    { slug: 'privacy', title: 'Privacy Policy', status: 'published', updatedAt: D(35),
      body: '# Privacy\n\nYour local study data stays in your browser until you connect an account.' },
    { slug: 'terms', title: 'Terms of Use', status: 'published', updatedAt: D(35),
      body: '# Terms\n\nUse only content you are permitted to study and share.' },
    { slug: 'faq', title: 'FAQ', status: 'draft', updatedAt: D(4),
      body: '# FAQ\n\n**Is the trial really free?** Yes — no card required.' }
  ],
  emailChanges: [
    { id: 'e1', uid: 'u_1003', oldEmail: 'user3@example.com', newEmail: 'newmail@example.com',
      status: 'pending', requestedAt: D(1) },
    { id: 'e2', uid: 'u_1009', oldEmail: 'user9@example.com', newEmail: 'changed@example.com',
      status: 'completed', requestedAt: D(12) }
  ],
  rollups: Array.from({ length: 30 }, (_, i) => {
    const day = 29 - i;
    return {
      date: D(day).slice(0, 10),
      dau: Math.round(210 + Math.sin(i / 3) * 45 + i * 4.2),
      signups: Math.round(6 + Math.random() * 11 + i * 0.25),
      sessions: Math.round(430 + Math.sin(i / 2.4) * 90 + i * 7),
      revenue: Math.round(900 + Math.random() * 1500 + i * 42),
      conversions: Math.round(1 + Math.random() * 4)
    };
  }),
  auditLog: [
    { id: 'a1', adminUid: 'demo-admin', action: 'book.publish', target: 'allen-bio', at: D(1), reason: '' },
    { id: 'a2', adminUid: 'demo-admin', action: 'user.suspend', target: 'u_1017', at: D(3), reason: 'Spam reports' },
    { id: 'a3', adminUid: 'demo-admin', action: 'pricing.update', target: 'blaze', at: D(6), reason: 'Launch price' }
  ]
};

/* ═══════════════════════════════════════════════════════════════════════
   DATA ACCESS — one API, two backends
   Every screen calls these; nothing touches Firestore directly. That keeps
   mock and live behaviour identical and makes the security surface small.
   ═══════════════════════════════════════════════════════════════════════ */
export const db = {
  async list(coll) {
    if (!state.live) return structuredClone(MOCK[coll] ?? []);
    const { collection, getDocs } = state.fb.mods.fs;
    const snap = await getDocs(collection(state.fb.db, coll));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async get(coll, id) {
    if (!state.live) {
      if (coll === 'config') return structuredClone(MOCK.config[id] ?? null);
      return structuredClone((MOCK[coll] ?? []).find(x => x.id === id) ?? null);
    }
    const { doc, getDoc } = state.fb.mods.fs;
    const d = await getDoc(doc(state.fb.db, coll, id));
    return d.exists() ? { id: d.id, ...d.data() } : null;
  },
  async set(coll, id, data, merge = true) {
    if (!state.live) {
      if (coll === 'config') { MOCK.config[id] = { ...(MOCK.config[id] || {}), ...data }; return; }
      const arr = MOCK[coll] ?? (MOCK[coll] = []);
      const i = arr.findIndex(x => x.id === id);
      if (i >= 0) arr[i] = merge ? { ...arr[i], ...data } : { id, ...data };
      else arr.push({ id, ...data });
      return;
    }
    const { doc, setDoc, serverTimestamp } = state.fb.mods.fs;
    await setDoc(doc(state.fb.db, coll, id),
      { ...data, updatedAt: serverTimestamp() }, { merge });
  },
  async del(coll, id) {
    if (!state.live) {
      const arr = MOCK[coll] ?? [];
      const i = arr.findIndex(x => x.id === id);
      if (i >= 0) arr.splice(i, 1);
      return;
    }
    const { doc, deleteDoc } = state.fb.mods.fs;
    await deleteDoc(doc(state.fb.db, coll, id));
  },
  /* Append-only audit trail. Every privileged action writes one of these. */
  async audit(action, target, reason = '') {
    const entry = {
      adminUid: state.user?.uid || 'demo-admin',
      adminEmail: state.user?.email || 'demo@local',
      action, target, reason,
      at: new Date().toISOString()
    };
    if (!state.live) { MOCK.auditLog.unshift({ id: 'a' + Date.now(), ...entry }); return; }
    const { collection, addDoc, serverTimestamp } = state.fb.mods.fs;
    await addDoc(collection(state.fb.db, 'auditLog'), { ...entry, at: serverTimestamp() });
  }
};

/* ─── Firebase init ──────────────────────────────────────────────────── */
export function storedConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch { return null; }
}
export function saveConfig(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
export function clearConfig() { localStorage.removeItem(CFG_KEY); }

export async function initFirebase() {
  const cfg = window.RANKSPARK_FIREBASE_CONFIG || storedConfig();
  if (!cfg?.apiKey || !cfg?.projectId) { state.live = false; return null; }
  try {
    const [appM, authM, fsM, stM] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-firestore.js'),
      import(SDK + 'firebase-storage.js')
    ]);
    const app = appM.initializeApp(cfg);
    state.fb = {
      app,
      auth: authM.getAuth(app),
      db: fsM.getFirestore(app),
      storage: stM.getStorage(app),
      mods: { app: appM, auth: authM, fs: fsM, st: stM }
    };
    state.live = true;
    return state.fb;
  } catch (e) {
    console.error('[admin] Firebase init failed', e);
    state.live = false;
    return null;
  }
}

/* The allowlist gate. An authenticated user is NOT an admin until a doc
   exists at /admins/{uid}; the client check is a UX affordance and the
   Firestore rules in firestore.rules are the real enforcement. */
export async function checkAdmin(uid) {
  if (!state.live) return true;                 // mock mode: always allowed
  const { doc, getDoc } = state.fb.mods.fs;
  const d = await getDoc(doc(state.fb.db, 'admins', uid));
  return d.exists();
}

/* ─── router ─────────────────────────────────────────────────────────── */
const routes = new Map();
export function route(name, render) { routes.set(name, render); }

export async function go(name, params = {}) {
  if (!routes.has(name)) name = 'dashboard';
  /* Any open drawer belongs to the screen we are leaving. Its scrim is
     position:fixed, so leaving it mounted silently blocks every click on the
     next screen — caught in testing when Maintenance became unclickable. */
  closeDrawer();
  state.route = name;
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  $$('.nav-i').forEach(a => a.classList.toggle('on', a.dataset.route === name));
  const host = $('#page');
  if (!host) return;
  host.innerHTML = `<div class="grid g-kpi">${'<div class="kpi"><div class="sk sk-l" style="width:44%"></div><div class="sk" style="height:26px;margin-top:12px;width:60%"></div></div>'.repeat(4)}</div>`;
  try {
    await routes.get(name)(host, params);
  } catch (e) {
    console.error(e);
    host.innerHTML = `<div class="card"><div class="empty">${ico('warn', 34)}
      <h3>Something went wrong on this screen</h3>
      <p>${esc(e.message || 'Unknown error')}</p>
      <button class="btn btn-g" onclick="location.reload()">Reload</button></div></div>`;
  }
}
window.addEventListener('hashchange', () => go(location.hash.slice(1) || 'dashboard'));

/* ─── drawer ─────────────────────────────────────────────────────────── */
export function drawer({ title, body, footer, onMount }) {
  let scrim = $('#dr-scrim'), dr = $('#dr');
  if (!scrim) {
    scrim = document.createElement('div'); scrim.id = 'dr-scrim'; scrim.className = 'scrim';
    dr = document.createElement('aside'); dr.id = 'dr'; dr.className = 'drawer';
    dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'true');
    document.body.append(scrim, dr);
    scrim.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && dr.classList.contains('on')) closeDrawer();
    });
  }
  dr.innerHTML = `
    <header class="drawer-h">
      <h2>${esc(title)}</h2>
      <button class="icon-b" data-dr-x aria-label="Close">${ico('x', 17)}</button>
    </header>
    <div class="drawer-b">${body}</div>
    ${footer ? `<footer class="drawer-f">${footer}</footer>` : ''}`;
  $('[data-dr-x]', dr).onclick = closeDrawer;
  requestAnimationFrame(() => { scrim.classList.add('on'); dr.classList.add('on'); });
  onMount?.(dr);
  const f = dr.querySelector('input,select,textarea,button:not([data-dr-x])');
  f?.focus();
  return dr;
}
export function closeDrawer() {
  $('#dr-scrim')?.classList.remove('on');
  $('#dr')?.classList.remove('on');
}

/* ─── misc ───────────────────────────────────────────────────────────── */
export function csv(rows, name) {
  if (!rows.length) return toast('Nothing to export', 'bad');
  const cols = Object.keys(rows[0]);
  const body = [cols.join(','), ...rows.map(r => cols.map(c => {
    const v = r[c] ?? '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = name + '.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Exported ' + rows.length + ' rows');
}
export const trend = (cur, prev) => {
  if (!prev) return { cls: 'flat', txt: '—' };
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.5) return { cls: 'flat', txt: '0%' };
  return { cls: d > 0 ? 'up' : 'dn', txt: (d > 0 ? '↑' : '↓') + Math.abs(d).toFixed(0) + '%' };
};
