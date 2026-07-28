/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK — ANALYTICS REDESIGN  (part 4)
   ───────────────────────────────────────────────────────────────────────────
   WHY THIS EXISTS
   The shipped analytics layer (#anx) has two problems:

   1. It renders invisible. `.x-in` sets opacity:0 with `animation: xIn …
      forwards`, but the motion layer's `#anx>*` rule (ID specificity) swaps in
      `mLift … backwards`. A `backwards` fill restores the base style when the
      animation ends, so every panel lands back at opacity:0. Only users with
      prefers-reduced-motion ever saw the page.

   2. Its information architecture is hub-and-spoke: eight tiles that each
      REPLACE the page. Comparing "my weak chapters" with "my slow chapters"
      means three navigations. Filters were split across two locations.

   WHAT THIS DOES
   One scrollable page, ordered by the questions a student actually asks:
     How am I doing?  →  What do I fix next?  →  Show me everything  →  Trends
   All original capabilities are preserved (donut, trend, heatmap, exams,
   chapters, pace, sessions, book scoping, Wilson ranking) — recomposed, not
   removed. The statistics layer (RS_META) is reused verbatim.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var W = window, D = document;

  function APP()  { return W.__rsApp || null; }
  function META() { return W.RS_META || null; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }
  function dur(s) {
    s = Math.max(0, Math.round(Number(s) || 0));
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    return m < 60 ? (m + 'm ' + (s % 60) + 's') : (Math.floor(m / 60) + 'h ' + (m % 60) + 'm');
  }
  function durShort(s) {
    s = Math.max(0, Math.round(Number(s) || 0));
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    return m < 60 ? (m + 'm') : (Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : ''));
  }
  function hue(v) { return v >= 75 ? '#2ee3a2' : v >= 50 ? '#5b9dff' : v >= 30 ? '#ffb74d' : '#ff6b81'; }
  function pctOf(a, b) { return b ? (a / b) * 100 : 0; }

  /* Grouping dimensions, richest first — unchanged from the original. */
  var DIMS = [
    { key: 'topics',    field: 'topic',    label: 'Topic',    w: 1.00 },
    { key: 'chapters',  field: 'chapter',  label: 'Chapter',  w: 0.95 },
    { key: 'exercises', field: 'exercise', label: 'Exercise', w: 0.90 },
    { key: 'chemTypes', field: 'chemType', label: 'Branch',   w: 0.70 },
    { key: 'breakdown', field: 'subject',  label: 'Subject',  w: 0.55 }
  ];

  /* ── view state ─────────────────────────────────────────────────────── */
  var S = {
    scope: 'all',        // book id
    dim: null,           // active grouping
    filter: 'all',       // all | weak | strong | slow | new
    sort: 'priority',    // priority | accuracy | attempts | pace | name
    dir: 1,
    limit: 12,
    section: 'top'
  };

  /* ── data ───────────────────────────────────────────────────────────── */
  function booksOf(entries) {
    var seen = {}, out = [];
    entries.forEach(function (e) {
      var id = e.pack_id || '__legacy__';
      if (!seen[id]) { seen[id] = { id: id, name: e.book_name || 'Earlier sessions', n: 0 }; out.push(seen[id]); }
      seen[id].n++;
      if (e.book_name) seen[id].name = e.book_name;
    });
    return out;
  }

  /* Never merge a chapter name across books — "Chapter 1" means different
     things in different books. Key includes pack id. */
  function rollup(entries, def) {
    var map = {}, order = [], m = META();
    entries.forEach(function (e) {
      (e[def.key] || []).forEach(function (r) {
        var name = r[def.field]; if (!name) return;
        var k = (e.pack_id || '__legacy__') + '\u241F' + name;
        if (!map[k]) {
          map[k] = { name: name, book: e.book_name || '', total: 0, correct: 0,
                     incorrect: 0, attempted: 0, time: 0 };
          order.push(k);
        }
        var g = map[k];
        g.total += r.total || 0; g.correct += r.correct || 0;
        g.incorrect += r.incorrect || 0; g.attempted += r.attempted || 0;
        g.time += r.time || 0;
      });
    });
    return order.map(function (k) {
      var g = map[k];
      g.accuracy = pctOf(g.correct, g.attempted);
      g.avg = g.attempted ? g.time / g.attempted : 0;
      g.wLo = m ? m.wilsonLow(g.correct, g.attempted) : 0;
      g.verdict = m ? m.classify(g.correct, g.attempted) : 'insufficient';
      return g;
    });
  }

  function dimsOf(entries) {
    return DIMS.map(function (d) { return { def: d, rows: rollup(entries, d) }; })
      .filter(function (x) { return x.rows.length > 0; })
      .sort(function (a, b) { return b.def.w - a.def.w; });
  }

  function examRows(entries) {
    var map = {}, order = [];
    entries.forEach(function (e) {
      (e.exams || []).forEach(function (x) {
        var n = x.exam; if (!n) return;
        if (!map[n]) { map[n] = { name: n, attempted: 0, correct: 0 }; order.push(n); }
        map[n].attempted += x.attempted || 0; map[n].correct += x.correct || 0;
      });
    });
    return order.map(function (k) {
      var g = map[k]; g.accuracy = pctOf(g.correct, g.attempted); return g;
    });
  }

  function totals(entries) {
    var t = { c: 0, w: 0, skip: 0, time: 0 };
    entries.forEach(function (e) {
      t.c += e.correct || 0; t.w += e.incorrect || 0;
      t.skip += e.unattempted || 0; t.time += e.timeTaken || 0;
    });
    t.att = t.c + t.w;
    t.acc = pctOf(t.c, t.att);
    t.pace = t.att ? t.time / t.att : 0;
    t.n = entries.length;
    return t;
  }

  /* Priority = how much is there to gain × how confident are we it's real.
     Wilson lower bound keeps a 1/2 fluke from outranking a 40-question weakness. */
  function priority(g) {
    var m = META();
    var conf = Math.min(1, g.attempted / ((m ? m.MIN_N : 5) * 3));
    return (1 - g.wLo) * conf * Math.log10(10 + g.attempted);
  }

  /* ── visuals ────────────────────────────────────────────────────────── */
  function ring(pct, size) {
    size = size || 92;
    var r = (size - 12) / 2, c = 2 * Math.PI * r;
    var off = c - (Math.max(0, Math.min(100, pct)) / 100) * c, k = hue(pct);
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true" style="flex:0 0 auto">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="9"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + k + '" stroke-width="9" stroke-linecap="round"' +
      ' stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')">' +
      '<animate attributeName="stroke-dashoffset" from="' + c.toFixed(1) + '" to="' + off.toFixed(1) + '" dur=".9s" fill="freeze" calcMode="spline" keySplines="0.22 1 0.36 1" keyTimes="0;1"/></circle>' +
      /* currentColor so the ring label follows the theme's text colour —
         a hard-coded #fff disappears on the light theme. */
      '<text x="50%" y="50%" text-anchor="middle" dy="6" fill="currentColor" font-size="19" font-weight="800">' + Math.round(pct) + '%</text></svg>';
  }

  function donut(c, w, u) {
    var tot = c + w + u;
    var cd = tot ? c / tot * 360 : 0, wd = tot ? w / tot * 360 : 0;
    var g = tot
      ? 'conic-gradient(#2ee3a2 0 ' + cd + 'deg,#ff6b81 ' + cd + 'deg ' + (cd + wd) + 'deg,#55607d ' + (cd + wd) + 'deg 360deg)'
      : 'conic-gradient(rgba(255,255,255,.07) 0 360deg)';
    var row = function (col, label, n) {
      return '<div class="a2-lgi"><i style="background:' + col + '"></i>' + label +
             '<b>' + n + '</b><u>' + (tot ? Math.round(n / tot * 100) : 0) + '%</u></div>';
    };
    return '<div class="a2-donut"><div class="a2-dring" style="background:' + g + '">' +
      '<div class="a2-dmid"><div><b>' + tot + '</b><span>Questions</span></div></div></div>' +
      '<div class="a2-lg">' + row('#2ee3a2', 'Correct', c) + row('#ff6b81', 'Wrong', w) +
      row('#55607d', 'Skipped', u) + '</div></div>';
  }

  /* Accuracy trend with a mean reference line, so a point reads as
     above/below your own average rather than as a bare number. */
  function trend(seq) {
    if (!seq.length) return '<div class="a2-note">No sessions in this range.</div>';
    var W_ = 400, H = 168, P = 8;
    if (seq.length === 1) {
      var v = Number(seq[0].accuracy || 0);
      return '<svg class="a2-chart" viewBox="0 0 ' + W_ + ' ' + H + '" preserveAspectRatio="none">' +
        '<circle cx="' + W_ / 2 + '" cy="' + (H - P - (v / 100) * (H - P * 2)) + '" r="5" fill="' + hue(v) + '"/></svg>';
    }
    var vals = seq.map(function (e) { return Math.max(0, Math.min(100, Number(e.accuracy || 0))); });
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    var X = function (i) { return P + i * ((W_ - P * 2) / (vals.length - 1)); };
    var Y = function (v) { return H - P - (v / 100) * (H - P * 2); };
    var pts = vals.map(function (v, i) { return X(i) + ',' + Y(v).toFixed(1); }).join(' ');
    var area = P + ',' + (H - P) + ' ' + pts + ' ' + (W_ - P) + ',' + (H - P);
    var dots = vals.map(function (v, i) {
      return '<circle class="pt" cx="' + X(i) + '" cy="' + Y(v).toFixed(1) + '" r="2.6" fill="' + hue(v) + '"><title>' +
        new Date(seq[i].createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' — ' + Math.round(v) + '%</title></circle>';
    }).join('');
    return '<svg class="a2-chart" viewBox="0 0 ' + W_ + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Accuracy trend">' +
      '<defs><linearGradient id="a2g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="rgba(168,85,247,.34)"/><stop offset="1" stop-color="rgba(168,85,247,0)"/></linearGradient></defs>' +
      '<line x1="' + P + '" y1="' + Y(mean).toFixed(1) + '" x2="' + (W_ - P) + '" y2="' + Y(mean).toFixed(1) +
        '" stroke="rgba(255,255,255,.22)" stroke-width="1" stroke-dasharray="4 4"/>' +
      '<text x="' + (W_ - P) + '" y="' + (Y(mean) - 5).toFixed(1) + '" text-anchor="end" fill="#7a86a4" font-size="9">avg ' + Math.round(mean) + '%</text>' +
      '<polyline points="' + area + '" fill="url(#a2g)" stroke="none"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="#a855f7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      dots + '</svg>';
  }

  function heatmap(entries) {
    var by = {}, total = 0;
    entries.forEach(function (e) {
      var d = new Date(e.createdAt); d.setHours(0, 0, 0, 0);
      var k = d.getTime();
      var n = (e.attempted != null) ? e.attempted : ((e.correct || 0) + (e.incorrect || 0));
      by[k] = (by[k] || 0) + n; total += n;
    });
    var cells = '', active = 0, today = new Date(); today.setHours(0, 0, 0, 0);
    for (var i = 29; i >= 0; i--) {
      var day = new Date(today.getTime() - i * 86400000);
      var n2 = by[day.getTime()] || 0;
      if (n2) active++;
      var lv = n2 === 0 ? 0 : n2 < 5 ? 1 : n2 < 12 ? 2 : n2 < 25 ? 3 : 4;
      cells += '<div class="a2-hc' + (lv ? ' l' + lv : '') + '" title="' +
        day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' — ' + n2 + ' question' + (n2 === 1 ? '' : 's') + '"></div>';
    }
    return {
      html: '<div class="a2-heat">' + cells + '</div>' +
        '<div class="a2-hleg"><span>Less</span><i style="background:rgba(255,255,255,.045)"></i>' +
        '<i style="background:#35206d"></i><i style="background:#6233b1"></i>' +
        '<i style="background:#944bdf"></i><i style="background:#cf79ff"></i><span>More</span></div>',
      active: active, total: total
    };
  }

  /* ── verdict: one honest sentence about the whole range ─────────────── */
  function verdict(t, delta, weak) {
    if (t.n < 3) {
      return { tone: '#5b9dff', tag: 'Getting started', head: 'Building your baseline',
        body: 'You have <b>' + t.n + ' session' + (t.n === 1 ? '' : 's') + '</b> saved. After three, RankSpark can tell you whether you are improving rather than just what happened.' };
    }
    if (delta != null && delta >= 5) {
      return { tone: '#2ee3a2', tag: 'Improving', head: 'You are trending upward',
        body: 'Accuracy is up <b>' + Math.abs(delta).toFixed(0) + ' points</b> versus your earlier sessions in this range. Keep the current routine.' };
    }
    if (delta != null && delta <= -5) {
      return { tone: '#ff6b81', tag: 'Slipping', head: 'Accuracy is falling',
        body: 'You are down <b>' + Math.abs(delta).toFixed(0) + ' points</b> against your earlier sessions. Slow down and review solutions before attempting more volume.' };
    }
    if (weak && weak.length) {
      return { tone: '#ffb74d', tag: 'Holding steady', head: 'Steady, with clear gaps',
        body: 'Accuracy is flat at <b>' + t.acc.toFixed(0) + '%</b>. <b>' + weak.length + '</b> area' + (weak.length === 1 ? ' is' : 's are') + ' pulling it down — fixing those is the fastest available gain.' };
    }
    return { tone: '#2ee3a2', tag: 'Consistent', head: 'Holding a strong line',
      body: 'Accuracy is steady at <b>' + t.acc.toFixed(0) + '%</b> with no weak areas above the confidence threshold. Add harder material or new chapters.' };
  }

  function deltaChip(cur, prev, invert, fmt) {
    if (prev == null || !isFinite(prev) || prev === 0) return '';
    var d = cur - prev;
    var better = invert ? d < 0 : d > 0;
    var cls = Math.abs(d) < 0.5 ? 'flat' : better ? 'up' : 'dn';
    var arrow = Math.abs(d) < 0.5 ? '·' : d > 0 ? '▲' : '▼';
    return '<span class="a2-d ' + cls + '">' + arrow + ' ' + (fmt ? fmt(Math.abs(d)) : Math.abs(d).toFixed(0)) + '</span>';
  }

  /* ── priority table ─────────────────────────────────────────────────── */
  /* RS_META.classify returns FOUR verdicts: strong | weak | neutral |
     insufficient. The original UI only handled three, so every 'neutral' row
     — the most common case — was mislabelled "NEEDS 0 MORE ATTEMPTS", which
     read as a data error to the user. Each verdict now gets its own label. */
  function tagFor(g) {
    var m = META(), MIN = m ? m.MIN_N : 5;
    if (g.verdict === 'weak')   return '<span class="a2-tag w">WEAK</span>';
    if (g.verdict === 'strong') return '<span class="a2-tag s">STRONG</span>';
    if (g.verdict === 'insufficient')
      return '<span class="a2-tag i">NEEDS ' + Math.max(1, MIN - g.attempted) + ' MORE</span>';
    return '<span class="a2-tag n">MIXED</span>';
  }

  function tableRows(rows, medPace) {
    return rows.map(function (g) {
      var slow = medPace && g.avg > medPace * 1.5 && g.attempted >= 3;
      var tag = tagFor(g);
      return '<div class="a2-tr">' +
        '<div class="a2-tn"><b title="' + esc(g.name) + '">' + esc(g.name) + '</b>' +
          '<span class="a2-tmeta">' + tag +
          (S.scope === 'all' && g.book ? '<span>' + esc(g.book) + '</span>' : '') +
          (slow ? '<span class="a2-tag slow">SLOW</span>' : '') +
          '</span></div>' +
        '<div class="a2-num">' + g.correct + '/' + g.attempted + '</div>' +
        '<div class="a2-num" style="color:' + hue(g.accuracy) + '">' + Math.round(g.accuracy) + '%</div>' +
        '<div class="a2-num pace">' + (g.avg ? durShort(g.avg) : '—') + '</div>' +
        '<div class="a2-tbar"><i data-w="' + Math.max(2, Math.min(100, g.accuracy)) + '" style="background:' + hue(g.accuracy) + '"></i></div>' +
      '</div>';
    }).join('');
  }

  function applyFilterSort(rows, medPace, attention) {
    var out = rows.slice();
    if (S.filter === 'weak')   { var ids = attention || []; out = out.filter(function (g) { return ids.indexOf(g) >= 0; }); }
    if (S.filter === 'strong') out = out.filter(function (g) { return g.verdict === 'strong'; });
    if (S.filter === 'mixed')  out = out.filter(function (g) { return g.verdict === 'neutral'; });
    if (S.filter === 'new')    out = out.filter(function (g) { return g.verdict === 'insufficient'; });
    if (S.filter === 'slow')   out = out.filter(function (g) { return medPace && g.avg > medPace * 1.5 && g.attempted >= 3; });

    var cmp = {
      priority: function (a, b) { return priority(b) - priority(a); },
      accuracy: function (a, b) { return a.accuracy - b.accuracy; },
      attempts: function (a, b) { return b.attempted - a.attempted; },
      pace:     function (a, b) { return b.avg - a.avg; },
      name:     function (a, b) { return a.name.localeCompare(b.name); }
    }[S.sort] || function () { return 0; };
    out.sort(function (a, b) { return cmp(a, b) * S.dir; });
    return out;
  }

  /* Retire the legacy container. It carries `#anx{display:block!important}`
     from a <style> block that sits AFTER our stylesheet in the document, so a
     competing rule of equal specificity loses on source order. An inline
     style beats every stylesheet rule regardless of position. */
  function retire() {
    var old = D.getElementById('anx');
    if (old && old.style.display !== 'none') {
      old.style.setProperty('display', 'none', 'important');
      old.setAttribute('aria-hidden', 'true');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════ */
  function render() {
    var page = D.getElementById('page-analytics');
    if (!page || !page.classList.contains('active')) return;
    var app = APP(), m = META();
    if (!app || !m) return;

    retire();

    var host = D.getElementById('anx2');
    if (!host) {
      host = D.createElement('div');
      host.id = 'anx2';
      var head = page.querySelector('.page-heading');
      if (head && head.parentNode) head.parentNode.insertBefore(host, head.nextSibling);
      else page.appendChild(host);
    }

    var st = app.state;
    var range = (st.analyticsFilters && st.analyticsFilters.range) || 'all';
    var cut = range === 'all' ? 0 : Date.now() - Number(range) * 86400000;
    var all = (st.history || []).filter(function (e) {
      return !cut || new Date(e.createdAt).getTime() >= cut;
    });

    if (!all.length) {
      host.innerHTML =
        '<div class="a2-r a2-p a2-empty"><h3>No sessions in this range</h3>' +
        '<p>Finish a practice session or a mock test and your analysis appears here. ' +
        'Every figure is computed from your own submitted attempts — nothing is estimated.</p>' +
        '<button class="a2-ago" data-a2-go="practice">Start a practice session</button></div>';
      return;
    }

    var books = booksOf(all);
    if (S.scope !== 'all' && !books.some(function (b) { return b.id === S.scope; })) S.scope = 'all';
    var entries = S.scope === 'all' ? all
      : all.filter(function (e) { return (e.pack_id || '__legacy__') === S.scope; });

    var dims = dimsOf(entries);
    var dim = dims.filter(function (d) { return d.def.key === S.dim; })[0] || dims[0] || null;
    if (dim) S.dim = dim.def.key;

    var t = totals(entries);
    var seq = entries.slice().sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });

    /* Split the range in half for period-over-period deltas. */
    var half = Math.floor(seq.length / 2);
    var prev = half >= 1 ? totals(seq.slice(0, half)) : null;
    var recent = half >= 1 ? totals(seq.slice(half)) : null;
    var accDelta = (prev && recent && seq.length >= 4) ? (recent.acc - prev.acc) : null;

    var rows = dim ? dim.rows : [];
    var paced = rows.filter(function (g) { return g.avg > 0; }).map(function (g) { return g.avg; }).sort(function (a, b) { return a - b; });
    var medPace = paced.length ? paced[Math.floor(paced.length / 2)] : 0;

    var weak = rows.filter(function (g) { return g.verdict === 'weak'; });
    var strong = rows.filter(function (g) { return g.verdict === 'strong'; });
    var fresh = rows.filter(function (g) { return g.verdict === 'insufficient'; });
    var mixed = rows.filter(function (g) { return g.verdict === 'neutral'; });
    var slowRows = rows.filter(function (g) { return medPace && g.avg > medPace * 1.5 && g.attempted >= 3; });

    /* Which areas deserve attention. Statistically-confirmed weak areas come
       first; if there are none, fall back to 'mixed' rows that are genuinely
       below par (sub-60% with real evidence). Without this the page could
       claim "nothing is failing" while displaying 42% rows — the exact
       contradiction the old three-verdict UI produced. */
    var attention = weak.length ? weak
      : mixed.filter(function (g) { return g.accuracy < 60 && g.attempted >= (m.MIN_N || 5); });
    var confirmed = weak.length > 0;

    var v = verdict(t, accDelta, attention);
    var exams = examRows(entries);
    var hm = heatmap(entries);

    var H = '';

    /* ── 1. sticky controls ─────────────────────────────────────────── */
    var rangeOpts = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All time']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (String(range) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    var bookOpts = '<option value="all"' + (S.scope === 'all' ? ' selected' : '') + '>All books (' + all.length + ')</option>' +
      books.map(function (b) {
        return '<option value="' + esc(b.id) + '"' + (S.scope === b.id ? ' selected' : '') + '>' + esc(b.name) + ' (' + b.n + ')</option>';
      }).join('');

    H += '<div class="a2-r a2-bar" id="a2-bar">' +
      '<select class="a2-sel" id="a2-range" aria-label="Date range">' + rangeOpts + '</select>' +
      (books.length > 1 ? '<select class="a2-sel" id="a2-book" aria-label="Book">' + bookOpts + '</select>' : '') +
      (dims.length > 1
        ? '<select class="a2-sel" id="a2-dim" aria-label="Group by">' + dims.map(function (d) {
            return '<option value="' + d.def.key + '"' + (d.def.key === S.dim ? ' selected' : '') +
                   '>By ' + d.def.label.toLowerCase() + '</option>'; }).join('') + '</select>'
        : '') +
      '<nav class="a2-jump">' +
        ['top:Overview', 'focus:Focus', 'all:Breakdown', 'trend:Trends', 'log:Sessions']
          .map(function (s) { var p = s.split(':');
            return '<button data-a2-jump="' + p[0] + '">' + p[1] + '</button>'; }).join('') +
      '</nav></div>';

    /* ── 2. verdict hero ────────────────────────────────────────────── */
    H += '<div class="a2-r a2-hero" id="a2-top" style="--a2-tone:' + v.tone + '">' +
      '<div class="a2-htop">' + ring(t.acc, 92) +
        '<div class="a2-htxt"><span class="a2-verdict">' + esc(v.tag) + '</span>' +
        '<h2>' + esc(v.head) + '</h2><p>' + v.body + '</p></div>' +
      '</div>' +
      '<div class="a2-kpi">' +
        '<div class="a2-k"><b>' + t.n + '</b><span>Sessions</span>' +
          (prev && recent ? deltaChip(recent.n, prev.n) : '') + '</div>' +
        '<div class="a2-k"><b>' + t.att + '</b><span>Answered</span>' +
          (prev && recent ? deltaChip(recent.att, prev.att) : '') + '</div>' +
        '<div class="a2-k"><b>' + Math.round(t.acc) + '%</b><span>Accuracy</span>' +
          (accDelta != null ? deltaChip(recent.acc, prev.acc, false, function (x) { return x.toFixed(0) + 'pt'; }) : '') + '</div>' +
        '<div class="a2-k"><b>' + durShort(t.pace) + '</b><span>Per question</span>' +
          (prev && recent && prev.pace ? deltaChip(recent.pace, prev.pace, true, function (x) { return Math.round(x) + 's'; }) : '') + '</div>' +
        '<div class="a2-k"><b>' + durShort(t.time) + '</b><span>Total time</span></div>' +
        '<div class="a2-k"><b>' + t.skip + '</b><span>Skipped</span></div>' +
      '</div></div>';

    /* ── 3. focus: the answer to "what do I fix?" ───────────────────── */
    var top3 = attention.slice().sort(function (a, b) { return priority(b) - priority(a); }).slice(0, 3);
    if (top3.length) {
      H += '<div class="a2-r a2-next" id="a2-focus">' +
        '<div class="a2-nh"><h3>Fix these next</h3><span>Ranked by likely marks gained</span></div>' +
        '<p class="a2-nsub">' +
        (confirmed
          ? 'Ordered by how much accuracy is missing and how sure we are it is real — not by raw percentage, so one unlucky question never jumps the queue.'
          : 'Nothing is statistically confirmed as weak yet, so these are your lowest scorers with enough attempts to be worth a look.') +
        '</p>' +
        top3.map(function (g, i) {
          return '<div class="a2-act">' +
            '<span class="a2-rank">' + (i + 1) + '</span>' +
            '<span class="a2-ainfo"><b>' + esc(g.name) + '</b>' +
              '<small>' + g.correct + ' of ' + g.attempted + ' correct' +
              (g.avg ? ' · ' + durShort(g.avg) + ' per question' : '') +
              (S.scope === 'all' && g.book ? ' · ' + esc(g.book) : '') + '</small></span>' +
            '<span class="a2-ameter"><i data-w="' + Math.max(3, g.accuracy) + '" style="background:' + hue(g.accuracy) + '"></i></span>' +
            '<span class="a2-apct" style="color:' + hue(g.accuracy) + '">' + Math.round(g.accuracy) + '%</span>' +
            '<button class="a2-ago" data-a2-practice="' + esc(g.name) + '">Practise</button>' +
          '</div>';
        }).join('') + '</div>';
    } else if (rows.length) {
      H += '<div class="a2-r a2-next good" id="a2-focus">' +
        '<div class="a2-nh"><h3>Nothing is failing</h3><span>Above the confidence threshold</span></div>' +
        '<p class="a2-nsub">No ' + esc(dim ? dim.def.label.toLowerCase() : 'area') +
        ' is scoring below par with enough attempts to act on. ' +
        (fresh.length ? 'Build evidence on the <b>' + fresh.length + '</b> area' + (fresh.length === 1 ? '' : 's') +
          ' with fewer than ' + m.MIN_N + ' attempts, or move to harder material.'
          : 'Add new chapters or raise difficulty.') + '</p>' +
        '<button class="a2-ago" data-a2-go="practice">Start a session</button></div>';
    }

    /* ── 4. breakdown — one table replacing four drill-downs ────────── */
    if (rows.length) {
      var filtered = applyFilterSort(rows, medPace, attention);
      var shown = filtered.slice(0, S.limit);
      var chip = function (id, label, n) {
        return '<button class="a2-chip' + (S.filter === id ? ' on' : '') + '" data-a2-filter="' + id + '">' +
               label + '<u>' + n + '</u></button>';
      };
      var sortBtn = function (id, label, cls) {
        return '<button class="' + (cls || '') + (S.sort === id ? ' on' : '') + '" data-a2-sort="' + id + '">' +
               label + (S.sort === id ? (S.dir === 1 ? ' ↓' : ' ↑') : '') + '</button>';
      };

      H += '<div class="a2-r a2-p" id="a2-all">' +
        '<div class="a2-ph"><h3>Full breakdown</h3><span>' + rows.length + ' ' +
          esc(dim.def.label.toLowerCase()) + (rows.length === 1 ? '' : 's') + '</span></div>' +
        '<p class="a2-psub">Everything in one list — filter and sort instead of navigating away. ' +
        'Verdicts need ' + m.MIN_N + '+ attempts.</p>' +
        '<div class="a2-ctl"><div class="a2-chips">' +
          chip('all', 'All', rows.length) +
          (attention.length ? chip('weak', 'Needs work', attention.length) : '') +
          (strong.length ? chip('strong', 'Strong', strong.length) : '') +
          (slowRows.length ? chip('slow', 'Slow', slowRows.length) : '') +
          (mixed.length ? chip('mixed', 'Mixed', mixed.length) : '') +
          (fresh.length ? chip('new', 'Low data', fresh.length) : '') +
        '</div></div>' +
        '<div class="a2-tbl"><div class="a2-thead">' +
          sortBtn('name', 'Area') +
          sortBtn('attempts', 'Done', 'n') +
          sortBtn('accuracy', 'Accuracy', 'n') +
          sortBtn('pace', 'Pace', 'n') +
          '<span>Progress</span>' +
        '</div>' +
        (shown.length ? tableRows(shown, medPace)
          : '<div class="a2-note">Nothing matches this filter.</div>') +
        '</div>' +
        (filtered.length > S.limit
          ? '<button class="a2-more" data-a2-more>Show ' + Math.min(24, filtered.length - S.limit) +
            ' more of ' + filtered.length + '</button>' : '') +
      '</div>';
    } else {
      H += '<div class="a2-r a2-p" id="a2-all"><div class="a2-note">These sessions carry no chapter, ' +
        'topic or exercise metadata, so no grouped comparison is possible. The totals above are exact.</div></div>';
    }

    /* ── 5. trends ──────────────────────────────────────────────────── */
    H += '<div class="a2-r a2-two" id="a2-trend">' +
      '<div class="a2-p"><div class="a2-ph"><h3>Accuracy trend</h3>' +
        (accDelta != null ? '<span style="color:' + (accDelta >= 0 ? '#2ee3a2' : '#ff6b81') + '">' +
          (accDelta >= 0 ? '▲' : '▼') + ' ' + Math.abs(accDelta).toFixed(0) + ' pts</span>' : '') +
        '</div><p class="a2-psub">Last ' + Math.min(seq.length, 14) + ' session' +
        (Math.min(seq.length, 14) === 1 ? '' : 's') + ', oldest to newest.</p>' +
        trend(seq.slice(-14)) +
        (seq.length > 1 ? '<div class="a2-clab"><span>' +
          new Date(seq.slice(-14)[0].createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
          '</span><span>' + new Date(seq[seq.length - 1].createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
          '</span></div>' : '') +
      '</div>' +
      '<div class="a2-p"><div class="a2-ph"><h3>Answer split</h3></div>' +
        '<p class="a2-psub">Every question in this range.</p>' + donut(t.c, t.w, t.skip) + '</div>' +
    '</div>';

    H += '<div class="a2-r a2-p"><div class="a2-ph"><h3>Study activity</h3>' +
      '<span>' + hm.active + ' active day' + (hm.active === 1 ? '' : 's') + ' · ' + hm.total + ' questions</span></div>' +
      '<p class="a2-psub">Last 30 days.</p>' + hm.html + '</div>';

    if (exams.length) {
      H += '<div class="a2-r a2-p"><div class="a2-ph"><h3>By exam source</h3>' +
        '<span>' + exams.length + ' exam' + (exams.length === 1 ? '' : 's') + '</span></div>' +
        '<p class="a2-psub">From each question\u2019s metadata.</p>' +
        exams.slice().sort(function (a, b) { return a.accuracy - b.accuracy; }).map(function (g) {
          return '<div class="a2-tr" style="grid-template-columns:minmax(0,1fr) 62px 68px 74px">' +
            '<div class="a2-tn"><b>' + esc(g.name) + '</b></div>' +
            '<div class="a2-num">' + g.correct + '/' + g.attempted + '</div>' +
            '<div class="a2-num" style="color:' + hue(g.accuracy) + '">' + Math.round(g.accuracy) + '%</div>' +
            '<div class="a2-tbar"><i data-w="' + Math.max(2, g.accuracy) + '" style="background:' + hue(g.accuracy) + '"></i></div>' +
          '</div>';
        }).join('') + '</div>';
    }

    /* ── 6. session log ─────────────────────────────────────────────── */
    var rev = seq.slice().reverse();
    H += '<div class="a2-r a2-p" id="a2-log"><div class="a2-ph"><h3>Recent sessions</h3>' +
      '<span>' + rev.length + ' saved</span></div>' +
      '<p class="a2-psub">Newest first. Tap a session to review its solutions.</p>' +
      rev.slice(0, 10).map(function (e) {
        var ac = Number(e.accuracy || 0);
        return '<div class="a2-sr">' +
          '<div><b>' + (e.mode === 'mock' ? 'Mock Test' : 'Practice') +
            (e.book_name ? ' · ' + esc(e.book_name) : '') + '</b>' +
            '<small>' + new Date(e.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
            ' · ' + (e.attempted || 0) + ' answered · ' + durShort(e.timeTaken) + '</small></div>' +
          '<span class="sc">' + (e.score || 0) + '/' + (e.maxScore || 0) + '</span>' +
          '<span class="ac" style="color:' + hue(ac) + '">' + Math.round(ac) + '%</span>' +
        '</div>';
      }).join('') + '</div>';

    host.innerHTML = H;

    /* Animate bars after paint so widths transition from 0. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var bars = host.querySelectorAll('[data-w]');
        for (var i = 0; i < bars.length; i++) bars[i].style.width = bars[i].getAttribute('data-w') + '%';
      });
    });

    observeBar();
  }

  /* Shadow under the sticky bar only once it is actually stuck. */
  var barObs = null;
  function observeBar() {
    var bar = D.getElementById('a2-bar');
    if (!bar || !('IntersectionObserver' in W)) return;
    if (barObs) barObs.disconnect();
    var probe = D.createElement('div');
    probe.style.cssText = 'position:absolute;top:0;height:1px;width:1px';
    bar.parentNode.insertBefore(probe, bar);
    barObs = new IntersectionObserver(function (en) {
      bar.classList.toggle('stuck', !en[0].isIntersecting);
    }, { threshold: 1 });
    barObs.observe(probe);
  }

  /* ═══════════════════════════════════════════════════════════════════
     EVENTS
     ═══════════════════════════════════════════════════════════════════ */
  function active() {
    var p = D.getElementById('page-analytics');
    return p && p.classList.contains('active');
  }

  function bind() {
    D.addEventListener('click', function (e) {
      if (!active()) return;
      var t = e.target;
      if (!t || !t.closest) return;

      var f = t.closest('[data-a2-filter]');
      if (f) { S.filter = f.dataset.a2Filter; S.limit = 12; render(); return; }

      var s = t.closest('[data-a2-sort]');
      if (s) {
        var k = s.dataset.a2Sort;
        if (S.sort === k) S.dir *= -1; else { S.sort = k; S.dir = 1; }
        render(); return;
      }

      if (t.closest('[data-a2-more]')) { S.limit += 24; render(); return; }

      var j = t.closest('[data-a2-jump]');
      if (j) {
        e.preventDefault();
        var id = { top: 'a2-top', focus: 'a2-focus', all: 'a2-all', trend: 'a2-trend', log: 'a2-log' }[j.dataset.a2Jump];
        var el = id && D.getElementById(id);
        if (el) {
          var bar = D.getElementById('a2-bar');
          var off = (bar ? bar.offsetHeight : 0) + 14;
          var y = el.getBoundingClientRect().top + W.pageYOffset - off;
          try { W.scrollTo({ top: y, behavior: 'smooth' }); } catch (_) { W.scrollTo(0, y); }
        }
        return;
      }

      /* "Practise" jumps to setup — the analytics page's whole purpose is
         to hand the student a next action, so make it one tap. */
      var p = t.closest('[data-a2-practice]');
      if (p) {
        e.preventDefault();
        var nav = D.querySelector('[data-view="practice"]');
        if (nav) nav.click(); else location.hash = '#practice';
        var app = APP();
        if (app && app.showToast) app.showToast('Build a session on ' + p.dataset.a2Practice + '.');
        return;
      }

      var g = t.closest('[data-a2-go]');
      if (g) {
        e.preventDefault();
        var n2 = D.querySelector('[data-view="' + g.dataset.a2Go + '"]');
        if (n2) n2.click(); else location.hash = '#' + g.dataset.a2Go;
      }
    }, false);

    D.addEventListener('change', function (e) {
      if (!active() || !e.target) return;
      var id = e.target.id;
      if (id === 'a2-range') {
        var app = APP();
        if (app && app.state.analyticsFilters) app.state.analyticsFilters.range = e.target.value;
        /* Keep the legacy control in sync so other code reading it agrees. */
        var legacy = D.getElementById('analytics-range');
        if (legacy && legacy.value !== e.target.value) legacy.value = e.target.value;
        S.limit = 12; render();
      }
      if (id === 'a2-book') { S.scope = e.target.value; S.dim = null; S.limit = 12; render(); }
      if (id === 'a2-dim')  { S.dim = e.target.value; S.filter = 'all'; S.limit = 12; render(); }
      if (id === 'analytics-range') {
        var mine = D.getElementById('a2-range');
        if (mine && mine.value !== e.target.value) mine.value = e.target.value;
        setTimeout(render, 20);
      }
    });
  }

  function boot() {
    W.__rsBooted = W.__rsBooted || {};
    if (W.__rsBooted.analytics2) return;
    W.__rsBooted.analytics2 = 1;

    bind();

    var pg = D.getElementById('page-analytics');
    if (pg) {
      var was = pg.classList.contains('active');
      new MutationObserver(function () {
        var now = pg.classList.contains('active');
        if (now && !was) { S.limit = 12; setTimeout(render, 40); }
        was = now;
      }).observe(pg, { attributes: true, attributeFilter: ['class'] });
      if (was) setTimeout(render, 60);
    }

    /* Take over from the legacy renderer so both never fight over the DOM.
       The old one is still reachable via its own listeners (it binds
       document-level handlers we cannot unbind), so `retire()` runs on every
       render to re-hide #anx if it rebuilds itself. */
    W.rsRenderAnalytics = render;
    W.rsRenderAnalytics2 = render;
    retire();
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
