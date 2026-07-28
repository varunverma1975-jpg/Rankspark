/* Seed realistic analytics history for visual + functional testing.
   Mirrors the exact shape produced by saveAnalyticsEntry(). */
(function () {
  var BOOKS = [
    { id: 'hcv-1', name: 'HC Verma Vol 1', subj: 'Physics',
      chapters: ['Rotational Mechanics', 'Work & Energy', 'Kinematics', 'Gravitation', 'Fluid Mechanics'],
      topics: ['Torque & Angular Momentum', 'Moment of Inertia', 'Work-Energy Theorem', 'Projectile Motion',
               'Kepler Laws', 'Bernoulli Principle', 'Rolling Motion', 'Collisions'] },
    { id: 'ncert-chem', name: 'NCERT Chemistry XII', subj: 'Chemistry',
      chapters: ['Electrochemistry', 'Chemical Kinetics', 'Coordination Compounds', 'Aldehydes & Ketones'],
      topics: ['Nernst Equation', 'Rate Laws', 'Crystal Field Theory', 'Nucleophilic Addition',
               'Conductance', 'Order of Reaction'] }
  ];
  var EXAMS = ['JEE Main', 'JEE Advanced', 'NEET UG'];
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function ri(a, b) { return Math.floor(rnd(a, b + 1)); }
  function pick(a) { return a[ri(0, a.length - 1)]; }

  var hist = [];
  var N = 24;
  for (var i = 0; i < N; i++) {
    var book = i % 3 === 0 ? BOOKS[1] : BOOKS[0];
    // improving trend over time + noise
    var base = 42 + (i / N) * 30 + rnd(-9, 9);
    var acc = Math.max(15, Math.min(96, base));
    var total = ri(10, 30);
    var attempted = ri(Math.max(5, total - 6), total);
    var correct = Math.round(attempted * acc / 100);
    var incorrect = attempted - correct;
    var unatt = total - attempted;
    var time = attempted * ri(38, 115);
    var daysAgo = Math.round((N - i) * 1.25);

    function rows(names, field, n) {
      var used = [], out = [], left = attempted, lc = correct;
      n = Math.min(n, names.length);
      for (var k = 0; k < n; k++) {
        var nm; do { nm = pick(names); } while (used.indexOf(nm) >= 0);
        used.push(nm);
        var a = k === n - 1 ? left : ri(1, Math.max(1, Math.floor(left / (n - k))));
        a = Math.max(0, Math.min(a, left));
        var c = k === n - 1 ? Math.max(0, Math.min(a, lc)) : Math.min(a, Math.round(a * acc / 100 + rnd(-1, 1)));
        c = Math.max(0, Math.min(c, a));
        left -= a; lc -= c;
        var o = { total: a, attempted: a, correct: c, incorrect: a - c, time: a * ri(35, 120) };
        o[field] = nm;
        out.push(o);
      }
      return out.filter(function (r) { return r.attempted > 0; });
    }

    hist.push({
      id: 'seed-' + i,
      createdAt: new Date(Date.now() - daysAgo * 86400000 - ri(0, 20) * 3600000).toISOString(),
      mode: i % 4 === 0 ? 'mock' : 'custom',
      questionCount: total,
      pack_id: book.id,
      pack_ids: [book.id],
      book_name: book.name,
      score: correct * 4 - incorrect,
      maxScore: total * 4,
      accuracy: acc,
      correct: correct, incorrect: incorrect, unattempted: unatt,
      attempted: attempted, timeTaken: time,
      topics: rows(book.topics, 'topic', ri(3, 5)),
      chapters: rows(book.chapters, 'chapter', ri(2, 4)),
      breakdown: [{ subject: book.subj, total: total, attempted: attempted, correct: correct,
                    incorrect: incorrect, time: time }],
      exams: [{ exam: pick(EXAMS), attempted: attempted, correct: correct }]
    });
  }
  hist.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  localStorage.setItem('rankspark-analytics-history', JSON.stringify(hist));
  localStorage.setItem('rankspark-progress', JSON.stringify({
    totalXp: 4820, rankedXp: 2100, level: 20, streak: 6, bestStreak: 11,
    totalQuestionsSolved: hist.reduce(function (s, e) { return s + e.attempted; }, 0),
    totalTests: hist.length,
    totalStudyTime: hist.reduce(function (s, e) { return s + e.timeTaken; }, 0)
  }));
  localStorage.setItem('rankspark-onboarded', 'true');
  return hist.length;
})();
