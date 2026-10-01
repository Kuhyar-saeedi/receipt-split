(function () {
  'use strict';
  var P = window.ReceiptParser;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- State (saved on the phone so a reload doesn't lose work) ----------
  var KEY = 'receipt-split-v1';
  var state = { people: [], payer: null, items: [], total: null, raw: '', nextId: 1 };
  try { var saved = JSON.parse(localStorage.getItem(KEY)); if (saved) state = Object.assign(state, saved); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  function newItem(name, price, extra) {
    return Object.assign({ id: state.nextId++, name: name || '', price: price === undefined ? null : price, people: [], discount: false, flags: [] }, extra || {});
  }

  // ---------- Helpers ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function eur(c) { return '€' + P.fmt(c); }
  function parsePriceInput(v) {
    v = String(v).trim().replace(/€/g, '');
    if (!v) return null;
    if (/^-?\d+$/.test(v)) return parseInt(v, 10) * 100;
    if (/^-?\d+[.,]\d$/.test(v)) v += '0';
    return P.toCents(v);
  }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // Effective people for an item (discount lines follow the item above them).
  function effectivePeople(idx) {
    var it = state.items[idx];
    if (!it.discount) return it.people;
    for (var i = idx - 1; i >= 0; i--) if (!state.items[i].discount) return state.items[i].people;
    return it.people;
  }

  // ---------- People ----------
  function renderPeople() {
    var box = $('peopleList');
    if (!state.people.length) { box.innerHTML = '<span class="empty">No one yet — add everyone, including the buyer.</span>'; return; }
    box.innerHTML = state.people.map(function (p) {
      var payer = p === state.payer;
      return '<span class="person' + (payer ? ' payer' : '') + '" data-p="' + esc(p) + '">' +
        esc(p) + (payer ? ' <span class="tag">paid</span>' : '') +
        '<button class="x" type="button" data-remove="' + esc(p) + '" aria-label="Remove ' + esc(p) + '">×</button></span>';
    }).join('');
  }
  $('peopleList').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-remove]');
    if (rm) {
      var p = rm.getAttribute('data-remove');
      state.people = state.people.filter(function (x) { return x !== p; });
      if (state.payer === p) state.payer = state.people[0] || null;
      state.items.forEach(function (it) { it.people = it.people.filter(function (x) { return x !== p; }); });
      save(); renderAll(); return;
    }
    var chip = e.target.closest('[data-p]');
    if (chip) { state.payer = chip.getAttribute('data-p'); save(); renderAll(); }
  });
  $('addPersonForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('personInput').value.trim().toUpperCase().replace(/[^A-Z0-9À-Ý]/g, '');
    if (!v) return;
    if (v === 'ALL') { toast('"ALL" is reserved for shared items'); return; }
    if (state.people.indexOf(v) !== -1) { toast(v + ' is already in'); return; }
    state.people.push(v);
    if (!state.payer) state.payer = v;
    $('personInput').value = '';
    save(); renderAll();
  });

  // ---------- Items ----------
  function chipsHtml(it) {
    var all = it.people.indexOf('ALL') !== -1;
    var html = '<button type="button" class="chip all' + (all ? ' on' : '') + '" data-chip="ALL">ALL</button>';
    state.people.forEach(function (p) {
      var on = !all && it.people.indexOf(p) !== -1;
      html += '<button type="button" class="chip' + (on ? ' on' : '') + '" data-chip="' + esc(p) + '">' + esc(p) + '</button>';
    });
    return html;
  }

  function renderItems() {
    var list = $('itemList');
    $('itemsCard').hidden = !state.items.length;
    list.innerHTML = state.items.map(function (it, idx) {
      var unassigned = !effectivePeople(idx).length && it.price;
      var flags = it.flags;
      var flagText = flags.map(function (f) {
        return f === 'auto-fixed' ? 'price auto-corrected — check it'
          : f === 'price from qty' ? 'price from quantity line — check it'
          : f === 'missing price' ? 'price not found — type it in'
          : f === 'looks too high' ? 'price looks wrong — check it' : f;
      });
      return '<li class="item' + (unassigned ? ' unassigned' : '') + '" data-id="' + it.id + '">' +
        '<div class="item-top">' +
          '<input type="text" class="iname" value="' + esc(it.name) + '" placeholder="Item" aria-label="Item name">' +
          '<input inputmode="decimal" class="iprice" value="' + (it.price === null ? '' : P.fmt(it.price)) + '" placeholder="0,00" aria-label="Price">' +
          '<button type="button" class="del" aria-label="Delete line">×</button>' +
        '</div>' +
        (flagText.length ? '<span class="flag">' + esc(flagText.join(' · ')) + '</span>' : '') +
        (it.discount
          ? '<div class="follows">Discount — goes to the same people as the line above.</div>'
          : '<div class="chips">' + chipsHtml(it) + '</div>') +
      '</li>';
    }).join('');
    $('rawText').textContent = state.raw || '(no scan yet)';
    renderCheck();
  }

  function itemFromEvent(e) {
    var li = e.target.closest('.item'); if (!li) return null;
    var id = Number(li.getAttribute('data-id'));
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return { it: state.items[i], idx: i, li: li };
    return null;
  }

  $('itemList').addEventListener('click', function (e) {
    var ref = itemFromEvent(e); if (!ref) return;
    if (e.target.closest('.del')) {
      state.items.splice(ref.idx, 1); save(); renderItems(); renderResult(); return;
    }
    var chip = e.target.closest('[data-chip]'); if (!chip) return;
    var p = chip.getAttribute('data-chip'), it = ref.it;
    if (p === 'ALL') it.people = it.people.indexOf('ALL') !== -1 ? [] : ['ALL'];
    else {
      it.people = it.people.filter(function (x) { return x !== 'ALL'; });
      var i = it.people.indexOf(p);
      if (i === -1) it.people.push(p); else it.people.splice(i, 1);
    }
    save();
    // Re-render just this row's chips (keeps scroll position steady), plus anything that follows it.
    ref.li.querySelector('.chips').innerHTML = chipsHtml(it);
    refreshUnassigned();
    renderResult();
  });

  function refreshUnassigned() {
    var lis = $('itemList').children;
    state.items.forEach(function (it, idx) { if (lis[idx]) lis[idx].classList.toggle('unassigned', !effectivePeople(idx).length && !!it.price); });
  }

  $('itemList').addEventListener('input', function (e) {
    var ref = itemFromEvent(e); if (!ref) return;
    if (e.target.classList.contains('iname')) ref.it.name = e.target.value;
    if (e.target.classList.contains('iprice')) {
      ref.it.price = parsePriceInput(e.target.value);
      ref.it.flags = [];
      ref.it.discount = ref.it.price !== null && ref.it.price < 0;
    }
    save(); renderCheck(); renderResult();
  });
  $('itemList').addEventListener('change', function (e) {
    if (e.target.classList.contains('iprice')) renderItems(); // tidy the number format, update flags
  });

  $('addItemBtn').addEventListener('click', function () {
    state.items.push(newItem('', null)); save(); renderItems(); renderResult();
    var inputs = document.querySelectorAll('.iname'); inputs[inputs.length - 1].focus();
  });
  $('manualBtn').addEventListener('click', function () {
    if (!state.items.length) state.items.push(newItem('', null));
    save(); renderItems(); renderResult();
    $('itemsCard').scrollIntoView({ behavior: 'smooth' });
  });

  // ---------- Sum vs receipt total ----------
  function renderCheck() {
    var bar = $('checkBar');
    var sum = state.items.reduce(function (s, it) { return s + (it.price || 0); }, 0);
    var total = state.total;
    var cls = total === null ? '' : (sum === total ? 'ok' : 'bad');
    bar.className = 'check ' + cls;
    var msg = total === null ? 'Lines add up to <b>' + eur(sum) + '</b>'
      : sum === total ? '✓ Lines match the receipt total'
      : '⚠ Lines add up to <b>' + eur(sum) + '</b> — off by <b>' + eur(sum - total) + '</b>';
    bar.innerHTML = '<span>' + msg + '</span>' +
      '<label>Total <input inputmode="decimal" id="totalInput" value="' + (total === null ? '' : P.fmt(total)) + '" placeholder="0,00" aria-label="Receipt total"></label>';
  }
  $('checkBar').addEventListener('change', function (e) {
    if (e.target.id === 'totalInput') { state.total = parsePriceInput(e.target.value); save(); renderCheck(); }
  });

  // ---------- Result ----------
  function renderResult() {
    var card = $('resultCard');
    if (!state.items.length || state.people.length < 2 || !state.payer) { card.hidden = true; return; }
    card.hidden = false;
    var items = state.items.map(function (it, idx) { return { name: it.name || 'Item ' + (idx + 1), price: it.price, people: effectivePeople(idx) }; });
    var r = P.split(items, state.people, state.payer);
    var html = '';
    if (r.unassigned.length) html += '<p class="warnline">⚠ ' + r.unassigned.length + ' line' + (r.unassigned.length > 1 ? 's have' : ' has') + ' no initials yet — not counted.</p>';
    if (!r.owes.length) html += '<p class="empty">Nobody owes ' + esc(state.payer) + ' anything yet.</p>';
    r.owes.forEach(function (o) {
      html += '<div class="owe"><span class="who"><b>' + esc(o.from) + '</b><span class="arrow">→</span><b>' + esc(o.to) + '</b></span><span class="amt">' + eur(o.amount) + '</span></div>' +
        '<details class="owe-detail"><summary>See ' + esc(o.from) + '\'s items</summary><ul>' +
        r.detail[o.from].map(function (d) { return '<li><span>' + esc(d.name) + (d.of > 1 ? ' (÷' + d.of + ')' : '') + '</span><span>' + eur(d.amount) + '</span></li>'; }).join('') +
        '</ul></details>';
    });
    var assigned = state.people.reduce(function (s, p) { return s + r.share[p]; }, 0);
    html += '<p class="foot">' + esc(state.payer) + '\'s own share: ' + eur(r.share[state.payer]) + ' · Split total: ' + eur(assigned) + '</p>';
    $('resultBody').innerHTML = html;
    renderResult.last = r;
  }

  function resultText() {
    var r = renderResult.last; if (!r) return '';
    var lines = ['🧾 Groceries — paid by ' + state.payer + (state.total !== null ? ' (' + eur(state.total) + ')' : '')];
    r.owes.forEach(function (o) { lines.push(o.from + ' → ' + o.to + ': ' + eur(o.amount)); });
    if (r.unassigned.length) lines.push('(' + r.unassigned.length + ' line(s) not assigned)');
    return lines.join('\n');
  }
  $('shareBtn').addEventListener('click', function () {
    var text = resultText(); if (!text) return;
    if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('Copied — paste it in WhatsApp'); }, function () { toast('Could not copy'); });
  });

  // ---------- Scanning (Tesseract.js, runs entirely on the phone) ----------
  var worker = null;
  function setProgress(p, text) {
    $('progress').hidden = false;
    $('progressBar').style.width = Math.round(p * 100) + '%';
    $('progressText').textContent = text;
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = reject;
      img.src = url;
    });
  }

  // Shrink, convert to grey and stretch contrast: faster and more accurate OCR.
  function prepare(img) {
    var max = 2000, w = img.naturalWidth, h = img.naturalHeight;
    var s = Math.min(1, max / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    var d = ctx.getImageData(0, 0, c.width, c.height), px = d.data, hist = new Array(256).fill(0), n = px.length / 4;
    for (var i = 0; i < px.length; i += 4) {
      var g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
      px[i] = g; hist[g]++;
    }
    var lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += hist[lo]) < n * 0.02) lo++;
    acc = 0; while (hi > 0 && (acc += hist[hi]) < n * 0.02) hi--;
    var range = Math.max(1, hi - lo);
    for (var j = 0; j < px.length; j += 4) {
      var v = Math.max(0, Math.min(255, ((px[j] - lo) * 255 / range) | 0));
      px[j] = px[j + 1] = px[j + 2] = v;
    }
    ctx.putImageData(d, 0, 0);
    return c;
  }

  async function getWorker() {
    if (worker) return worker;
    if (!window.Tesseract) throw new Error('Scanner not loaded — check your internet connection.');
    setProgress(0.02, 'Loading scanner (first time takes a bit)…');
    worker = await Tesseract.createWorker('ita', 1, {
      logger: function (m) {
        if (m.status === 'recognizing text') setProgress(0.15 + m.progress * 0.85, 'Reading receipt… ' + Math.round(m.progress * 100) + '%');
        else if (m.progress !== undefined) setProgress(Math.min(0.15, m.progress * 0.15), 'Loading scanner…');
      }
    });
    await worker.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
    return worker;
  }

  $('fileInput').addEventListener('change', async function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      var loaded = await loadImage(file);
      $('preview').hidden = false; $('previewImg').src = loaded.url;
      var canvas = prepare(loaded.img);
      var w = await getWorker();
      setProgress(0.15, 'Reading receipt…');
      var res = await w.recognize(canvas);
      handleText(res.data.text);
      setProgress(1, 'Done');
      setTimeout(function () { $('progress').hidden = true; }, 800);
    } catch (err) {
      console.error(err);
      $('progress').hidden = true;
      toast(err && err.message ? err.message : 'Could not read that photo');
    }
  });

  function handleText(text) {
    var parsed = P.parseReceipt(text);
    state.raw = text;
    state.total = parsed.total;
    var guessed = 0;
    state.items = parsed.items.map(function (p) {
      var ex = P.extractInitials(p.name, state.people);
      if (ex.people.length && !p.discount) guessed++;
      return newItem(ex.name, p.price, { discount: p.discount, flags: p.flags, people: p.discount ? [] : ex.people });
    });
    save(); renderAll();
    if (!state.items.length) { toast('No items found — try a flatter, brighter photo, or add lines by hand'); return; }
    toast('Found ' + state.items.length + ' items' + (guessed ? ' · read initials on ' + guessed : ''));
    $('itemsCard').scrollIntoView({ behavior: 'smooth' });
  }
  window.__handleText = handleText; // handy for testing

  // ---------- Reset ----------
  $('resetBtn').addEventListener('click', function () {
    if (!state.items.length) return;
    state.items = []; state.total = null; state.raw = '';
    $('preview').hidden = true;
    save(); renderAll(); toast('Cleared — people kept');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function renderAll() { renderPeople(); renderItems(); renderResult(); }
  renderAll();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
