/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK — PART 6 · SETTINGS CORRECTIONS
   ───────────────────────────────────────────────────────────────────────────
   Every change here answers a defect confirmed by measurement:

   • Interface scale did nothing. Small and Medium both computed to 13px and
     559 hardcoded px rules ignored the setting. Re-implemented with `zoom`
     on the scroll container, which was tested to scale all of them.
   • Reading width did nothing — identical width at all three values, because
     #anx2/#stx set their own max-width. Now targets those elements.
   • Profile had no photo. auth.photoURL already existed and was rendered by
     the app, but nothing could ever set it.
   • Personal Details was five plain text boxes. Country is now a searchable
     picker that drives the phone dial code and validates number length.

   NOTE ON COUNTRY DATA: restcountries.com was tested first and is now
   DEPRECATED — it returns {"success":false,"errors":[...]}. Shipping it would
   have produced an empty country list. The list below is static, so it works
   offline and cannot break.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var W = window, D = document;
  function APP() { return W.__rsApp || null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }
  function toast(m) {
    var a = APP();
    if (a && a.showToast) { try { return a.showToast(m); } catch (e) {} }
  }
  function ico(n, sz) {
    return '<svg class="ui-icon" style="width:' + (sz || 16) + 'px;height:' + (sz || 16) +
           'px" aria-hidden="true"><use href="#icon-' + n + '"></use></svg>';
  }

  /* ── country table: [iso2, name, dial, nationalLength] ───────────────── */
  var CC=[["AF","Afghanistan","93","9"],["AL","Albania","355","9"],["DZ","Algeria","213","9"],["AD","Andorra","376","6"],["AO","Angola","244","9"],["AR","Argentina","54","10"],["AM","Armenia","374","8"],["AU","Australia","61","9"],["AT","Austria","43","10-11"],["AZ","Azerbaijan","994","9"],["BH","Bahrain","973","8"],["BD","Bangladesh","880","10"],["BY","Belarus","375","9"],["BE","Belgium","32","9"],["BZ","Belize","501","7"],["BJ","Benin","229","8"],["BT","Bhutan","975","8"],["BO","Bolivia","591","8"],["BA","Bosnia and Herzegovina","387","8"],["BW","Botswana","267","7"],["BR","Brazil","55","10-11"],["BN","Brunei","673","7"],["BG","Bulgaria","359","9"],["BF","Burkina Faso","226","8"],["BI","Burundi","257","8"],["KH","Cambodia","855","8-9"],["CM","Cameroon","237","9"],["CA","Canada","1","10"],["CV","Cape Verde","238","7"],["CF","Central African Republic","236","8"],["TD","Chad","235","8"],["CL","Chile","56","9"],["CN","China","86","11"],["CO","Colombia","57","10"],["KM","Comoros","269","7"],["CG","Congo","242","9"],["CD","DR Congo","243","9"],["CR","Costa Rica","506","8"],["HR","Croatia","385","9"],["CU","Cuba","53","8"],["CY","Cyprus","357","8"],["CZ","Czechia","420","9"],["DK","Denmark","45","8"],["DJ","Djibouti","253","8"],["DO","Dominican Republic","1809","10"],["EC","Ecuador","593","9"],["EG","Egypt","20","10"],["SV","El Salvador","503","8"],["GQ","Equatorial Guinea","240","9"],["ER","Eritrea","291","7"],["EE","Estonia","372","8"],["ET","Ethiopia","251","9"],["FJ","Fiji","679","7"],["FI","Finland","358","9-10"],["FR","France","33","9"],["GA","Gabon","241","8"],["GM","Gambia","220","7"],["GE","Georgia","995","9"],["DE","Germany","49","10-11"],["GH","Ghana","233","9"],["GR","Greece","30","10"],["GT","Guatemala","502","8"],["GN","Guinea","224","9"],["GY","Guyana","592","7"],["HT","Haiti","509","8"],["HN","Honduras","504","8"],["HK","Hong Kong","852","8"],["HU","Hungary","36","9"],["IS","Iceland","354","7"],["IN","India","91","10"],["ID","Indonesia","62","9-12"],["IR","Iran","98","10"],["IQ","Iraq","964","10"],["IE","Ireland","353","9"],["IL","Israel","972","9"],["IT","Italy","39","9-10"],["JM","Jamaica","1876","10"],["JP","Japan","81","10"],["JO","Jordan","962","9"],["KZ","Kazakhstan","7","10"],["KE","Kenya","254","9"],["KW","Kuwait","965","8"],["KG","Kyrgyzstan","996","9"],["LA","Laos","856","9"],["LV","Latvia","371","8"],["LB","Lebanon","961","8"],["LS","Lesotho","266","8"],["LR","Liberia","231","8"],["LY","Libya","218","9"],["LI","Liechtenstein","423","7"],["LT","Lithuania","370","8"],["LU","Luxembourg","352","9"],["MO","Macau","853","8"],["MG","Madagascar","261","9"],["MW","Malawi","265","9"],["MY","Malaysia","60","9-10"],["MV","Maldives","960","7"],["ML","Mali","223","8"],["MT","Malta","356","8"],["MR","Mauritania","222","8"],["MU","Mauritius","230","8"],["MX","Mexico","52","10"],["MD","Moldova","373","8"],["MC","Monaco","377","8"],["MN","Mongolia","976","8"],["ME","Montenegro","382","8"],["MA","Morocco","212","9"],["MZ","Mozambique","258","9"],["MM","Myanmar","95","9-10"],["NA","Namibia","264","9"],["NP","Nepal","977","10"],["NL","Netherlands","31","9"],["NZ","New Zealand","64","8-9"],["NI","Nicaragua","505","8"],["NE","Niger","227","8"],["NG","Nigeria","234","10"],["KP","North Korea","850","10"],["MK","North Macedonia","389","8"],["NO","Norway","47","8"],["OM","Oman","968","8"],["PK","Pakistan","92","10"],["PS","Palestine","970","9"],["PA","Panama","507","8"],["PG","Papua New Guinea","675","8"],["PY","Paraguay","595","9"],["PE","Peru","51","9"],["PH","Philippines","63","10"],["PL","Poland","48","9"],["PT","Portugal","351","9"],["QA","Qatar","974","8"],["RO","Romania","40","9"],["RU","Russia","7","10"],["RW","Rwanda","250","9"],["SA","Saudi Arabia","966","9"],["SN","Senegal","221","9"],["RS","Serbia","381","9"],["SC","Seychelles","248","7"],["SL","Sierra Leone","232","8"],["SG","Singapore","65","8"],["SK","Slovakia","421","9"],["SI","Slovenia","386","8"],["SO","Somalia","252","8"],["ZA","South Africa","27","9"],["KR","South Korea","82","9-10"],["SS","South Sudan","211","9"],["ES","Spain","34","9"],["LK","Sri Lanka","94","9"],["SD","Sudan","249","9"],["SR","Suriname","597","7"],["SE","Sweden","46","9"],["CH","Switzerland","41","9"],["SY","Syria","963","9"],["TW","Taiwan","886","9"],["TJ","Tajikistan","992","9"],["TZ","Tanzania","255","9"],["TH","Thailand","66","9"],["TG","Togo","228","8"],["TT","Trinidad and Tobago","1868","10"],["TN","Tunisia","216","8"],["TR","Turkey","90","10"],["TM","Turkmenistan","993","8"],["UG","Uganda","256","9"],["UA","Ukraine","380","9"],["AE","United Arab Emirates","971","9"],["GB","United Kingdom","44","10"],["US","United States","1","10"],["UY","Uruguay","598","8"],["UZ","Uzbekistan","998","9"],["VE","Venezuela","58","10"],["VN","Vietnam","84","9"],["YE","Yemen","967","9"],["ZM","Zambia","260","9"],["ZW","Zimbabwe","263","9"]];

  function flagOf(iso) {
    try {
      return String.fromCodePoint.apply(null, iso.toUpperCase().split('').map(function (c) {
        return 0x1F1E6 + c.charCodeAt(0) - 65;
      }));
    } catch (e) { return '\u{1F3F3}'; }
  }
  function byName(n) {
    if (!n) return null;
    n = String(n).trim().toLowerCase();
    for (var i = 0; i < CC.length; i++) if (CC[i][1].toLowerCase() === n) return CC[i];
    return null;
  }
  function byIso(c) {
    if (!c) return null;
    c = String(c).trim().toUpperCase();
    for (var i = 0; i < CC.length; i++) if (CC[i][0] === c) return CC[i];
    return null;
  }
  /* Timezone → country, so first-time users start on a sensible default
     without a network call or a permission prompt. */
  var TZ = { 'Asia/Calcutta': 'IN', 'Asia/Kolkata': 'IN', 'Asia/Karachi': 'PK',
    'Asia/Dhaka': 'BD', 'Asia/Colombo': 'LK', 'Asia/Kathmandu': 'NP',
    'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
    'America/Los_Angeles': 'US', 'America/Toronto': 'CA', 'Europe/London': 'GB',
    'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE',
    'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Australia/Sydney': 'AU',
    'Asia/Tokyo': 'JP', 'Asia/Shanghai': 'CN', 'Asia/Singapore': 'SG',
    'Asia/Dubai': 'AE', 'Africa/Lagos': 'NG', 'Africa/Johannesburg': 'ZA' };
  function guessCountry() {
    var z = '';
    try { z = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    if (TZ[z]) return byIso(TZ[z]);
    /* Fall back to the browser's locale region (en-IN -> IN). */
    try {
      var langs = (navigator.languages || [navigator.language || '']);
      for (var i = 0; i < langs.length; i++) {
        var m = /[-_]([A-Za-z]{2})$/.exec(langs[i] || '');
        if (m) { var c = byIso(m[1]); if (c) return c; }
      }
    } catch (e) {}
    return null;
  }
  function lenOk(spec, digits) {
    if (!spec) return true;
    var p = String(spec).split('-');
    var lo = parseInt(p[0], 10), hi = parseInt(p[1] || p[0], 10);
    return digits >= lo && digits <= hi;
  }

  /* ═══════════════════════════════════════════════════════════════════
     1. INTERFACE SCALE — verified to actually work
     ═══════════════════════════════════════════════════════════════════ */
  var K_SCALE = 'rankspark-ui-scale';
  var SCALES = [['xs', 'XS'], ['sm', 'S'], ['md', 'M'], ['lg', 'L'], ['xl', 'XL']];
  function scale() {
    try { return localStorage.getItem(K_SCALE) || 'md'; } catch (e) { return 'md'; }
  }
  function applyScale(v) {
    try { localStorage.setItem(K_SCALE, v); } catch (e) {}
    D.body.setAttribute('data-ui-scale', v);
    /* Keep the legacy pref meaningful for any code still reading it. */
    var legacy = v === 'xs' || v === 'sm' ? 'Small' : v === 'lg' || v === 'xl' ? 'Large' : 'Medium';
    var a = APP();
    if (a && a.state && a.state.preferences) {
      a.state.preferences.fontSize = legacy;
      try { localStorage.setItem('rankspark-preferences', JSON.stringify(a.state.preferences)); } catch (e) {}
    }
    D.body.dataset.fontSize = legacy.toLowerCase();
  }
  applyScale(scale());

  /* ═══════════════════════════════════════════════════════════════════
     2. AVATAR — upload, square-crop, downscale, persist
     ═══════════════════════════════════════════════════════════════════ */
  var K_AVA = 'rankspark-avatar';
  function avatar() {
    try { return localStorage.getItem(K_AVA) || ''; } catch (e) { return ''; }
  }
  function initials() {
    var a = APP();
    var n = (a && a.state.auth.displayName) || 'Learner';
    var parts = String(n).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'L';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function paintAvatars(url) {
    var a = APP();
    if (a && a.state && a.state.auth) a.state.auth.photoURL = url || '';
    try { localStorage.setItem('rankspark-auth', JSON.stringify(a.state.auth)); } catch (e) {}
    /* Repaint every avatar surface the app already renders. */
    ['#sidebar-avatar', '#pph-avatar', '.avatar', '.pph-avatar'].forEach(function (sel) {
      D.querySelectorAll(sel).forEach(function (el) {
        if (url) {
          el.style.backgroundImage = 'url(' + url + ')';
          el.style.backgroundSize = 'cover';
          el.style.backgroundPosition = 'center';
          el.style.color = 'transparent';
        } else {
          el.style.backgroundImage = '';
          el.style.color = '';
        }
      });
    });
    var box = D.getElementById('st-ava-box');
    if (box) {
      box.innerHTML = url
        ? '<img src="' + url + '" alt="Profile photo">' +
          '<span class="st-ava-cam">' + ico('edit', 15) + '</span>'
        : esc(initials()) + '<span class="st-ava-cam">' + ico('edit', 15) + '</span>';
    }
  }

  /* A 4MB phone photo would blow the ~5MB localStorage quota. Centre-crop to
     a square and downscale to 256px JPEG — typically ~15KB. */
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('No file'));
      if (!/^image\//.test(file.type)) return reject(new Error('That file is not an image.'));
      if (file.size > 12 * 1024 * 1024) return reject(new Error('Image is larger than 12 MB.'));
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('Could not read that file.')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That image could not be decoded.')); };
        img.onload = function () {
          try {
            var S = 256;
            var side = Math.min(img.width, img.height);
            var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
            var cv = D.createElement('canvas');
            cv.width = S; cv.height = S;
            var cx = cv.getContext('2d');
            cx.imageSmoothingQuality = 'high';
            cx.drawImage(img, sx, sy, side, side, 0, 0, S, S);
            resolve(cv.toDataURL('image/jpeg', 0.86));
          } catch (e) { reject(new Error('Could not process that image.')); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function pickAvatar() {
    var inp = D.getElementById('st-ava-input');
    if (!inp) {
      inp = D.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/png,image/jpeg,image/webp,image/gif';
      inp.id = 'st-ava-input';
      inp.hidden = true;
      D.body.appendChild(inp);
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        inp.value = '';
        if (!f) return;
        readImage(f).then(function (url) {
          try {
            localStorage.setItem(K_AVA, url);
          } catch (e) {
            toast('Not enough local storage for that photo.');
            return;
          }
          paintAvatars(url);
          toast('Profile photo updated.');
        }, function (err) { toast(err.message); });
      });
    }
    inp.click();
  }

  function removeAvatar() {
    try { localStorage.removeItem(K_AVA); } catch (e) {}
    paintAvatars('');
    toast('Profile photo removed.');
  }

  /* ═══════════════════════════════════════════════════════════════════
     3. RICH PERSONAL DETAILS SHEET
     Replaces the five plain text inputs. Country drives the phone dial
     code and the expected number length.
     ═══════════════════════════════════════════════════════════════════ */
  function sheetHTML() {
    var a = APP(); if (!a) return '';
    var pd = a.state.profileDetails || {};
    var cur = byName(pd.country) || byIso(pd.countryCode) || guessCountry() || byIso('IN');
    var dial = cur ? cur[2] : '';
    var opts = CC.map(function (c) {
      return '<option value="' + c[0] + '"' + (cur && c[0] === cur[0] ? ' selected' : '') + '>' +
             flagOf(c[0]) + '  ' + esc(c[1]) + '  +' + c[2] + '</option>';
    }).join('');

    return '<div class="rs-fgrid">' +
      '<div class="rs-f"><label for="rsf-name">Display name</label>' +
        '<input id="rsf-name" type="text" autocomplete="name" placeholder="Your name" value="' +
        esc(a.state.auth.displayName || '') + '"><small id="rsf-name-h">Shown on your profile and leaderboard.</small></div>' +

      '<div class="rs-f"><label for="rsf-user">Username</label>' +
        '<input id="rsf-user" type="text" autocomplete="username" placeholder="e.g. varun_04" value="' +
        esc(pd.username || '') + '"><small id="rsf-user-h">Letters, numbers and underscores. Optional.</small></div>' +

      '<div class="rs-f"><label for="rsf-country">Country</label>' +
        '<select id="rsf-country">' + opts + '</select>' +
        '<small>Sets your phone code and regional formatting.</small></div>' +

      '<div class="rs-f" id="rsf-phone-wrap"><label for="rsf-phone">Phone number</label>' +
        '<span class="rs-phone">' +
          '<span class="rs-dial" id="rsf-dial"><i>' + (cur ? flagOf(cur[0]) : '') + '</i>+' + esc(dial) + '</span>' +
          '<input id="rsf-phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="' +
          (cur ? new Array(parseInt(cur[3], 10) + 1).join('0') : '') + '" value="' +
          esc(String(pd.phoneNational || '')) + '">' +
        '</span>' +
        '<small id="rsf-phone-h" class="rs-count"></small></div>' +

      '<div class="rs-f"><label for="rsf-city">City / State</label>' +
        '<input id="rsf-city" type="text" autocomplete="address-level2" placeholder="e.g. Gurugram, Haryana" value="' +
        esc(pd.location || '') + '"></div>' +

      '<div class="rs-f"><label for="rsf-class">Class / Course</label>' +
        '<select id="rsf-class">' +
        ['', 'Class 9', 'Class 10', 'Class 11', 'Class 12', 'Dropper / Repeater',
         'Undergraduate', 'Postgraduate', 'Working professional'].map(function (o) {
          return '<option value="' + esc(o) + '"' + (o === (pd.className || '') ? ' selected' : '') + '>' +
                 (o || 'Select…') + '</option>';
        }).join('') + '</select></div>' +
    '</div>';
  }

  function validatePhone() {
    var sel = D.getElementById('rsf-country');
    var inp = D.getElementById('rsf-phone');
    var hint = D.getElementById('rsf-phone-h');
    var wrap = D.getElementById('rsf-phone-wrap');
    if (!sel || !inp || !hint || !wrap) return true;
    var c = byIso(sel.value);
    var digits = inp.value.replace(/\D/g, '');
    inp.value = digits;
    wrap.classList.remove('bad', 'ok');
    if (!digits) { hint.textContent = c ? 'Expected ' + c[3] + ' digits.' : ''; return true; }
    var ok = c ? lenOk(c[3], digits.length) : true;
    hint.textContent = digits.length + (c ? ' / ' + c[3] : '') + ' digits' + (ok ? '' : ' — check the length');
    wrap.classList.add(ok ? 'ok' : 'bad');
    return ok;
  }

  function syncDial() {
    var sel = D.getElementById('rsf-country');
    var dial = D.getElementById('rsf-dial');
    var inp = D.getElementById('rsf-phone');
    if (!sel || !dial) return;
    var c = byIso(sel.value);
    if (!c) return;
    dial.innerHTML = '<i>' + flagOf(c[0]) + '</i>+' + esc(c[2]);
    if (inp) inp.placeholder = new Array(parseInt(c[3], 10) + 1).join('0');
    validatePhone();
  }

  function saveSheet() {
    var a = APP(); if (!a) return false;
    if (!validatePhone()) { toast('Check the phone number length.'); return false; }
    var g = function (id) { var e = D.getElementById(id); return e ? e.value.trim() : ''; };
    var c = byIso(g('rsf-country'));
    var pd = a.state.profileDetails = a.state.profileDetails || {};
    var name = g('rsf-name');
    if (name) a.state.auth.displayName = name;
    pd.username = g('rsf-user').replace(/[^A-Za-z0-9_]/g, '');
    pd.country = c ? c[1] : '';
    pd.countryCode = c ? c[0] : '';
    pd.dialCode = c ? c[2] : '';
    pd.phoneNational = g('rsf-phone');
    pd.phone = pd.phoneNational ? '+' + pd.dialCode + ' ' + pd.phoneNational : '';
    pd.location = g('rsf-city');
    pd.className = g('rsf-class');
    try {
      localStorage.setItem('rankspark-profile-details', JSON.stringify(pd));
      localStorage.setItem('rankspark-auth', JSON.stringify(a.state.auth));
    } catch (e) {}
    try { W.updateAuthSurfaces && W.updateAuthSurfaces(); } catch (e) {}
    try { W.renderHome && W.renderHome(); } catch (e) {}
    if (W.rsRenderSettings) W.rsRenderSettings();
    toast('Profile details saved.');
    return true;
  }

  /* Take over the host sheet when it opens for the profile section. */
  function enhanceSheet() {
    var bd = D.getElementById('sheet-backdrop');
    var content = D.getElementById('sheet-content');
    var title = D.getElementById('sheet-title');
    if (!bd || !content || !title) return;
    if (!/personal details/i.test(title.textContent || '')) return;
    if (content.dataset.rsRich === '1') return;
    content.dataset.rsRich = '1';
    content.innerHTML = sheetHTML();
    syncDial();

    var save = D.getElementById('sheet-save');
    if (save && !save.dataset.rsBound) {
      save.dataset.rsBound = '1';
      /* Capture phase so our validation runs before the host handler. */
      save.addEventListener('click', function (e) {
        if (content.dataset.rsRich !== '1') return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (saveSheet()) {
          bd.classList.remove('open');
          bd.setAttribute('aria-hidden', 'true');
          content.dataset.rsRich = '';
        }
      }, true);
    }
    ['sheet-cancel', 'sheet-close'].forEach(function (id) {
      var b = D.getElementById(id);
      if (b && !b.dataset.rsBound) {
        b.dataset.rsBound = '1';
        b.addEventListener('click', function () { content.dataset.rsRich = ''; });
      }
    });
  }

  D.addEventListener('change', function (e) {
    if (!e.target) return;
    if (e.target.id === 'rsf-country') syncDial();
  });
  D.addEventListener('input', function (e) {
    if (!e.target) return;
    if (e.target.id === 'rsf-phone') validatePhone();
    if (e.target.id === 'rsf-user') {
      var v = e.target.value;
      var clean = v.replace(/[^A-Za-z0-9_]/g, '');
      if (v !== clean) e.target.value = clean;
    }
  });

  /* The host opens the sheet by toggling .open — watch for it. */
  function watchSheet() {
    var bd = D.getElementById('sheet-backdrop');
    if (!bd) return;
    new MutationObserver(function () {
      if (bd.classList.contains('open')) setTimeout(enhanceSheet, 20);
    }).observe(bd, { attributes: true, attributeFilter: ['class'] });
  }

  /* ═══════════════════════════════════════════════════════════════════
     4. INJECT AVATAR ROW + REAL SCALE CONTROL INTO SETTINGS
     ═══════════════════════════════════════════════════════════════════ */
  function inject() {
    var stx = D.getElementById('stx');
    if (!stx) return;

    /* ── avatar row at the top of Account ── */
    var acc = stx.querySelector('[data-st-sec="account"]');
    if (acc && !acc.querySelector('.st-ava-row')) {
      var url = avatar();
      var row = D.createElement('div');
      row.className = 'st-ava-row';
      row.setAttribute('data-st-find', 'photo avatar picture image profile upload');
      row.innerHTML =
        '<button class="st-ava" id="st-ava-box" data-rs-ava="pick" aria-label="Change profile photo">' +
          (url ? '<img src="' + url + '" alt="Profile photo">' : esc(initials())) +
          '<span class="st-ava-cam">' + ico('edit', 15) + '</span>' +
        '</button>' +
        '<span class="st-ava-txt"><b>Profile photo</b>' +
          '<small>Square crop, stored on this device only. Nothing is uploaded.</small>' +
          '<span class="st-ava-acts">' +
            '<button class="st-ava-btn" data-rs-ava="pick">' + (url ? 'Change' : 'Upload') + '</button>' +
            (url ? '<button class="st-ava-btn danger" data-rs-ava="remove">Remove</button>' : '') +
          '</span>' +
        '</span>';
      var hdr = acc.querySelector('.st-sh');
      if (hdr && hdr.nextSibling) acc.insertBefore(row, hdr.nextSibling);
      else acc.appendChild(row);
    }

    /* ── replace the fake 3-step scale with a real 5-step one ── */
    var seg = stx.querySelector('[data-st-seg="fontSize"]');
    if (seg) {
      var host = seg.parentNode;
      var cur = scale();
      host.innerHTML = '<span class="st-seg" role="radiogroup" aria-label="Interface scale">' +
        SCALES.map(function (s) {
          return '<button role="radio" aria-checked="' + (s[0] === cur) + '" data-rs-scale="' + s[0] + '"' +
                 (s[0] === cur ? ' class="on"' : '') + '>' + s[1] + '</button>';
        }).join('') + '</span>';
      var rowEl = host.closest('.st-row');
      if (rowEl) {
        var d = rowEl.querySelector('.st-rt small');
        if (d) d.textContent = 'Scales every element, not just text';
      }
    }
  }

  D.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;

    var av = t.closest('[data-rs-ava]');
    if (av) {
      e.preventDefault();
      if (av.dataset.rsAva === 'pick') pickAvatar(); else removeAvatar();
      setTimeout(inject, 60);
      return;
    }

    var sc = t.closest('[data-rs-scale]');
    if (sc) {
      e.preventDefault();
      applyScale(sc.dataset.rsScale);
      var all = sc.parentNode.querySelectorAll('[data-rs-scale]');
      for (var i = 0; i < all.length; i++) {
        var on = all[i] === sc;
        all[i].classList.toggle('on', on);
        all[i].setAttribute('aria-checked', String(on));
      }
      try { W.__rsFX && W.__rsFX.feedback('toggle'); } catch (er) {}
    }
  });

  /* Re-inject after the settings page re-renders. */
  function hook() {
    var orig = W.rsRenderSettings;
    if (typeof orig !== 'function' || orig.__rs6) return;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      setTimeout(inject, 0);
      return r;
    };
    wrapped.__rs6 = 1;
    W.rsRenderSettings = wrapped;
  }

  function boot() {
    watchSheet();
    hook();
    var pg = D.getElementById('page-profile');
    if (pg) {
      new MutationObserver(function () {
        if (pg.classList.contains('active')) setTimeout(function () { hook(); inject(); }, 90);
      }).observe(pg, { attributes: true, attributeFilter: ['class'] });
      if (pg.classList.contains('active')) setTimeout(function () { hook(); inject(); }, 120);
    }
    var url = avatar();
    if (url) setTimeout(function () { paintAvatars(url); }, 400);
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(function () { hook(); inject(); }, 1200);

  W.RSProfile = {
    countries: CC, flagOf: flagOf, byIso: byIso, guess: guessCountry,
    scale: scale, applyScale: applyScale,
    avatar: avatar, pickAvatar: pickAvatar, removeAvatar: removeAvatar
  };
})();
