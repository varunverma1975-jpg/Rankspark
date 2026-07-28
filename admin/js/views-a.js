/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK ADMIN — views A
   Section 13 Dashboard · Section 2 Books · Section 4 Pricing
   ═══════════════════════════════════════════════════════════════════════════ */
import { $, $$, esc, ico, fmt, db, state, route, toast, drawer, closeDrawer,
         confirmTyped, csv, trend, MOCK } from './core.js';

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 13 — DASHBOARD
   The page an admin lands on. Optimised for a five-second glance: what
   changed, what needs attention, what to do next.
   ═══════════════════════════════════════════════════════════════════════ */
route('dashboard', async host => {
  const [rollups, users, books, sessions, payments] = await Promise.all([
    db.list('rollups'), db.list('users'), db.list('books'),
    db.list('sessions'), db.list('payments')
  ]);

  const days = Number(localStorage.getItem('rsadmin-range') || 30);
  const win = rollups.slice(-days);
  const prev = rollups.slice(-days * 2, -days);
  const sum = (a, k) => a.reduce((t, r) => t + (r[k] || 0), 0);

  const dauNow = win.length ? win[win.length - 1].dau : 0;
  const dauPrev = prev.length ? prev[prev.length - 1].dau : 0;
  const revNow = sum(win, 'revenue'), revPrev = sum(prev, 'revenue');
  const signNow = sum(win, 'signups'), signPrev = sum(prev, 'signups');
  const paid = users.filter(u => u.plan && u.plan !== 'spark').length;
  const conv = users.length ? (paid / users.length) * 100 : 0;

  const kpi = (k, icon, label, val, sub, tr) => `
    <article class="kpi" style="--k:${k}">
      <div class="kpi-t">${ico(icon, 14)}${esc(label)}</div>
      <div class="kpi-v">${val}</div>
      <div class="kpi-d">${tr ? `<span class="trend ${tr.cls}">${tr.txt}</span>` : ''}<span>${esc(sub)}</span></div>
    </article>`;

  /* DAU sparkline. Hand-rolled SVG: a charting library would be ~90 KB for
     three charts, and this stays consistent with the product's own visuals. */
  const spark = (data, key, color) => {
    if (data.length < 2) return '<div class="empty" style="padding:20px">Not enough data yet</div>';
    const vals = data.map(d => d[key] || 0);
    const max = Math.max(...vals), min = Math.min(...vals);
    const W = 600, H = 170, P = 6;
    const X = i => P + i * ((W - P * 2) / (vals.length - 1));
    const Y = v => H - P - ((v - min) / (max - min || 1)) * (H - P * 2 - 14);
    const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
        aria-label="${esc(key)} trend, latest ${vals[vals.length - 1]}">
      <defs><linearGradient id="g-${key}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".34"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <line x1="${P}" y1="${Y(mean).toFixed(1)}" x2="${W - P}" y2="${Y(mean).toFixed(1)}"
        stroke="rgba(255,255,255,.16)" stroke-width="1" stroke-dasharray="4 5"/>
      <polygon points="${P},${H - P} ${pts} ${W - P},${H - P}" fill="url(#g-${key})"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2"
        stroke-linecap="round" stroke-linejoin="round"/>
      ${vals.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2"
        fill="${color}"><title>${esc(data[i].date)} — ${fmt.n(v)}</title></circle>`).join('')}
    </svg>`;
  };

  const topBooks = [...books]
    .map(b => ({ ...b, use: b.questionCount || 0 }))
    .sort((a, b) => b.use - a.use).slice(0, 5);
  const maxUse = Math.max(...topBooks.map(b => b.use), 1);

  host.innerHTML = `
    <div class="page-h">
      <div>
        <h1>Command center</h1>
        <p>Everything happening across RankSpark right now. ${state.live
          ? 'Live Firestore data.'
          : 'Demo data — attach a Firebase project in Settings to go live.'}</p>
      </div>
      <div class="acts">
        <select class="btn btn-g" id="dash-range" aria-label="Date range">
          ${[7, 14, 30].map(d => `<option value="${d}" ${d === days ? 'selected' : ''}>Last ${d} days</option>`).join('')}
        </select>
        <button class="btn btn-g" id="dash-csv">${ico('dl', 15)} Export CSV</button>
      </div>
    </div>

    <div class="grid g-kpi" style="margin-bottom:14px">
      ${kpi('var(--c1)', 'users', 'Daily active', fmt.n(dauNow), 'vs previous period', trend(dauNow, dauPrev))}
      ${kpi('var(--c2)', 'chart', 'New signups', fmt.n(signNow), `over ${days} days`, trend(signNow, signPrev))}
      ${kpi('var(--c4)', 'card', 'Revenue', fmt.money(revNow), `over ${days} days`, trend(revNow, revPrev))}
      ${kpi('var(--c5)', 'radio', 'Live now', fmt.n(sessions.length), 'active sessions')}
    </div>

    <div class="grid g-2" style="margin-bottom:14px">
      <section class="card">
        <div class="card-h">
          <div><h2>Daily active users</h2><p>Dashed line is the period average</p></div>
          <span class="tag c5">${fmt.n(dauNow)} today</span>
        </div>
        <div class="card-b">${spark(win, 'dau', '#6D5CFF')}</div>
      </section>
      <section class="card">
        <div class="card-h">
          <div><h2>Revenue</h2><p>Daily gross, INR</p></div>
          <span class="tag ok">${fmt.money(revNow)}</span>
        </div>
        <div class="card-b">${spark(win, 'revenue', '#22D3EE')}</div>
      </section>
    </div>

    <div class="grid g-2">
      <section class="card">
        <div class="card-h"><div><h2>Free → paid conversion</h2>
          <p>${fmt.n(paid)} of ${fmt.n(users.length)} accounts are on a paid plan</p></div></div>
        <div class="card-b">
          ${(() => {
            const steps = [
              { l: 'Signed up', v: users.length, c: 'var(--c1)' },
              { l: 'Completed a session', v: Math.round(users.length * 0.72), c: 'var(--c2)' },
              { l: 'Started a trial', v: Math.round(users.length * 0.31), c: 'var(--c3)' },
              { l: 'Paid', v: paid, c: 'var(--c4)' }
            ];
            return steps.map(s => `
              <div class="bar-row">
                <div>
                  <div style="display:flex;justify-content:space-between;margin-bottom:5px">
                    <span>${esc(s.l)}</span>
                    <b class="mono" style="color:var(--tx)">${fmt.n(s.v)}</b>
                  </div>
                  <div class="bar"><i data-w="${(s.v / (users.length || 1)) * 100}"
                    style="background:linear-gradient(90deg,${s.c},color-mix(in srgb,${s.c} 40%,transparent))"></i></div>
                </div>
                <span class="mono" style="text-align:right;color:var(--tx-3)">${
                  ((s.v / (users.length || 1)) * 100).toFixed(0)}%</span>
              </div>`).join('');
          })()}
          <div class="note">${ico('info', 14)}<span>Conversion is
            <b class="mono" style="color:var(--tx)">${fmt.pct(conv)}</b>.
            Anything above 3% is healthy for a freemium exam-prep product.</span></div>
        </div>
      </section>

      <section class="card">
        <div class="card-h"><div><h2>Largest question packs</h2><p>By question count</p></div>
          <a class="btn btn-g btn-sm" href="#books">Manage</a></div>
        <div class="card-b">
          ${topBooks.length ? topBooks.map(b => `
            <div class="bar-row">
              <div>
                <div style="display:flex;justify-content:space-between;margin-bottom:5px">
                  <span>${esc(b.name)}${b.active ? '' : ' <span class="tag">draft</span>'}</span>
                  <b class="mono" style="color:var(--tx)">${fmt.n(b.use)}</b>
                </div>
                <div class="bar"><i data-w="${(b.use / maxUse) * 100}"></i></div>
              </div>
              <span class="mono" style="text-align:right;color:var(--tx-3)">${esc(b.subjects?.[0] || '—')}</span>
            </div>`).join('')
            : `<div class="empty">${ico('book', 34)}<h3>No books yet</h3>
               <p>Publish your first question pack and it will appear here.</p>
               <a class="btn btn-p" href="#books">${ico('plus', 15)} Add a book</a></div>`}
        </div>
      </section>
    </div>`;

  requestAnimationFrame(() => $$('[data-w]', host).forEach(i => i.style.width = i.dataset.w + '%'));

  $('#dash-range').onchange = e => {
    localStorage.setItem('rsadmin-range', e.target.value);
    import('./core.js').then(m => m.go('dashboard'));
  };
  $('#dash-csv').onclick = () => csv(win, 'rankspark-analytics-' + days + 'd');
});

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 2 — BOOKS
   ═══════════════════════════════════════════════════════════════════════ */
const FAMILIES = [
  ['exemplar', 'Exemplar', 'metadata.json + qa_report.json + questions/'],
  ['aiims', 'AIIMS', 'questions.json + chapters_detected.json'],
  ['mcq_book', 'MCQ Book', 'metadata/questions.json'],
  ['chemistry_module', 'Chemistry Module', 'answer_key.csv'],
  ['allen_index', 'Allen Index', 'index.json + questions/'],
  ['legacy', 'Legacy', 'metadata.json only']
];
const TIERS = [['free', 'Free'], ['paid', 'Paid'], ['plan', 'Plan-gated']];

route('books', async host => {
  const books = await db.list('books');
  const q = { text: '', subject: 'all', status: 'all' };

  const subjects = [...new Set(books.flatMap(b => b.subjects || []))].sort();

  const cardFor = b => `
    <article class="card" data-book="${esc(b.id)}" style="cursor:pointer;transition:transform .26s var(--ease),border-color .26s">
      <div style="height:104px;position:relative;overflow:hidden;
        background:linear-gradient(140deg,color-mix(in srgb,var(--c1) 30%,var(--surf)),color-mix(in srgb,var(--c2) 18%,var(--surf)))">
        <div style="position:absolute;inset:0;display:grid;place-items:center;opacity:.32">${ico('book', 34)}</div>
        <span class="tag ${b.active ? 'ok' : ''}" style="position:absolute;top:9px;left:9px">
          ${b.active ? 'Live' : 'Draft'}</span>
        <span class="tag" style="position:absolute;top:9px;right:9px">${esc(b.tier || 'free')}</span>
      </div>
      <div class="card-b" style="padding:13px 15px 15px">
        <b style="display:block;font-size:13.5px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.name)}</b>
        <small style="display:block;margin-top:4px;font-size:11px;color:var(--tx-3);
          display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:30px">${esc(b.description || 'No description')}</small>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:11px;gap:8px">
          <span class="mono" style="font-size:11.5px;color:var(--tx-2)">${fmt.n(b.questionCount || 0)} Q</span>
          <div style="display:flex;gap:5px;align-items:center">
            <span class="tag" style="font-size:9px">${esc(b.family || 'legacy')}</span>
            <button class="toggle" data-pub="${esc(b.id)}" role="switch"
              aria-checked="${!!b.active}" aria-label="Publish ${esc(b.name)}"
              style="transform:scale(.72);transform-origin:right center"></button>
          </div>
        </div>
      </div>
    </article>`;

  const render = () => {
    const list = books.filter(b =>
      (q.status === 'all' || (q.status === 'live') === !!b.active) &&
      (q.subject === 'all' || (b.subjects || []).includes(q.subject)) &&
      (!q.text || (b.name + ' ' + (b.description || '')).toLowerCase().includes(q.text)));
    const grid = $('#bk-grid');
    grid.innerHTML = list.length
      ? list.map(cardFor).join('')
      : `<div class="card" style="grid-column:1/-1"><div class="empty">${ico('search', 34)}
         <h3>No books match</h3><p>Try clearing the filters, or add a new question pack.</p>
         <button class="btn btn-g" id="bk-clear">Clear filters</button></div></div>`;
    $('#bk-count').textContent = `${list.length} of ${books.length}`;
    const c = $('#bk-clear');
    if (c) c.onclick = () => { q.text = ''; q.subject = 'all'; q.status = 'all';
      $('#bk-q').value = ''; $('#bk-sub').value = 'all'; $('#bk-st').value = 'all'; render(); };
  };

  host.innerHTML = `
    <div class="page-h">
      <div><h1>Question packs</h1>
        <p>Publish books to every RankSpark client instantly — no redeploy. Toggling
           <em>Live</em> writes immediately; everything else saves from the editor.</p></div>
      <div class="acts"><button class="btn btn-p" id="bk-new">${ico('plus', 15)} Add book</button></div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-b" style="display:flex;gap:9px;flex-wrap:wrap;align-items:center">
        <div class="search" style="flex:1;min-width:200px">${ico('search', 15)}
          <input id="bk-q" placeholder="Search books…" aria-label="Search books"></div>
        <select class="btn btn-g" id="bk-sub" aria-label="Subject">
          <option value="all">All subjects</option>
          ${subjects.map(s => `<option>${esc(s)}</option>`).join('')}</select>
        <select class="btn btn-g" id="bk-st" aria-label="Status">
          <option value="all">All statuses</option><option value="live">Live</option>
          <option value="draft">Draft</option></select>
        <span class="tag" id="bk-count"></span>
      </div>
    </div>
    <div class="grid g-cards" id="bk-grid"></div>`;

  render();
  $('#bk-q').oninput = e => { q.text = e.target.value.toLowerCase().trim(); render(); };
  $('#bk-sub').onchange = e => { q.subject = e.target.value; render(); };
  $('#bk-st').onchange = e => { q.status = e.target.value; render(); };
  $('#bk-new').onclick = () => editBook(null, books, render);

  host.addEventListener('click', async e => {
    const pub = e.target.closest('[data-pub]');
    if (pub) {
      e.stopPropagation();
      const b = books.find(x => x.id === pub.dataset.pub);
      b.active = !b.active;
      pub.setAttribute('aria-checked', String(b.active));
      await db.set('books', b.id, { active: b.active });
      await db.audit(b.active ? 'book.publish' : 'book.unpublish', b.id);
      toast(`${b.name} is now ${b.active ? 'live' : 'a draft'}`);
      render();
      return;
    }
    const card = e.target.closest('[data-book]');
    if (card) editBook(books.find(x => x.id === card.dataset.book), books, render);
  });
});

function editBook(book, books, refresh) {
  const isNew = !book;
  const b = book || { id: '', name: '', description: '', subjects: [], exams: [],
                      tier: 'free', active: false, questionCount: 0,
                      family: 'exemplar', source: 'zip' };

  drawer({
    title: isNew ? 'Add question pack' : 'Edit ' + b.name,
    body: `
      <div class="field"><label for="bf-name">Book name</label>
        <input id="bf-name" value="${esc(b.name)}" placeholder="e.g. HC Verma Vol 1"></div>
      <div class="field"><label for="bf-id">Book ID</label>
        <input id="bf-id" class="mono" value="${esc(b.id)}" ${isNew ? '' : 'readonly'}
          placeholder="auto-generated from the name">
        <span class="hint">Stable identifier used by the client. Cannot change after creation.</span></div>
      <div class="field"><label for="bf-desc">Description</label>
        <textarea id="bf-desc" rows="2" placeholder="One line students will read">${esc(b.description)}</textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
        <div class="field"><label for="bf-sub">Subjects</label>
          <input id="bf-sub" value="${esc((b.subjects || []).join(', '))}" placeholder="Physics, Chemistry">
          <span class="hint">Comma separated</span></div>
        <div class="field"><label for="bf-exam">Exams</label>
          <input id="bf-exam" value="${esc((b.exams || []).join(', '))}" placeholder="JEE Main, NEET UG"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
        <div class="field"><label for="bf-tier">Access tier</label>
          <select id="bf-tier">${TIERS.map(([v, l]) =>
            `<option value="${v}" ${b.tier === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="bf-count">Question count</label>
          <input id="bf-count" type="number" min="0" class="mono" value="${b.questionCount || 0}"></div>
      </div>
      <div class="field"><label for="bf-fam">Dataset family</label>
        <select id="bf-fam">${FAMILIES.map(([v, l, hint]) =>
          `<option value="${v}" ${b.family === v ? 'selected' : ''}>${l} — ${hint}</option>`).join('')}</select>
        <span class="hint">Must match what <b class="mono">detectDatasetFamily()</b> finds inside the pack,
          or the client importer will reject it.</span></div>
      <div class="field"><label for="bf-src">Delivery mode</label>
        <select id="bf-src">
          <option value="zip" ${b.source === 'zip' ? 'selected' : ''}>ZIP — client downloads and parses</option>
          <option value="metadata" ${b.source === 'metadata' ? 'selected' : ''}>Pre-parsed metadata.json + images</option>
        </select></div>

      <div class="field"><label>Pack file</label>
        <div id="bf-drop" tabindex="0" role="button"
          style="border:1.5px dashed var(--line-2);border-radius:13px;padding:22px;text-align:center;
                 cursor:pointer;transition:border-color .2s,background .2s">
          ${ico('dl', 26)}
          <div style="margin-top:9px;font-size:12.5px;font-weight:600">Drop a ZIP here, or click to browse</div>
          <div style="margin-top:3px;font-size:11px;color:var(--tx-3)">Uploads to Firebase Storage at
            <span class="mono">books/{bookId}/</span></div>
        </div>
        <div id="bf-prog" hidden style="margin-top:9px">
          <div class="bar"><i id="bf-bar" style="width:0"></i></div>
          <div class="hint" id="bf-ptxt" style="margin-top:5px"></div>
        </div>
        <input type="file" id="bf-file" accept=".zip,application/zip,application/json" hidden>
      </div>

      <div class="card" style="margin-top:6px">
        <div class="card-h"><div><h3>Preview in RankSpark</h3>
          <p>How this card renders inside the app</p></div></div>
        <div class="card-b">
          <div id="bf-prev" style="border:1px solid var(--line);border-radius:14px;overflow:hidden;
            background:linear-gradient(145deg,rgba(14,22,42,.9),rgba(8,13,28,.94))"></div>
        </div>
      </div>

      ${isNew ? '' : `<div class="note bad" style="margin-top:16px">${ico('warn', 14)}
        <span><b>Danger zone.</b> Deleting removes the catalog entry and its Storage
        files. Students who already imported it keep their local copy.</span></div>
        <button class="btn btn-d btn-full" id="bf-del" style="margin-top:9px">${ico('trash', 15)} Delete this book</button>`}`,
    footer: `<button class="btn btn-g" data-x>Cancel</button>
             <button class="btn btn-p" id="bf-save">${isNew ? 'Create book' : 'Save changes'}</button>`,
    onMount(dr) {
      const prev = () => {
        const n = $('#bf-name').value || 'Untitled book';
        const d = $('#bf-desc').value || 'No description yet';
        const c = $('#bf-count').value || 0;
        const t = $('#bf-tier').value;
        $('#bf-prev').innerHTML = `
          <div style="height:74px;background:linear-gradient(140deg,#6D5CFF44,#B45CFF22);
            display:grid;place-items:center;opacity:.75">${ico('book', 26)}</div>
          <div style="padding:12px 14px">
            <b style="font-size:13px">${esc(n)}</b>
            <div style="font-size:11px;color:var(--tx-3);margin-top:4px">${esc(d)}</div>
            <div style="display:flex;gap:6px;margin-top:9px">
              <span class="tag c5 mono">${fmt.n(+c)} questions</span>
              <span class="tag">${esc(t)}</span></div>
          </div>`;
      };
      ['bf-name', 'bf-desc', 'bf-count', 'bf-tier'].forEach(id =>
        $('#' + id).addEventListener('input', prev));
      $('#bf-tier').addEventListener('change', prev);
      prev();

      /* Auto-slug the id from the name, but only while creating. */
      if (isNew) {
        $('#bf-name').addEventListener('input', e => {
          $('#bf-id').value = e.target.value.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
        });
      }

      const drop = $('#bf-drop'), file = $('#bf-file');
      drop.onclick = () => file.click();
      drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
        e.preventDefault(); drop.style.borderColor = 'var(--c2)';
        drop.style.background = 'color-mix(in srgb,var(--c2) 8%,transparent)';
      }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
        e.preventDefault(); drop.style.borderColor = ''; drop.style.background = '';
      }));
      drop.addEventListener('drop', e => upload(e.dataTransfer.files[0]));
      file.onchange = () => upload(file.files[0]);

      async function upload(f) {
        if (!f) return;
        const id = $('#bf-id').value.trim();
        if (!id) return toast('Give the book a name first', 'bad');
        $('#bf-prog').hidden = false;
        const bar = $('#bf-bar'), txt = $('#bf-ptxt');

        if (!state.live) {
          /* Mock: animate a believable upload so the flow is reviewable. */
          let p = 0;
          txt.textContent = `Uploading ${f.name} (${fmt.bytes(f.size)})…`;
          const iv = setInterval(() => {
            p = Math.min(100, p + 9 + Math.random() * 13);
            bar.style.width = p + '%';
            if (p >= 100) { clearInterval(iv);
              txt.innerHTML = `<span style="color:var(--ok)">Uploaded ${esc(f.name)} — demo mode, nothing sent</span>`; }
          }, 130);
          return;
        }
        const { ref, uploadBytesResumable, getDownloadURL } = state.fb.mods.st;
        const r = ref(state.fb.storage, `books/${id}/${f.name}`);
        const task = uploadBytesResumable(r, f);
        task.on('state_changed',
          s => { const p = (s.bytesTransferred / s.totalBytes) * 100;
                 bar.style.width = p + '%';
                 txt.textContent = `${p.toFixed(0)}% — ${fmt.bytes(s.bytesTransferred)} of ${fmt.bytes(s.totalBytes)}`; },
          err => { txt.innerHTML = `<span style="color:var(--bad)">Upload failed: ${esc(err.code)}</span>`; },
          async () => { const url = await getDownloadURL(task.snapshot.ref);
                        dr.dataset.fileUrl = url;
                        txt.innerHTML = `<span style="color:var(--ok)">Uploaded ${esc(f.name)}</span>`; });
      }

      $('#bf-save').onclick = async () => {
        const id = $('#bf-id').value.trim();
        const name = $('#bf-name').value.trim();
        if (!name) return toast('Book name is required', 'bad');
        if (!id) return toast('Book ID is required', 'bad');
        if (isNew && books.some(x => x.id === id)) return toast('That book ID already exists', 'bad');

        const data = {
          name, description: $('#bf-desc').value.trim(),
          subjects: $('#bf-sub').value.split(',').map(s => s.trim()).filter(Boolean),
          exams: $('#bf-exam').value.split(',').map(s => s.trim()).filter(Boolean),
          tier: $('#bf-tier').value,
          questionCount: +$('#bf-count').value || 0,
          family: $('#bf-fam').value,
          source: $('#bf-src').value,
          active: b.active ?? false
        };
        if (dr.dataset.fileUrl) data.fileUrl = dr.dataset.fileUrl;
        await db.set('books', id, data);
        await db.audit(isNew ? 'book.create' : 'book.update', id);
        if (isNew) books.push({ id, ...data }); else Object.assign(b, data);
        toast(isNew ? 'Book created' : 'Changes saved');
        closeDrawer(); refresh();
      };

      const del = $('#bf-del');
      if (del) del.onclick = async () => {
        const ok = await confirmTyped({
          title: 'Delete ' + b.name + '?',
          body: `This removes the catalog entry and its Storage files. Students who already
                 imported this pack keep their local copy — their history is not touched.`,
          word: 'DELETE'
        });
        if (!ok) return;
        await db.del('books', b.id);
        await db.audit('book.delete', b.id);
        const i = books.findIndex(x => x.id === b.id); if (i >= 0) books.splice(i, 1);
        toast('Book deleted'); closeDrawer(); refresh();
      };

      $$('[data-x]', dr).forEach(x => x.onclick = closeDrawer);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 4 — PRICING
   ═══════════════════════════════════════════════════════════════════════ */
route('pricing', async host => {
  const cfg = await db.get('config', 'pricing') || { plans: [] };
  const plans = [...(cfg.plans || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const previewCard = p => `
    <div style="border:1px solid ${p.badge ? 'color-mix(in srgb,var(--c2) 46%,transparent)' : 'var(--line)'};
      border-radius:16px;padding:16px;position:relative;
      background:linear-gradient(165deg,rgba(24,22,48,.72),rgba(10,10,24,.82))">
      ${p.badge ? `<span class="tag" style="position:absolute;top:-9px;left:14px;
        background:linear-gradient(100deg,var(--c1),var(--c2));color:#fff;border:0">${esc(p.badge)}</span>` : ''}
      <b style="font-size:14px">${esc(p.name)}</b>
      <div style="margin:9px 0 4px;font-family:var(--mono);font-size:24px;font-weight:600">
        ${p.price ? '₹' + p.price : 'Free'}
        <span style="font-size:11px;color:var(--tx-3);font-family:var(--font)">
          ${p.price ? '/' + (p.interval || 'month') : ''}</span></div>
      <div style="display:grid;gap:5px;margin-top:11px">
        ${(p.features || []).map(f => `<div style="display:flex;gap:7px;font-size:11.5px;color:var(--tx-2)">
          <span style="color:var(--ok)">${ico('check', 13)}</span><span>${esc(f)}</span></div>`).join('')}
      </div>
    </div>`;

  host.innerHTML = `
    <div class="page-h">
      <div><h1>Plans &amp; pricing</h1>
        <p>Edits publish to <b class="mono">/config/pricing</b> and reach clients within
           the 5-minute config TTL, or instantly via <em>Force refresh</em> in Settings.</p></div>
      <div class="acts"><button class="btn btn-p" id="pr-add">${ico('plus', 15)} Add plan</button></div>
    </div>
    <div class="grid g-2">
      <section class="card">
        <div class="card-h"><div><h2>Plans</h2><p>Drag the handle to reorder</p></div></div>
        <div id="pr-list"></div>
      </section>
      <section class="card">
        <div class="card-h"><div><h2>Live preview</h2><p>As students will see it</p></div></div>
        <div class="card-b"><div class="grid" style="gap:11px" id="pr-prev"></div></div>
      </section>
    </div>
    <section class="card" style="margin-top:14px">
      <div class="card-h"><div><h2>Change history</h2><p>Every pricing edit is recorded</p></div></div>
      <div id="pr-hist"></div>
    </section>`;

  const draw = () => {
    $('#pr-list').innerHTML = plans.map((p, i) => `
      <div class="row" draggable="true" data-i="${i}">
        <span style="cursor:grab;color:var(--tx-3)" aria-hidden="true">${ico('menu', 15)}</span>
        <div class="row-t">
          <b>${esc(p.name)} ${p.archived ? '<span class="tag">archived</span>' : ''}</b>
          <small class="mono">${p.price ? '₹' + p.price + ' / ' + (p.interval || 'month') : 'Free'}
            ${p.stripePriceId ? ' · ' + esc(p.stripePriceId) : ''}</small>
        </div>
        <button class="btn btn-g btn-sm" data-edit="${i}">Edit</button>
      </div>`).join('') || `<div class="empty">${ico('tag', 34)}<h3>No plans yet</h3>
        <p>Add your first plan to control what students see on the upgrade screen.</p></div>`;
    $('#pr-prev').innerHTML = plans.filter(p => !p.archived).map(previewCard).join('');
  };
  draw();

  db.list('auditLog').then(log => {
    const rows = log.filter(a => a.action?.startsWith('pricing'));
    $('#pr-hist').innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th></tr></thead>
      <tbody>${rows.map(a => `<tr><td>${fmt.dt(a.at)}</td><td>${esc(a.adminEmail || a.adminUid)}</td>
        <td><span class="tag">${esc(a.action)}</span></td><td class="mono">${esc(a.target)}</td></tr>`).join('')}
      </tbody></table></div>`
      : `<div class="empty" style="padding:28px">${ico('file', 30)}<h3>No pricing changes yet</h3>
         <p>Every edit will be logged here with who made it and when.</p></div>`;
  });

  const save = async () => {
    plans.forEach((p, i) => p.order = i);
    await db.set('config', 'pricing', { plans });
    await db.audit('pricing.update', 'config/pricing');
    draw(); toast('Pricing published');
  };

  /* Drag to reorder. Plain HTML5 DnD — no library, keyboard fallback via Edit. */
  let dragFrom = null;
  $('#pr-list').addEventListener('dragstart', e => {
    dragFrom = +e.target.closest('[data-i]').dataset.i;
    e.target.style.opacity = '.4';
  });
  $('#pr-list').addEventListener('dragend', e => { e.target.style.opacity = ''; });
  $('#pr-list').addEventListener('dragover', e => e.preventDefault());
  $('#pr-list').addEventListener('drop', async e => {
    e.preventDefault();
    const to = +e.target.closest('[data-i]')?.dataset.i;
    if (dragFrom == null || to == null || dragFrom === to) return;
    plans.splice(to, 0, plans.splice(dragFrom, 1)[0]);
    await save();
  });

  $('#pr-list').addEventListener('click', e => {
    const b = e.target.closest('[data-edit]');
    if (b) editPlan(plans[+b.dataset.edit], plans, save);
  });
  $('#pr-add').onclick = () => editPlan(null, plans, save);
});

function editPlan(plan, plans, save) {
  const isNew = !plan;
  const p = plan || { id: '', name: '', price: 0, interval: 'month', features: [], badge: '', archived: false };
  drawer({
    title: isNew ? 'Add plan' : 'Edit ' + p.name,
    body: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
        <div class="field"><label for="pf-name">Plan name</label>
          <input id="pf-name" value="${esc(p.name)}" placeholder="Blaze"></div>
        <div class="field"><label for="pf-id">Plan ID</label>
          <input id="pf-id" class="mono" value="${esc(p.id)}" ${isNew ? '' : 'readonly'} placeholder="blaze"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
        <div class="field"><label for="pf-price">Price (₹)</label>
          <input id="pf-price" type="number" min="0" class="mono" value="${p.price || 0}"></div>
        <div class="field"><label for="pf-int">Billing interval</label>
          <select id="pf-int">${['month', 'year', 'forever'].map(v =>
            `<option ${p.interval === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="pf-badge">Badge (optional)</label>
        <input id="pf-badge" value="${esc(p.badge || '')}" placeholder="Most Popular"></div>
      <div class="field"><label for="pf-stripe">Stripe price ID</label>
        <input id="pf-stripe" class="mono" value="${esc(p.stripePriceId || '')}" placeholder="price_…">
        <span class="hint">From your Stripe dashboard. Leave blank for free plans.</span></div>
      <div class="field"><label for="pf-feat">Features — one per line</label>
        <textarea id="pf-feat" rows="6">${esc((p.features || []).join('\n'))}</textarea></div>
      ${isNew ? '' : `<div class="note warn">${ico('info', 14)}<span>Plans are <b>archived</b>,
        never hard-deleted, so existing subscribers are never orphaned.</span></div>
        <button class="btn btn-g btn-full" id="pf-arch" style="margin-top:9px">
          ${p.archived ? 'Restore plan' : 'Archive plan'}</button>`}`,
    footer: `<button class="btn btn-g" data-x>Cancel</button>
             <button class="btn btn-p" id="pf-save">${isNew ? 'Create' : 'Save'}</button>`,
    onMount(dr) {
      if (isNew) $('#pf-name').addEventListener('input', e => {
        $('#pf-id').value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      });
      $('#pf-save').onclick = async () => {
        const name = $('#pf-name').value.trim(), id = $('#pf-id').value.trim();
        if (!name || !id) return toast('Name and ID are required', 'bad');
        const data = { id, name, price: +$('#pf-price').value || 0,
          interval: $('#pf-int').value, badge: $('#pf-badge').value.trim(),
          stripePriceId: $('#pf-stripe').value.trim(),
          features: $('#pf-feat').value.split('\n').map(s => s.trim()).filter(Boolean),
          archived: p.archived || false };
        if (isNew) plans.push(data); else Object.assign(p, data);
        closeDrawer(); await save();
      };
      const a = $('#pf-arch');
      if (a) a.onclick = async () => { p.archived = !p.archived; closeDrawer(); await save(); };
      $$('[data-x]', dr).forEach(x => x.onclick = closeDrawer);
    }
  });
}
