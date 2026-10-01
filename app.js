(function () {
  'use strict';
  var S = window.Split;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- State (saved on the phone so closing the app doesn't lose work) ----------
  var KEY = 'receipt-split-v2';
  var state = { people: [], payer: null, items: [], total: null, nextId: 1 };
  try { var saved = JSON.parse(localStorage.getItem(KEY)); if (saved) state = Object.assign(state, saved); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  function newItem() { return { id: state.nextId++, name: '', price: null, people: [] }; }
  if (!state.items.length) state.items.push(newItem());

  // ---------- Helpers ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function eur(c) { return '€' + S.fmt(c); }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function itemsSum() { return state.items.reduce(function (s, it) { return s + (it.price || 0); }, 0); }

  // ---------- People ----------
  function renderPeople() {
    var box = $('peopleList');
    if (!state.people.length) { box.innerHTML = '<span class="empty">No one yet.</span>'; return; }
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
    var v = $('personInput').value.trim().replace(/\s+/g, ' ');
    if (!v) return;
    v = v.charAt(0).toUpperCase() + v.slice(1);
    if (v.toUpperCase() === 'ALL') { toast('"ALL" is reserved for shared items'); return; }
    var exists = state.people.some(function (x) { return x.toLowerCase() === v.toLowerCase(); });
    if (exists) { toast(v + ' is already in'); return; }
    state.people.push(v);
    if (!state.payer) state.payer = v;
    $('personInput').value = '';
    save(); renderAll();
    $('personInput').focus();
  });

  // ---------- Items ----------
  function chipsHtml(it) {
    if (!state.people.length) return '<span class="empty small">Add people first.</span>';
    var all = it.people.indexOf('ALL') !== -1;
    var html = '<button type="button" class="chip all' + (all ? ' on' : '') + '" data-chip="ALL">ALL</button>';
    state.people.forEach(function (p) {
      var on = !all && it.people.indexOf(p) !== -1;
      html += '<button type="button" class="chip' + (on ? ' on' : '') + '" data-chip="' + esc(p) + '">' + esc(p) + '</button>';
    });
    return html;
  }

  function rowHtml(it, idx) {
    var unassigned = it.price && !it.people.length;
    return '<li class="item' + (unassigned ? ' unassigned' : '') + '" data-id="' + it.id + '">' +
      '<div class="item-top">' +
        '<span class="num">' + (idx + 1) + '</span>' +
        '<input type="text" class="iname" value="' + esc(it.name) + '" placeholder="Item (optional)" aria-label="Item name" enterkeyhint="next">' +
        '<input type="text" inputmode="decimal" class="iprice" value="' + (it.price === null ? '' : S.fmt(it.price)) + '" placeholder="0,00" aria-label="Price" enterkeyhint="done">' +
        '<button type="button" class="del" aria-label="Delete item">×</button>' +
      '</div>' +
      '<div class="chips">' + chipsHtml(it) + '</div>' +
    '</li>';
  }

  function renderItems() {
    $('itemList').innerHTML = state.items.map(rowHtml).join('');
    renderCheck();
  }

  function refreshRowState() {
    var lis = $('itemList').children;
    state.items.forEach(function (it, idx) { if (lis[idx]) lis[idx].classList.toggle('unassigned', !!it.price && !it.people.length); });
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
      state.items.splice(ref.idx, 1);
      if (!state.items.length) state.items.push(newItem());
      save(); renderItems(); renderResult(); return;
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
    ref.li.querySelector('.chips').innerHTML = chipsHtml(it);
    refreshRowState(); renderResult();
  });

  $('itemList').addEventListener('input', function (e) {
    var ref = itemFromEvent(e); if (!ref) return;
    if (e.target.classList.contains('iname')) ref.it.name = e.target.value;
    if (e.target.classList.contains('iprice')) {
      var v = S.toCents(e.target.value);
      ref.it.price = v;
      e.target.classList.toggle('invalid', e.target.value.trim() !== '' && v === null);
    }
    save(); refreshRowState(); renderCheck(); renderResult();
  });
  // Tidy the number when leaving the price box ("2" → "2,00").
  $('itemList').addEventListener('focusout', function (e) {
    if (!e.target.classList.contains('iprice')) return;
    var ref = itemFromEvent(e); if (!ref || ref.it.price === null) return;
    e.target.value = S.fmt(ref.it.price);
  });
  // Enter: from name → price; from price → next item (or a new one).
  $('itemList').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var ref = itemFromEvent(e); if (!ref) return;
    if (e.target.classList.contains('iname')) { ref.li.querySelector('.iprice').focus(); return; }
    if (ref.idx === state.items.length - 1) addItem();
    else $('itemList').children[ref.idx + 1].querySelector('.iprice').focus();
  });

  function addItem() {
    state.items.push(newItem()); save();
    var tmp = document.createElement('ol');
    tmp.innerHTML = rowHtml(state.items[state.items.length - 1], state.items.length - 1);
    var li = tmp.firstChild;
    $('itemList').appendChild(li);
    li.querySelector('.iprice').focus();
    li.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  $('addItemBtn').addEventListener('click', addItem);

  // ---------- Sum vs receipt total ----------
  function renderCheck() {
    var bar = $('checkBar');
    var sum = itemsSum(), total = state.total;
    var cls = total === null ? '' : (sum === total ? 'ok' : 'bad');
    var msg = total === null ? 'Items total <b>' + eur(sum) + '</b>'
      : sum === total ? '✓ Matches the receipt'
      : '⚠ Items <b>' + eur(sum) + '</b>, ' + (sum < total ? 'missing ' : 'over by ') + '<b>' + eur(Math.abs(total - sum)) + '</b>';
    var input = bar.querySelector('#totalInput');
    if (!input) {
      bar.innerHTML = '<span class="msg"></span><label>Receipt total <input type="text" inputmode="decimal" id="totalInput" placeholder="optional" aria-label="Receipt total"></label>';
      input = bar.querySelector('#totalInput');
      input.value = total === null ? '' : S.fmt(total);
    }
    bar.className = 'check ' + cls;
    bar.querySelector('.msg').innerHTML = msg;
  }
  $('checkBar').addEventListener('input', function (e) {
    if (e.target.id === 'totalInput') { state.total = S.toCents(e.target.value); save(); renderCheck(); }
  });

  // ---------- Result ----------
  function renderResult() {
    var card = $('resultCard');
    var priced = state.items.filter(function (it) { return it.price; });
    if (!priced.length || state.people.length < 2 || !state.payer) { card.hidden = true; renderResult.last = null; return; }
    card.hidden = false;
    var items = state.items.map(function (it, idx) { return { name: it.name.trim() || 'Item ' + (idx + 1), price: it.price, people: it.people }; });
    var r = S.split(items, state.people, state.payer);
    var html = '';
    if (r.unassigned.length) html += '<p class="warnline">⚠ Item' + (r.unassigned.length > 1 ? 's ' : ' ') + r.unassigned.map(function (i) { return i + 1; }).join(', ') + ' not assigned to anyone yet.</p>';
    if (!r.owes.length) html += '<p class="empty">Nobody owes ' + esc(state.payer) + ' anything yet.</p>';
    r.owes.forEach(function (o) {
      html += '<div class="owe"><span class="who"><b>' + esc(o.from) + '</b><span class="arrow">→</span>' + esc(o.to) + '</span><span class="amt">' + eur(o.amount) + '</span></div>' +
        '<details class="owe-detail"><summary>' + esc(o.from) + '\'s items</summary><ul>' +
        r.detail[o.from].map(function (d) { return '<li><span>' + esc(d.name) + (d.of > 1 ? ' <i>÷' + d.of + '</i>' : '') + '</span><span>' + eur(d.amount) + '</span></li>'; }).join('') +
        '</ul></details>';
    });
    var owedTotal = r.owes.reduce(function (s, o) { return s + o.amount; }, 0);
    html += '<p class="foot">' + esc(state.payer) + ' gets back ' + eur(owedTotal) + ' · own share ' + eur(r.share[state.payer]) + '</p>';
    $('resultBody').innerHTML = html;
    renderResult.last = r;
  }

  function resultText() {
    var r = renderResult.last; if (!r) return '';
    var lines = ['🧾 Groceries — paid by ' + state.payer + ' (' + eur(itemsSum()) + ')'];
    r.owes.forEach(function (o) { lines.push(o.from + ' → ' + o.to + ': ' + eur(o.amount)); });
    if (r.unassigned.length) lines.push('(' + r.unassigned.length + ' item(s) not assigned)');
    return lines.join('\n');
  }
  $('shareBtn').addEventListener('click', function () {
    var text = resultText(); if (!text) return;
    if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('Copied — paste it in WhatsApp'); }, function () { toast('Could not copy'); });
  });

  // ---------- Reset ----------
  $('resetBtn').addEventListener('click', function () {
    state.items = [newItem()]; state.total = null;
    $('checkBar').innerHTML = '';
    save(); renderAll(); toast('Cleared — people kept');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function renderAll() { renderPeople(); renderItems(); renderResult(); }
  renderAll();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
