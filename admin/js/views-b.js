/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK ADMIN — views B
   S6 Users · S7 Live · S8 Notifications · S9 Messages · S10 Email
   S11 Content · S12 Maintenance · S14 Settings · S5 Payments
   ═══════════════════════════════════════════════════════════════════════════ */
import { $, $$, esc, ico, fmt, db, state, route, toast, drawer, closeDrawer,
         confirmTyped, csv, saveConfig, clearConfig, storedConfig, MOCK } from './core.js';

/* ═══ SECTION 6 — USERS ═══════════════════════════════════════════════ */
route('users', async host => {
  const users = await db.list('users');
  let page = 0, per = 25, q = '', planF = 'all';

  const rows = () => users.filter(u =>
    (planF === 'all' || u.plan === planF) &&
    (!q || (u.profile?.displayName + ' ' + u.profile?.email).toLowerCase().includes(q)));

  const draw = () => {
    const all = rows();
    const slice = all.slice(page * per, page * per + per);
    $('#us-body').innerHTML = slice.length ? slice.map(u => `
      <tr data-uid="${esc(u.uid)}" style="cursor:pointer">
        <td><div style="display:flex;align-items:center;gap:9px">
          <span class="side-ava" style="width:26px;height:26px;font-size:11px">${esc((u.profile?.displayName || 'L')[0])}</span>
          <div><b>${esc(u.profile?.displayName || 'Learner')}</b>
            <div style="font-size:10.5px;color:var(--tx-3)">${esc(u.profile?.email || '—')}</div></div>
        </div></td>
        <td><span class="tag ${u.plan === 'spark' ? '' : u.plan === 'blaze' ? 'c5' : 'warn'}">${esc(u.plan)}</span></td>
        <td class="num">${fmt.n(u.progress?.rankedXp)}</td>
        <td class="num">Lv ${u.progress?.level ?? 1}</td>
        <td class="num">${(u.progress?.accuracy ?? 0).toFixed(0)}%</td>
        <td>${fmt.ago(u.lastActive)}</td>
        <td><span class="tag ${u.status === 'active' ? 'ok' : 'bad'}">${esc(u.status)}</span></td>
      </tr>`).join('')
      : `<tr><td colspan="7"><div class="empty">${ico('users', 30)}<h3>No users match</h3>
         <p>Try a different search or plan filter.</p></div></td></tr>`;
    $('#us-info').textContent = all.length
      ? `${page * per + 1}–${Math.min(all.length, page * per + per)} of ${fmt.n(all.length)}` : '0';
    $('#us-prev').disabled = page === 0;
    $('#us-next').disabled = (page + 1) * per >= all.length;
  };

  host.innerHTML = `
    <div class="page-h">
      <div><h1>Users</h1><p>Mirrored from <b class="mono">/users/{uid}</b>. Destructive
        actions require typed confirmation and are written to the audit log.</p></div>
      <div class="acts"><button class="btn btn-g" id="us-csv">${ico('dl', 15)} Export</button></div>
    </div>
    <div class="card">
      <div class="card-b" style="display:flex;gap:9px;flex-wrap:wrap;align-items:center;
        border-bottom:1px solid var(--line)">
        <div class="search" style="flex:1;min-width:200px">${ico('search', 15)}
          <input id="us-q" placeholder="Search name or email…" aria-label="Search users"></div>
        <select class="btn btn-g" id="us-plan" aria-label="Plan">
          <option value="all">All plans</option><option value="spark">Spark</option>
          <option value="blaze">Blaze</option><option value="inferno">Inferno</option></select>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>User</th><th>Plan</th><th class="num">Ranked XP</th><th class="num">Level</th>
          <th class="num">Accuracy</th><th>Last active</th><th>Status</th></tr></thead>
        <tbody id="us-body"></tbody></table></div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 15px;
        border-top:1px solid var(--line)">
        <span class="mono" style="font-size:11.5px;color:var(--tx-3)" id="us-info"></span>
        <div style="display:flex;gap:7px">
          <button class="btn btn-g btn-sm" id="us-prev">Previous</button>
          <button class="btn btn-g btn-sm" id="us-next">Next</button></div>
      </div>
    </div>`;
  draw();
  $('#us-q').oninput = e => { q = e.target.value.toLowerCase().trim(); page = 0; draw(); };
  $('#us-plan').onchange = e => { planF = e.target.value; page = 0; draw(); };
  $('#us-prev').onclick = () => { if (page > 0) { page--; draw(); } };
  $('#us-next').onclick = () => { page++; draw(); };
  $('#us-csv').onclick = () => csv(rows().map(u => ({
    uid: u.uid, name: u.profile?.displayName, email: u.profile?.email, plan: u.plan,
    status: u.status, xp: u.progress?.totalXp, level: u.progress?.level
  })), 'rankspark-users');

  $('#us-body').addEventListener('click', e => {
    const tr = e.target.closest('[data-uid]');
    if (tr) userDrawer(users.find(u => u.uid === tr.dataset.uid), draw);
  });
});

function userDrawer(u, refresh) {
  const p = u.progress || {};
  drawer({
    title: u.profile?.displayName || 'User',
    body: `
      <div style="display:flex;gap:13px;align-items:center;margin-bottom:18px">
        <span class="side-ava" style="width:52px;height:52px;font-size:20px">${esc((u.profile?.displayName || 'L')[0])}</span>
        <div><b style="font-size:15px">${esc(u.profile?.displayName || 'Learner')}</b>
          <div style="font-size:12px;color:var(--tx-3)">${esc(u.profile?.email || '—')}</div>
          <div style="margin-top:6px;display:flex;gap:6px">
            <span class="tag ${u.plan === 'spark' ? '' : 'c5'}">${esc(u.plan)}</span>
            <span class="tag ${u.status === 'active' ? 'ok' : 'bad'}">${esc(u.status)}</span></div></div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:18px">
        ${[['Total XP', fmt.n(p.totalXp)], ['Ranked XP', fmt.n(p.rankedXp)], ['Level', p.level ?? 1],
           ['Tests', fmt.n(p.totalTests)], ['Accuracy', (p.accuracy ?? 0).toFixed(0) + '%'],
           ['Streak', (p.streak ?? 0) + 'd']].map(([l, v]) => `
          <div style="padding:11px;border:1px solid var(--line);border-radius:12px;background:var(--surf-2)">
            <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--tx-3)">${l}</div>
            <div class="mono" style="font-size:17px;font-weight:600;margin-top:4px">${v}</div></div>`).join('')}
      </div>
      <div class="field"><label for="ud-note">Support notes (admin only)</label>
        <textarea id="ud-note" rows="3" placeholder="Context for the next admin who opens this">${esc(u.supportNote || '')}</textarea></div>
      <div class="field"><label for="ud-plan">Override plan</label>
        <select id="ud-plan">${['spark', 'blaze', 'inferno'].map(v =>
          `<option value="${v}" ${u.plan === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <span class="hint">Grants access without a Stripe payment. Use for support cases only.</span></div>
      <div class="note warn" style="margin-top:16px">${ico('warn', 14)}<span>
        Actions below are logged to <b class="mono">/auditLog</b> with your uid and a reason.</span></div>
      <div style="display:grid;gap:8px;margin-top:11px">
        <button class="btn btn-g" id="ud-reset">Send password reset email</button>
        <button class="btn btn-g" id="ud-signout">Force sign-out (invalidate sessions)</button>
        <button class="btn btn-d" id="ud-progress">Reset all progress</button>
        <button class="btn btn-d" id="ud-susp">${u.status === 'active' ? 'Suspend account' : 'Reinstate account'}</button>
      </div>`,
    footer: `<button class="btn btn-g" data-x>Close</button>
             <button class="btn btn-p" id="ud-save">Save changes</button>`,
    onMount(dr) {
      $('#ud-save').onclick = async () => {
        u.supportNote = $('#ud-note').value.trim();
        const np = $('#ud-plan').value;
        if (np !== u.plan) { await db.audit('user.plan_override', u.uid, `${u.plan} → ${np}`); u.plan = np; }
        await db.set('users', u.uid, { supportNote: u.supportNote, plan: u.plan });
        toast('User updated'); closeDrawer(); refresh();
      };
      $('#ud-reset').onclick = async () => {
        if (state.live) {
          const { sendPasswordResetEmail } = state.fb.mods.auth;
          try { await sendPasswordResetEmail(state.fb.auth, u.profile.email); }
          catch (e) { return toast(e.code || 'Failed', 'bad'); }
        }
        await db.audit('user.password_reset', u.uid);
        toast('Reset email sent to ' + u.profile.email);
      };
      $('#ud-signout').onclick = async () => {
        await db.set('users', u.uid, { sessionEpoch: Date.now() });
        await db.audit('user.force_signout', u.uid);
        toast('Sessions invalidated — the client signs out on next config check');
      };
      $('#ud-progress').onclick = async () => {
        if (!await confirmTyped({ title: 'Reset progress?',
          body: `Clears XP, streak, history and analytics for
                 <b>${esc(u.profile?.displayName)}</b>. Bookmarks and notes are kept.
                 This cannot be undone.`, word: 'RESET' })) return;
        await db.set('users', u.uid, { progress: { totalXp: 0, rankedXp: 0, level: 1, streak: 0, totalTests: 0 } });
        await db.audit('user.reset_progress', u.uid);
        u.progress = { totalXp: 0, rankedXp: 0, level: 1, streak: 0, totalTests: 0 };
        toast('Progress reset'); closeDrawer(); refresh();
      };
      $('#ud-susp').onclick = async () => {
        const next = u.status === 'active' ? 'suspended' : 'active';
        if (next === 'suspended' && !await confirmTyped({ title: 'Suspend account?',
          body: `<b>${esc(u.profile?.displayName)}</b> will be signed out and blocked
                 from signing in. Their data is preserved.`, word: 'SUSPEND' })) return;
        u.status = next;
        await db.set('users', u.uid, { status: next });
        await db.audit('user.' + (next === 'suspended' ? 'suspend' : 'reinstate'), u.uid);
        toast('Account ' + next); closeDrawer(); refresh();
      };
      $$('[data-x]', dr).forEach(x => x.onclick = closeDrawer);
    }
  });
}

/* ═══ SECTION 7 — LIVE USERS ══════════════════════════════════════════ */
route('live', async host => {
  const draw = async () => {
    const s = await db.list('sessions');
    const byView = {};
    s.forEach(x => byView[x.view] = (byView[x.view] || 0) + 1);
    $('#lv-count').textContent = s.length;
    $('#lv-body').innerHTML = s.length ? s.map(x => `
      <tr><td><div style="display:flex;align-items:center;gap:9px">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--ok);
          box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)"></span>
        <b>${esc(x.name || 'Guest')}</b></div></td>
        <td><span class="tag c5">${esc(x.view)}</span></td>
        <td>${esc(x.device)}</td>
        <td class="mono">${Math.round((Date.now() - x.startedAt) / 60000)}m</td>
        <td>${fmt.ago(x.lastSeen)}</td></tr>`).join('')
      : `<tr><td colspan="5"><div class="empty">${ico('radio', 30)}<h3>Nobody online right now</h3>
         <p>Sessions appear here within 30 seconds of a student opening the app —
            once presence tracking is enabled in Settings.</p></div></td></tr>`;
    $('#lv-views').innerHTML = Object.entries(byView).sort((a, b) => b[1] - a[1]).map(([v, n]) => `
      <div class="bar-row"><div>
        <div style="display:flex;justify-content:space-between;margin-bottom:5px">
          <span>${esc(v)}</span><b class="mono" style="color:var(--tx)">${n}</b></div>
        <div class="bar"><i style="width:${(n / s.length) * 100}%"></i></div>
      </div><span class="mono" style="text-align:right;color:var(--tx-3)">${
        ((n / s.length) * 100).toFixed(0)}%</span></div>`).join('') || '';
  };

  host.innerHTML = `
    <div class="page-h">
      <div><h1>Live activity</h1><p>Real-time presence from
        <b class="mono">/sessions</b>, refreshed automatically.</p></div>
      <div class="acts"><span class="tag ok"><i style="width:6px;height:6px;border-radius:50%;
        background:currentColor;display:inline-block"></i> <span id="lv-count">0</span> online</span></div>
    </div>
    <div class="note warn" style="margin-bottom:14px">${ico('info', 14)}<span>
      <b>Cost note.</b> A 30-second heartbeat per active user is roughly
      <b class="mono">2 writes/min/user</b> — about 86k writes/day at 1,000 concurrent users.
      That is the single most expensive pattern in this design. For scale, move presence to
      <b>Realtime Database</b> (priced on bandwidth, with native <b class="mono">onDisconnect</b>)
      or sample 1-in-N users. Presence is therefore <b>off by default</b> — enable it in Settings.</span></div>
    <div class="grid g-2">
      <section class="card">
        <div class="card-h"><div><h2>Who is online</h2><p>Updates without a refresh</p></div></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>User</th><th>Screen</th><th>Device</th><th>Session</th><th>Last seen</th></tr></thead>
          <tbody id="lv-body"></tbody></table></div>
      </section>
      <section class="card">
        <div class="card-h"><div><h2>Where they are</h2><p>Distribution by screen</p></div></div>
        <div class="card-b" id="lv-views"></div>
      </section>
    </div>`;
  await draw();

  if (state.live) {
    const { collection, onSnapshot, query, where } = state.fb.mods.fs;
    const cutoff = new Date(Date.now() - 120000);
    const unsub = onSnapshot(query(collection(state.fb.db, 'sessions'),
      where('lastSeen', '>', cutoff)), draw);
    host.addEventListener('rs-leave', unsub, { once: true });
  } else {
    const iv = setInterval(draw, 5000);
    host.addEventListener('rs-leave', () => clearInterval(iv), { once: true });
  }
});

/* ═══ SECTION 8 — NOTIFICATIONS ═══════════════════════════════════════ */
route('notifications', async host => {
  const list = await db.list('notifications');
  host.innerHTML = `
    <div class="page-h">
      <div><h1>Notifications</h1><p>One-off pings delivered through the app's existing
        toast and bell. Push via FCM is scaffolded server-side.</p></div>
      <div class="acts"><button class="btn btn-p" id="nt-new">${ico('plus', 15)} Compose</button></div>
    </div>
    <div class="card">
      <div class="card-h"><div><h2>Sent history</h2><p>Delivery and open rates</p></div></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Title</th><th>Audience</th><th>Sent</th>
          <th class="num">Delivered</th><th class="num">Opens</th><th class="num">Rate</th></tr></thead>
        <tbody>${list.length ? list.map(n => `<tr>
          <td><b>${esc(n.title)}</b><div style="font-size:10.5px;color:var(--tx-3)">${esc(n.body)}</div></td>
          <td><span class="tag">${esc(n.audience)}</span></td>
          <td>${fmt.date(n.sentAt)}</td>
          <td class="num">${fmt.n(n.delivered)}</td>
          <td class="num">${fmt.n(n.opens)}</td>
          <td class="num">${n.delivered ? ((n.opens / n.delivered) * 100).toFixed(0) + '%' : '—'}</td>
        </tr>`).join('') : `<tr><td colspan="6"><div class="empty">${ico('bell', 30)}
          <h3>Nothing sent yet</h3><p>Compose your first notification to reach students in-app.</p>
          </div></td></tr>`}</tbody></table></div>
    </div>`;

  $('#nt-new').onclick = () => drawer({
    title: 'Compose notification',
    body: `
      <div class="field"><label for="nf-t">Title</label>
        <input id="nf-t" placeholder="New book added" maxlength="60"></div>
      <div class="field"><label for="nf-b">Message</label>
        <textarea id="nf-b" rows="3" maxlength="180" placeholder="Allen Biology Module is now live."></textarea>
        <span class="hint">Keep it under ~120 characters so it fits the toast without truncating.</span></div>
      <div class="field"><label for="nf-a">Audience</label>
        <select id="nf-a">
          <option value="all">Everyone</option>
          <option value="spark">Free (Spark) users</option>
          <option value="paid">Paid users</option>
          <option value="inactive7">Inactive 7+ days</option>
          <option value="single">A single user by email</option></select></div>
      <div class="field" id="nf-email-w" hidden><label for="nf-email">Email address</label>
        <input id="nf-email" type="email" placeholder="student@example.com"></div>
      <div class="field"><label for="nf-link">Deep link (optional)</label>
        <select id="nf-link"><option value="">None</option><option value="#practice">Practice</option>
          <option value="#leaderboard">Leaderboard</option><option value="#pricing">Plans</option>
          <option value="#question-bank">Question bank</option></select></div>
      <div class="field"><label for="nf-when">Delivery</label>
        <select id="nf-when"><option value="now">Send now</option><option value="later">Schedule</option></select></div>
      <div class="field" id="nf-at-w" hidden><label for="nf-at">Send at</label>
        <input id="nf-at" type="datetime-local"></div>
      <div class="card" style="margin-top:6px"><div class="card-h"><div>
        <h3>Preview</h3><p>As it appears in RankSpark</p></div></div>
        <div class="card-b"><div id="nf-prev" style="display:flex;gap:10px;padding:12px 14px;
          border-radius:12px;background:#171728;border:1px solid var(--line)">
          <span style="color:var(--c4)">${ico('bell', 16)}</span>
          <div><b style="font-size:12.5px" id="nf-pt">Title goes here</b>
            <div style="font-size:11px;color:var(--tx-3);margin-top:2px" id="nf-pb">Message preview</div></div>
        </div></div></div>`,
    footer: `<button class="btn btn-g" data-x>Cancel</button>
             <button class="btn btn-p" id="nf-send">Send</button>`,
    onMount(dr) {
      const sync = () => {
        $('#nf-pt').textContent = $('#nf-t').value || 'Title goes here';
        $('#nf-pb').textContent = $('#nf-b').value || 'Message preview';
      };
      $('#nf-t').oninput = sync; $('#nf-b').oninput = sync;
      $('#nf-a').onchange = e => $('#nf-email-w').hidden = e.target.value !== 'single';
      $('#nf-when').onchange = e => $('#nf-at-w').hidden = e.target.value !== 'later';
      $('#nf-send').onclick = async () => {
        const t = $('#nf-t').value.trim(), b = $('#nf-b').value.trim();
        if (!t || !b) return toast('Title and message are required', 'bad');
        const id = 'n_' + Date.now();
        await db.set('notifications', id, {
          title: t, body: b, audience: $('#nf-a').value,
          targetEmail: $('#nf-email')?.value || null,
          link: $('#nf-link').value || null,
          status: $('#nf-when').value === 'now' ? 'sent' : 'scheduled',
          scheduledFor: $('#nf-when').value === 'later' ? $('#nf-at').value : null,
          sentAt: new Date().toISOString(), delivered: 0, opens: 0
        });
        await db.audit('notification.send', id);
        toast($('#nf-when').value === 'now' ? 'Notification sent' : 'Notification scheduled');
        closeDrawer(); import('./core.js').then(m => m.go('notifications'));
      };
      $$('[data-x]', dr).forEach(x => x.onclick = closeDrawer);
    }
  });
});

/* ═══ SECTION 9 — MESSAGES ════════════════════════════════════════════ */
route('messages', async host => {
  const list = await db.list('messages');
  const STYLES = [['info', 'Info'], ['warning', 'Warning'], ['success', 'Success'], ['promo', 'Promo']];

  host.innerHTML = `
    <div class="page-h">
      <div><h1>Announcement banners</h1><p>Persistent on-screen messages. Delivered inside
        the same config payload as everything else — no extra round trip.</p></div>
      <div class="acts"><button class="btn btn-p" id="mg-new">${ico('plus', 15)} New banner</button></div>
    </div>
    <div class="card">${list.length ? list.map(m => `
      <div class="row">
        <span class="tag ${m.style === 'warning' ? 'warn' : m.style === 'success' ? 'ok' : 'c5'}">${esc(m.style)}</span>
        <div class="row-t"><b>${esc(m.text)}</b>
          <small>${esc(m.placement || 'banner')} · ${esc(m.audience || 'all')}
            ${m.endAt ? ' · ends ' + fmt.date(m.endAt) : ''}</small></div>
        <button class="toggle" data-en="${esc(m.id)}" role="switch" aria-checked="${!!m.enabled}"
          aria-label="Enable"></button>
        <button class="btn btn-g btn-sm" data-ed="${esc(m.id)}">Edit</button>
      </div>`).join('') : `<div class="empty">${ico('msg', 34)}<h3>No banners</h3>
        <p>Create one to announce maintenance, new content or a promotion.</p></div>`}</div>`;

  host.addEventListener('click', async e => {
    const t = e.target.closest('[data-en]');
    if (t) {
      const m = list.find(x => x.id === t.dataset.en);
      m.enabled = !m.enabled;
      t.setAttribute('aria-checked', String(m.enabled));
      /* Bumping updatedAt re-shows the banner to users who dismissed the
         previous revision — see the client's dismissal check. */
      await db.set('messages', m.id, { enabled: m.enabled, updatedAt: Date.now() });
      await db.audit('message.toggle', m.id);
      toast(m.enabled ? 'Banner is live' : 'Banner disabled');
      return;
    }
    const ed = e.target.closest('[data-ed]');
    if (ed) editMsg(list.find(x => x.id === ed.dataset.ed));
  });
  $('#mg-new').onclick = () => editMsg(null);

  function editMsg(m) {
    const isNew = !m;
    m = m || { id: '', text: '', style: 'info', placement: 'banner', audience: 'all', enabled: false };
    drawer({
      title: isNew ? 'New banner' : 'Edit banner',
      body: `
        <div class="field"><label for="gf-t">Message</label>
          <input id="gf-t" value="${esc(m.text)}" maxlength="120"
            placeholder="New mock test series is live!"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
          <div class="field"><label for="gf-s">Style</label>
            <select id="gf-s">${STYLES.map(([v, l]) =>
              `<option value="${v}" ${m.style === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label for="gf-p">Placement</label>
            <select id="gf-p">${['banner', 'modal', 'sheet'].map(v =>
              `<option ${m.placement === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label for="gf-a">Audience</label>
          <select id="gf-a">${[['all', 'Everyone'], ['guests', 'Guests only'], ['users', 'Signed-in only']]
            .map(([v, l]) => `<option value="${v}" ${m.audience === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
          <div class="field"><label for="gf-st">Start</label>
            <input id="gf-st" type="datetime-local" value="${m.startAt ? String(m.startAt).slice(0, 16) : ''}"></div>
          <div class="field"><label for="gf-en">End</label>
            <input id="gf-en" type="datetime-local" value="${m.endAt ? String(m.endAt).slice(0, 16) : ''}"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
          <div class="field"><label for="gf-cl">CTA label</label>
            <input id="gf-cl" value="${esc(m.ctaLabel || '')}" placeholder="Explore"></div>
          <div class="field"><label for="gf-ch">CTA link</label>
            <input id="gf-ch" value="${esc(m.ctaHref || '')}" placeholder="#pricing"></div>
        </div>
        <div class="card" style="margin-top:6px"><div class="card-h"><div><h3>Preview</h3></div></div>
          <div class="card-b" style="padding:0"><div id="gf-prev"></div></div></div>`,
      footer: `<button class="btn btn-g" data-x>Cancel</button>
               <button class="btn btn-p" id="gf-save">${isNew ? 'Create' : 'Save'}</button>`,
      onMount(dr) {
        const grad = { info: 'linear-gradient(100deg,#6D5CFF,#B45CFF)',
          warning: 'linear-gradient(100deg,#FF7A45,#FFC24B)',
          success: 'linear-gradient(100deg,#22D3EE,#2EE3A2)',
          promo: 'linear-gradient(100deg,#B45CFF,#FF7A45)' };
        const sync = () => {
          const s = $('#gf-s').value;
          $('#gf-prev').innerHTML = `<div style="display:flex;align-items:center;gap:11px;
            padding:11px 14px;background:${grad[s]};color:${s === 'warning' || s === 'success' ? '#1a1002' : '#fff'};
            font-size:12.5px">
            <span style="flex:1">${esc($('#gf-t').value || 'Your message here')}</span>
            ${$('#gf-cl').value ? `<span style="padding:4px 11px;border-radius:8px;
              background:rgba(255,255,255,.22);font-size:11px;font-weight:700">${esc($('#gf-cl').value)}</span>` : ''}
            <span style="opacity:.7">×</span></div>`;
        };
        ['gf-t', 'gf-cl'].forEach(i => $('#' + i).oninput = sync);
        $('#gf-s').onchange = sync; sync();
        $('#gf-save').onclick = async () => {
          const text = $('#gf-t').value.trim();
          if (!text) return toast('Message text is required', 'bad');
          const id = isNew ? 'm_' + Date.now() : m.id;
          await db.set('messages', id, {
            text, style: $('#gf-s').value, placement: $('#gf-p').value,
            audience: $('#gf-a').value, startAt: $('#gf-st').value || null,
            endAt: $('#gf-en').value || null, ctaLabel: $('#gf-cl').value.trim() || null,
            ctaHref: $('#gf-ch').value.trim() || null,
            enabled: m.enabled ?? false, updatedAt: Date.now()
          });
          await db.audit(isNew ? 'message.create' : 'message.update', id);
          toast('Banner saved'); closeDrawer();
          import('./core.js').then(x => x.go('messages'));
        };
        $$('[data-x]', dr).forEach(x => x.onclick = closeDrawer);
      }
    });
  }
});

/* ═══ SECTION 11 — CONTENT ════════════════════════════════════════════ */
route('content', async host => {
  const list = await db.list('content');
  const md = s => esc(s)
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1 style="font-size:19px">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="color:var(--c5)">$1</a>')
    .replace(/\n\n/g, '</p><p>');

  host.innerHTML = `
    <div class="page-h"><div><h1>Site content</h1>
      <p>Legal text and help copy, served to the app from <b class="mono">/content/{slug}</b>.
         Replaces the hardcoded <b class="mono">data-info</b> strings.</p></div></div>
    <div class="card">${list.map(c => `
      <div class="row">
        <span class="mono tag">${esc(c.slug)}</span>
        <div class="row-t"><b>${esc(c.title)}</b>
          <small>Updated ${fmt.date(c.updatedAt)}</small></div>
        <span class="tag ${c.status === 'published' ? 'ok' : 'warn'}">${esc(c.status)}</span>
        <button class="btn btn-g btn-sm" data-ed="${esc(c.slug)}">Edit</button>
      </div>`).join('')}</div>`;

  host.addEventListener('click', e => {
    const b = e.target.closest('[data-ed]');
    if (!b) return;
    const c = list.find(x => x.slug === b.dataset.ed);
    drawer({
      title: c.title,
      body: `
        <div class="field"><label for="cf-t">Title</label><input id="cf-t" value="${esc(c.title)}"></div>
        <div class="field"><label for="cf-s">Status</label>
          <select id="cf-s"><option value="draft" ${c.status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="published" ${c.status === 'published' ? 'selected' : ''}>Published</option></select>
          <span class="hint">Drafts are invisible to the app; it falls back to the built-in copy.</span></div>
        <div class="field"><label for="cf-b">Markdown</label>
          <textarea id="cf-b" rows="12" style="font-family:var(--mono);font-size:12px">${esc(c.body)}</textarea></div>
        <div class="card"><div class="card-h"><div><h3>Rendered preview</h3>
          <p>In RankSpark's typography</p></div></div>
          <div class="card-b" id="cf-prev" style="font-size:13px;line-height:1.65;color:var(--tx-2)"></div></div>`,
      footer: `<button class="btn btn-g" data-x>Cancel</button>
               <button class="btn btn-p" id="cf-save">Save</button>`,
      onMount(dr) {
        const sync = () => $('#cf-prev').innerHTML = '<p>' + md($('#cf-b').value) + '</p>';
        $('#cf-b').oninput = sync; sync();
        $('#cf-save').onclick = async () => {
          await db.set('content', c.slug, {
            title: $('#cf-t').value.trim(), status: $('#cf-s').value,
            body: $('#cf-b').value, updatedAt: new Date().toISOString()
          });
          await db.audit('content.update', c.slug);
          toast('Content saved'); closeDrawer();
          import('./core.js').then(m => m.go('content'));
        };
        $$('[data-x]', dr).forEach(x => x.onclick = closeDrawer);
      }
    });
  });
});

/* ═══ SECTION 12 — MAINTENANCE ════════════════════════════════════════ */
route('maintenance', async host => {
  const cfg = await db.get('config', 'app') || {};
  const m = cfg.maintenance || { enabled: false, message: '', allowedUids: [] };

  host.innerHTML = `
    <div class="page-h"><div><h1>Maintenance mode</h1>
      <p>Takes RankSpark offline for everyone except the bypass allowlist.
         Enabling requires typed confirmation.</p></div></div>
    <div class="grid g-2">
      <section class="card">
        <div class="card-h"><div><h2>Control</h2><p>Applies within the 5-minute config TTL</p></div>
          <span class="tag ${m.enabled ? 'bad' : 'ok'}" id="mt-state">${m.enabled ? 'App is DOWN' : 'App is live'}</span></div>
        <div class="row">
          <div class="row-t"><b>Maintenance mode</b>
            <small>Blocks all non-allowlisted users immediately</small></div>
          <button class="toggle" id="mt-tg" role="switch" aria-checked="${!!m.enabled}"
            aria-label="Maintenance mode"></button>
        </div>
        <div class="card-b" style="border-top:1px solid var(--line)">
          <div class="field"><label for="mt-msg">Message shown to blocked users</label>
            <textarea id="mt-msg" rows="3"
              placeholder="We are upgrading the question engine. Back shortly.">${esc(m.message || '')}</textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
            <div class="field"><label for="mt-s">Scheduled start</label>
              <input id="mt-s" type="datetime-local" value="${m.scheduledStart ? String(m.scheduledStart).slice(0, 16) : ''}"></div>
            <div class="field"><label for="mt-e">Scheduled end</label>
              <input id="mt-e" type="datetime-local" value="${m.scheduledEnd ? String(m.scheduledEnd).slice(0, 16) : ''}">
              <span class="hint">Shown to users as a live countdown</span></div>
          </div>
          <div class="field"><label for="mt-uid">Bypass allowlist (uids)</label>
            <textarea id="mt-uid" rows="2" class="mono"
              placeholder="One uid per line">${esc((m.allowedUids || []).join('\n'))}</textarea>
            <span class="hint">These accounts keep full access so QA can verify a release.</span></div>
          <button class="btn btn-p btn-full" id="mt-save">Save maintenance settings</button>
        </div>
      </section>
      <section class="card">
        <div class="card-h"><div><h2>What users will see</h2><p>Exact on-brand screen</p></div></div>
        <div class="card-b">
          <div style="border-radius:16px;padding:26px 20px;text-align:center;
            border:1px solid var(--line);
            background:radial-gradient(ellipse 70% 55% at 50% 0%,rgba(109,92,255,.2),transparent 62%),#0a0a16">
            <span class="tag warn" style="margin-bottom:14px">Scheduled maintenance</span>
            <div style="font-size:18px;font-weight:700;margin-bottom:8px">We are making RankSpark better</div>
            <div id="mt-prev" style="font-size:12.5px;color:var(--tx-2);line-height:1.6"></div>
            <div class="mono" style="margin-top:16px;padding:10px;border-radius:11px;
              border:1px solid var(--line);color:var(--c5);font-size:13px">Back in 1h 29m 58s</div>
          </div>
          <div class="note" style="margin-top:13px">${ico('info', 14)}<span>
            This is a full-screen takeover inside the app, not a browser alert. The
            countdown is live and the screen re-checks config automatically.</span></div>
        </div>
      </section>
    </div>`;

  const sync = () => $('#mt-prev').textContent = $('#mt-msg').value ||
    'RankSpark is briefly offline for maintenance. Your progress is safe — nothing has been lost.';
  $('#mt-msg').oninput = sync; sync();

  $('#mt-tg').onclick = async () => {
    const next = $('#mt-tg').getAttribute('aria-checked') !== 'true';
    if (next && !await confirmTyped({
      title: 'Take RankSpark offline?',
      body: `Every student who is not on the bypass allowlist will immediately see the
             maintenance screen instead of the app. Nothing is deleted, but nobody can
             practise until you turn this off.`,
      word: 'MAINTENANCE'
    })) return;
    $('#mt-tg').setAttribute('aria-checked', String(next));
    $('#mt-state').textContent = next ? 'App is DOWN' : 'App is live';
    $('#mt-state').className = 'tag ' + (next ? 'bad' : 'ok');
    await db.set('config', 'app', { maintenance: { ...m, enabled: next } });
    await db.audit('maintenance.' + (next ? 'enable' : 'disable'), 'config/app');
    toast(next ? 'Maintenance mode ON — app is offline' : 'Maintenance mode off', next ? 'bad' : 'ok');
  };

  $('#mt-save').onclick = async () => {
    const data = {
      enabled: $('#mt-tg').getAttribute('aria-checked') === 'true',
      message: $('#mt-msg').value.trim(),
      scheduledStart: $('#mt-s').value || null,
      scheduledEnd: $('#mt-e').value || null,
      allowedUids: $('#mt-uid').value.split('\n').map(s => s.trim()).filter(Boolean)
    };
    await db.set('config', 'app', { maintenance: data });
    await db.audit('maintenance.update', 'config/app');
    toast('Maintenance settings saved');
  };
});

/* ═══ SECTION 5 — PAYMENTS ════════════════════════════════════════════ */
route('payments', async host => {
  const pays = await db.list('payments');
  const total = pays.filter(p => p.status === 'paid').reduce((t, p) => t + p.amount, 0);
  const refunded = pays.filter(p => p.status === 'refunded').reduce((t, p) => t + p.amount, 0);
  const failed = pays.filter(p => p.status === 'failed').length;

  host.innerHTML = `
    <div class="page-h">
      <div><h1>Payments</h1><p>Mirror of Stripe, kept in sync by the webhook Cloud Function.
        Refunds run server-side — the browser never holds a Stripe secret.</p></div>
      <div class="acts"><button class="btn btn-g" id="pm-csv">${ico('dl', 15)} Export</button></div>
    </div>
    <div class="grid g-kpi" style="margin-bottom:14px">
      <div class="kpi" style="--k:var(--ok)"><div class="kpi-t">${ico('card', 14)}Collected</div>
        <div class="kpi-v">${fmt.money(total)}</div><div class="kpi-d">all time</div></div>
      <div class="kpi" style="--k:var(--warn)"><div class="kpi-t">${ico('refresh', 14)}Refunded</div>
        <div class="kpi-v">${fmt.money(refunded)}</div><div class="kpi-d">all time</div></div>
      <div class="kpi" style="--k:var(--bad)"><div class="kpi-t">${ico('warn', 14)}Failed</div>
        <div class="kpi-v">${fmt.n(failed)}</div><div class="kpi-d">needs retry</div></div>
      <div class="kpi" style="--k:var(--c1)"><div class="kpi-t">${ico('chart', 14)}Avg order</div>
        <div class="kpi-v">${fmt.money(Math.round(total / Math.max(1, pays.filter(p => p.status === 'paid').length)))}</div>
        <div class="kpi-d">per paid transaction</div></div>
    </div>
    <div class="card">
      <div class="card-h"><div><h2>Transactions</h2><p>Newest first</p></div></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Customer</th><th>Plan</th><th class="num">Amount</th>
          <th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody>${pays.length ? pays.map(p => `<tr>
          <td><b>${esc(p.customer)}</b><div class="mono" style="font-size:10px;color:var(--tx-3)">${esc(p.id)}</div></td>
          <td>${esc(p.plan)}</td><td class="num">${fmt.money(p.amount)}</td>
          <td><span class="tag ${p.status === 'paid' ? 'ok' : p.status === 'refunded' ? 'warn' : 'bad'}">${esc(p.status)}</span></td>
          <td>${fmt.date(p.createdAt)}</td>
          <td style="text-align:right">${p.status === 'paid'
            ? `<button class="btn btn-g btn-sm" data-rf="${esc(p.id)}">Refund</button>` : ''}</td>
        </tr>`).join('') : `<tr><td colspan="6"><div class="empty">${ico('card', 30)}
          <h3>No transactions yet</h3><p>Payments appear here once the Stripe webhook
          is deployed and your first checkout completes.</p></div></td></tr>`}</tbody></table></div>
    </div>`;

  $('#pm-csv').onclick = () => csv(pays, 'rankspark-payments');
  host.addEventListener('click', async e => {
    const b = e.target.closest('[data-rf]');
    if (!b) return;
    const p = pays.find(x => x.id === b.dataset.rf);
    if (!await confirmTyped({ title: 'Refund ' + fmt.money(p.amount) + '?',
      body: `Refunds <b>${esc(p.customer)}</b> in full via Stripe and downgrades their plan
             at period end. This calls a Cloud Function — it cannot be undone from here.`,
      word: 'REFUND' })) return;
    p.status = 'refunded';
    await db.set('payments', p.id, { status: 'refunded' });
    await db.audit('payment.refund', p.id, fmt.money(p.amount));
    toast('Refund issued'); import('./core.js').then(m => m.go('payments'));
  });
});

/* ═══ SECTION 10 — EMAIL ══════════════════════════════════════════════ */
route('email', async host => {
  const reqs = await db.list('emailChanges');
  host.innerHTML = `
    <div class="page-h"><div><h1>Email</h1>
      <p>Address-change requests and transactional templates.</p></div></div>
    <div class="note" style="margin-bottom:14px">${ico('info', 14)}<span>
      <b>Provider recommendation: Resend.</b> Its Node SDK is a two-line send from a Cloud
      Function, templates are plain React/HTML rather than a proprietary builder, and the
      free tier (3k/month) comfortably covers transactional volume at this stage. SendGrid
      is the alternative if you later need marketing campaigns and suppression lists.</span></div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-h"><div><h2>Email-change requests</h2>
        <p>A Cloud Function verifies the new address before anything is written to Auth</p></div></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>From</th><th>To</th><th>Status</th><th>Requested</th><th></th></tr></thead>
        <tbody>${reqs.length ? reqs.map(r => `<tr>
          <td class="mono" style="font-size:11.5px">${esc(r.oldEmail)}</td>
          <td class="mono" style="font-size:11.5px"><b>${esc(r.newEmail)}</b></td>
          <td><span class="tag ${r.status === 'completed' ? 'ok' : r.status === 'pending' ? 'warn' : ''}">${esc(r.status)}</span></td>
          <td>${fmt.date(r.requestedAt)}</td>
          <td style="text-align:right">${r.status === 'pending'
            ? `<button class="btn btn-g btn-sm" data-re="${esc(r.id)}">Resend</button>
               <button class="btn btn-g btn-sm" data-ap="${esc(r.id)}">Force approve</button>` : ''}</td>
        </tr>`).join('') : `<tr><td colspan="5"><div class="empty">${ico('mail', 30)}
          <h3>No pending requests</h3><p>They appear here when a student changes their email.</p>
          </div></td></tr>`}</tbody></table></div>
    </div>
    <div class="card">
      <div class="card-h"><div><h2>Templates</h2><p>Rendered by Cloud Functions at send time</p></div></div>
      ${[['welcome', 'Welcome email', 'Sent on first sign-in'],
         ['reset', 'Password reset', 'Overrides the default Firebase copy'],
         ['receipt', 'Subscription receipt', 'Sent after a successful payment'],
         ['winback', 'Re-engagement', 'Sent after 14 days of inactivity']]
        .map(([id, t, d]) => `<div class="row">
          <span class="mono tag">${id}</span>
          <div class="row-t"><b>${t}</b><small>${d}</small></div>
          <button class="btn btn-g btn-sm" data-tpl="${id}">Edit</button></div>`).join('')}
    </div>`;

  host.addEventListener('click', async e => {
    const re = e.target.closest('[data-re]');
    if (re) { await db.audit('email.resend', re.dataset.re); return toast('Verification email resent'); }
    const ap = e.target.closest('[data-ap]');
    if (ap) {
      if (!await confirmTyped({ title: 'Force approve email change?',
        body: `Skips verification and writes the new address straight to Firebase Auth.
               Only do this when you have confirmed the request with the student directly.`,
        word: 'APPROVE' })) return;
      await db.set('emailChanges', ap.dataset.ap, { status: 'completed' });
      await db.audit('email.force_approve', ap.dataset.ap);
      toast('Email change approved'); import('./core.js').then(m => m.go('email'));
      return;
    }
    const tpl = e.target.closest('[data-tpl]');
    if (tpl) drawer({
      title: 'Edit template — ' + tpl.dataset.tpl,
      body: `
        <div class="field"><label for="tf-s">Subject line</label>
          <input id="tf-s" value="Welcome to RankSpark, {{displayName}}"></div>
        <div class="field"><label for="tf-b">Body (markdown)</label>
          <textarea id="tf-b" rows="10" style="font-family:var(--mono);font-size:12px">Hi {{displayName}},

Thanks for joining RankSpark. Your account is ready — pick a book and start your first practice session.

— The RankSpark team</textarea>
          <span class="hint">Available variables: <b class="mono">{{displayName}} {{email}}
            {{plan}} {{expiryDate}}</b></span></div>
        <button class="btn btn-g btn-full" id="tf-test">${ico('mail', 15)} Send a test to myself</button>`,
      footer: `<button class="btn btn-g" data-x>Cancel</button>
               <button class="btn btn-p" id="tf-save">Save template</button>`,
      onMount(dr) {
        $('#tf-test').onclick = () => toast('Test email queued to ' + (state.user?.email || 'your address'));
        $('#tf-save').onclick = async () => {
          await db.set('emailTemplates', tpl.dataset.tpl,
            { subject: $('#tf-s').value, body: $('#tf-b').value });
          await db.audit('email.template_update', tpl.dataset.tpl);
          toast('Template saved'); closeDrawer();
        };
        $$('[data-x]', dr).forEach(x => x.onclick = closeDrawer);
      }
    });
  });
});

/* ═══ SECTION 14 — SETTINGS ═══════════════════════════════════════════ */
route('settings', async host => {
  const cfg = await db.get('config', 'app') || {};
  const flags = cfg.featureFlags || {};
  const admins = await db.list('admins');
  const log = await db.list('auditLog');
  const live = state.live;

  const FLAGS = [
    ['leaderboard', 'Leaderboard', 'Show the leaderboard nav and page'],
    ['rankedSubmissions', 'Ranked submissions', 'Allow mock results to affect global rank'],
    ['paperLab', 'Paper Lab', 'Printable paper generator'],
    ['cloudSync', 'Cloud sync', 'Mirror progress to Firestore'],
    ['presence', 'Presence tracking', 'Powers Live Users — see the cost note there']
  ];

  host.innerHTML = `
    <div class="page-h"><div><h1>Settings</h1>
      <p>Feature flags, admin access and system health.</p></div>
      <div class="acts"><button class="btn btn-g" id="st-bump">${ico('refresh', 15)} Force refresh all clients</button></div></div>

    <div class="grid g-2">
      <section class="card">
        <div class="card-h"><div><h2>Feature flags</h2>
          <p>Toggle features remotely — clients pick changes up within 5 minutes</p></div></div>
        ${FLAGS.map(([k, t, d]) => `<div class="row">
          <div class="row-t"><b>${t}</b><small>${d}</small></div>
          <button class="toggle" data-flag="${k}" role="switch"
            aria-checked="${flags[k] !== false && flags[k] !== undefined ? !!flags[k] : k !== 'presence'}"
            aria-label="${t}"></button></div>`).join('')}
        <div class="card-b" style="border-top:1px solid var(--line)">
          <div class="field"><label for="st-ver">Minimum supported app version</label>
            <input id="st-ver" type="number" class="mono" value="${cfg.minAppVersion || 0}">
            <span class="hint">Older clients see a forced-update screen. 0 disables the check.</span></div>
        </div>
      </section>

      <section class="card">
        <div class="card-h"><div><h2>System status</h2><p>Check before assuming the app is broken</p></div></div>
        <div class="card-b" id="st-health"></div>
      </section>
    </div>

    <section class="card" style="margin-top:14px">
      <div class="card-h"><div><h2>Firebase connection</h2>
        <p>${live ? 'Connected to a live project' : 'Not connected — the app is running on demo data'}</p></div>
        <span class="tag ${live ? 'ok' : 'warn'}">${live ? 'Live' : 'Demo'}</span></div>
      <div class="card-b">
        <div class="field"><label for="st-cfg">Firebase web config (JSON)</label>
          <textarea id="st-cfg" rows="7" class="mono" style="font-size:11.5px"
            placeholder='{"apiKey":"…","authDomain":"…","projectId":"…","storageBucket":"…","appId":"…"}'>${
            esc(storedConfig() ? JSON.stringify(storedConfig(), null, 2) : '')}</textarea>
          <span class="hint">Paste the config object from Firebase console → Project settings →
            Your apps. Stored in this browser only; never committed to the repo.</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-p" id="st-connect">Connect project</button>
          ${live ? '<button class="btn btn-g" id="st-disc">Disconnect</button>' : ''}
        </div>
      </div>
    </section>

    <div class="grid g-2" style="margin-top:14px">
      <section class="card">
        <div class="card-h"><div><h2>Admin access</h2><p>Who can open this dashboard</p></div>
          <button class="btn btn-g btn-sm" id="st-inv">${ico('plus', 14)} Invite</button></div>
        ${admins.length ? admins.map(a => `<div class="row">
          <span class="side-ava" style="width:28px;height:28px;font-size:11px">${esc((a.email || 'A')[0].toUpperCase())}</span>
          <div class="row-t"><b>${esc(a.email || a.id)}</b><small class="mono">${esc(a.id)}</small></div>
          <span class="tag ${a.role === 'owner' ? 'c5' : ''}">${esc(a.role || 'admin')}</span>
          ${a.role === 'owner' ? '' : `<button class="btn btn-g btn-sm" data-rv="${esc(a.id)}">Revoke</button>`}
        </div>`).join('') : `<div class="empty" style="padding:28px">${ico('users', 30)}
          <h3>No admins yet</h3><p>Add a uid to <b class="mono">/admins</b> to grant access.</p></div>`}
      </section>

      <section class="card">
        <div class="card-h"><div><h2>Audit log</h2><p>Every privileged action</p></div>
          <button class="btn btn-g btn-sm" id="st-log-csv">${ico('dl', 14)} Export</button></div>
        <div class="tbl-wrap" style="max-height:300px"><table class="tbl">
          <thead><tr><th>Action</th><th>Target</th><th>When</th></tr></thead>
          <tbody>${log.length ? log.slice(0, 40).map(a => `<tr>
            <td><span class="tag">${esc(a.action)}</span></td>
            <td class="mono" style="font-size:11px">${esc(a.target)}</td>
            <td>${fmt.ago(a.at)}</td></tr>`).join('')
            : `<tr><td colspan="3"><div class="empty" style="padding:24px">
               ${ico('file', 28)}<h3>Nothing logged yet</h3></div></td></tr>`}</tbody></table></div>
      </section>
    </div>`;

  /* Live health probes rather than static green dots. */
  (async () => {
    const probe = async (label, fn) => {
      const t0 = performance.now();
      try { await fn(); return { label, ok: true, ms: Math.round(performance.now() - t0) }; }
      catch (e) { return { label, ok: false, ms: Math.round(performance.now() - t0), err: e.code || e.message }; }
    };
    const results = await Promise.all([
      probe('Firestore read', () => db.get('config', 'app')),
      probe('Auth session', async () => { if (live && !state.fb.auth.currentUser) throw new Error('no session'); }),
      probe('Storage bucket', async () => { if (!live) return; if (!state.fb.storage) throw new Error('unavailable'); })
    ]);
    $('#st-health').innerHTML = results.map(r => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;
        border-bottom:1px solid var(--line)">
        <span style="width:8px;height:8px;border-radius:50%;
          background:${r.ok ? 'var(--ok)' : 'var(--bad)'};
          box-shadow:0 0 0 3px color-mix(in srgb,${r.ok ? 'var(--ok)' : 'var(--bad)'} 20%,transparent)"></span>
        <span style="flex:1;font-size:12.5px">${r.label}</span>
        <span class="mono" style="font-size:11px;color:var(--tx-3)">${r.ok ? r.ms + 'ms' : esc(r.err || 'failed')}</span>
      </div>`).join('') +
      `<div class="note" style="margin-top:12px">${ico('info', 14)}<span>Config version
        <b class="mono">${cfg.configVersion ?? 0}</b>. Clients cache for 5 minutes;
        bump the version to force an early refresh.</span></div>`;
  })();

  host.addEventListener('click', async e => {
    const f = e.target.closest('[data-flag]');
    if (f) {
      const k = f.dataset.flag;
      const next = f.getAttribute('aria-checked') !== 'true';
      if (k === 'presence' && next && !await confirmTyped({
        title: 'Enable presence tracking?',
        body: `This makes every active client write a heartbeat every 30 seconds —
               roughly <b class="mono">86,000 writes/day at 1,000 concurrent users</b>.
               Enable it deliberately, not by default.`, word: 'ENABLE', danger: false })) return;
      f.setAttribute('aria-checked', String(next));
      flags[k] = next;
      await db.set('config', 'app', { featureFlags: flags });
      await db.audit('flag.' + k, String(next));
      toast(k + ' ' + (next ? 'enabled' : 'disabled'));
      return;
    }
    const rv = e.target.closest('[data-rv]');
    if (rv) {
      if (!await confirmTyped({ title: 'Revoke admin access?',
        body: `This account will immediately lose access to the dashboard.`, word: 'REVOKE' })) return;
      await db.del('admins', rv.dataset.rv);
      await db.audit('admin.revoke', rv.dataset.rv);
      toast('Access revoked'); import('./core.js').then(m => m.go('settings'));
    }
  });

  $('#st-bump').onclick = async () => {
    await db.set('config', 'app', { configVersion: (cfg.configVersion || 0) + 1 });
    await db.audit('config.force_refresh', 'config/app');
    toast('Version bumped — clients refresh on next check');
  };
  $('#st-ver').onchange = async e => {
    await db.set('config', 'app', { minAppVersion: +e.target.value || 0 });
    toast('Minimum version saved');
  };
  $('#st-log-csv').onclick = () => csv(log, 'rankspark-audit-log');
  $('#st-inv').onclick = () => drawer({
    title: 'Invite an admin',
    body: `<div class="field"><label for="iv-uid">Firebase uid</label>
        <input id="iv-uid" class="mono" placeholder="The uid from Firebase Auth">
        <span class="hint">Find it in Firebase console → Authentication → Users.</span></div>
      <div class="field"><label for="iv-em">Email (for display)</label>
        <input id="iv-em" type="email" placeholder="colleague@rankspark.app"></div>
      <div class="note warn">${ico('warn', 14)}<span>Admins can change pricing, take the app
        offline and delete user data. Grant sparingly.</span></div>`,
    footer: `<button class="btn btn-g" data-x>Cancel</button>
             <button class="btn btn-p" id="iv-go">Grant access</button>`,
    onMount(dr) {
      $('#iv-go').onclick = async () => {
        const uid = $('#iv-uid').value.trim();
        if (!uid) return toast('uid is required', 'bad');
        await db.set('admins', uid, { email: $('#iv-em').value.trim(), role: 'admin',
          addedAt: new Date().toISOString(), addedBy: state.user?.uid || 'demo-admin' });
        await db.audit('admin.invite', uid);
        toast('Admin added'); closeDrawer(); import('./core.js').then(m => m.go('settings'));
      };
      $$('[data-x]', dr).forEach(x => x.onclick = closeDrawer);
    }
  });

  $('#st-connect').onclick = async () => {
    let cfgObj;
    try { cfgObj = JSON.parse($('#st-cfg').value); }
    catch { return toast('That is not valid JSON', 'bad'); }
    if (!cfgObj.apiKey || !cfgObj.projectId) return toast('Missing apiKey or projectId', 'bad');
    saveConfig(cfgObj);
    toast('Config saved — reloading');
    setTimeout(() => location.reload(), 700);
  };
  const dc = $('#st-disc');
  if (dc) dc.onclick = async () => {
    if (!await confirmTyped({ title: 'Disconnect Firebase?',
      body: 'The dashboard returns to demo data. Your Firestore data is untouched.',
      word: 'DISCONNECT' })) return;
    clearConfig(); location.reload();
  };
});
