/*
 * Receipt text parser — turns raw OCR text into items + total.
 * Pure functions, no DOM: works in the browser (window.ReceiptParser) and in Node (tests).
 */
(function (root) {
  'use strict';

  // Digits OCR often confuses on thermal receipts (Lidl's slashed zero reads as 8, a circled 0 as 9...).
  var CONFUSIONS = { '8': ['0'], '9': ['0'], '6': ['0'], '0': ['8'] };

  var STOP_RE = /\b(SUB\s*TOTALE|TOTALE|TOTAL|IMPORTO\s+PAGATO|PAGAMENTO|DI\s+CUI\s+IVA|CONTANTE|RESTO)\b/i;
  var HEADER_END_RE = /DESCRIZIONE|PREZZO/i;
  var QTY_RE_LIDL = /CAD\.?\s*(\d{1,3}\s*[,.;]\s*\d{2})\s*(?:€|EUR)?\s*P[ZE]\.?\s*(\d{1,3})/i; // "Cad 0,85 Pz. 2"
  var QTY_RE_X = /^\s*(\d{1,3})\s*[xX×*]\s*(\d{1,3}\s*[,.]\s*\d{2})\s*$/;                      // "2 x 0,85"
  var WEIGHT_RE = /\bKG\b|€\s*\/|\/\s*KG/i;
  var DISCOUNT_RE = /SCONTO|PROMO|RIDUZ|DISCOUNT|BUONO|COUPON|-\s*\d+\s*%/i;

  // Clean the characters OCR puts around numbers: "@" or "O" for 0, "(" from a circled price, ";" for ",".
  function cleanNumberish(s) {
    return s
      .replace(/@/g, '0')
      .replace(/(^|[^A-Za-z])[Oo](?=[\d,.;]*\d)/g, '$10')
      .replace(/(\d)\s*[;:]\s*(\d{2})\b/g, '$1,$2')
      .replace(/(\d)\s*[,.]\s+(\d{2})\b/g, '$1,$2');
  }

  function toCents(str) {
    var m = String(str).replace(/\s/g, '').replace(';', ',').match(/(-?)(\d+)[,.](\d{2})/);
    if (!m) return null;
    var v = parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
    return m[1] ? -v : v;
  }

  // Price at the end of a line: "... 22%  1,39" / "... 1,39 B" / "... -0,50"
  var PRICE_END_RE = /(-?)(\d{1,4}\s*[,.]\s*\d{2})\s*(?:€|EUR|[A-Z*])?\s*$/;
  var VAT_RE = /\s(\d{1,2})\s?[%X×]/;

  function parseLine(raw) {
    var line = cleanNumberish(raw.trim());
    var pm = line.match(PRICE_END_RE);
    var vm = line.match(VAT_RE);
    var name = line;
    if (vm) name = line.slice(0, vm.index);
    else if (pm) name = line.slice(0, pm.index);
    name = name.replace(/[^A-Za-z0-9À-ÿ'.,&%/+\- ]/g, ' ').replace(/\s+/g, ' ').trim();
    var price = pm ? toCents(pm[2]) : null;
    if (price !== null && pm[1]) price = -price;
    return { name: name, price: price, hasVat: !!vm, vat: vm ? parseInt(vm[1], 10) : null };
  }

  function qtyInfo(raw) {
    var line = cleanNumberish(raw);
    var m = line.match(QTY_RE_LIDL);
    if (m) return { unit: toCents(m[1]), qty: parseInt(m[2], 10) };
    m = line.match(QTY_RE_X);
    if (m) return { unit: toCents(m[2]), qty: parseInt(m[1], 10) };
    if (WEIGHT_RE.test(line)) return { weight: true };
    return null;
  }

  // All values a misread number could really be (one or two digit swaps).
  function variants(cents, maxSwaps) {
    if (cents === null) return [];
    var out = {}; out[cents] = true;
    var frontier = [String(Math.abs(cents))];
    var sign = cents < 0 ? -1 : 1;
    for (var k = 0; k < (maxSwaps || 1); k++) {
      var next = [];
      frontier.forEach(function (s) {
        for (var i = 0; i < s.length; i++) {
          (CONFUSIONS[s[i]] || []).forEach(function (r) {
            var t = s.slice(0, i) + r + s.slice(i + 1);
            var v = sign * parseInt(t, 10);
            if (!out[v]) { out[v] = true; next.push(t); }
          });
        }
      });
      frontier = next;
    }
    return Object.keys(out).map(Number);
  }

  function findTotal(lines) {
    var found = [];
    lines.forEach(function (raw) {
      var l = cleanNumberish(raw);
      var p = l.match(PRICE_END_RE);
      if (!p) return;
      var v = toCents(p[2]);
      if (/TOTALE\s+COMPLESSIVO|^\s*TOTALE\b|^\s*TOTAL\b/i.test(l) && !/SUB/i.test(l)) found.push({ v: v, w: 3 });
      else if (/SUB\s*TOTALE|IMPORTO\s+PAGATO|PAGAMENTO\s+ELETTRONICO|PAGAMENTO\s+CONTANTE|CARTA|BANCOMAT/i.test(l)) found.push({ v: v, w: 1 });
    });
    return found;
  }

  function parseReceipt(text) {
    var lines = String(text).split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });

    // Where the item list starts and stops.
    var start = 0;
    for (var i = 0; i < lines.length; i++) if (HEADER_END_RE.test(lines[i])) { start = i + 1; break; }
    var stop = lines.length;
    for (var j = start; j < lines.length; j++) if (STOP_RE.test(lines[j])) { stop = j; break; }

    var items = [];
    for (var k = start; k < stop; k++) {
      var raw = lines[k];
      var q = qtyInfo(raw);
      if (q) {
        var last = items[items.length - 1];
        if (last && !q.weight && q.unit !== null) last.qtyCheck = q.unit * q.qty, last.qtyText = q.qty + ' × ' + fmt(q.unit);
        continue;
      }
      var p = parseLine(raw);
      if (p.name.replace(/[^A-Za-z]/g, '').length < 2) continue; // junk / handwriting
      if (p.price === null && !p.hasVat) continue;               // not an item line
      var discount = DISCOUNT_RE.test(p.name) || (p.price !== null && p.price < 0);
      if (discount && p.price > 0) p.price = -p.price;
      items.push({ name: p.name, price: p.price, discount: discount, flags: [] });
    }

    // 1) Use "Cad x Pz" lines to fill or fix prices.
    items.forEach(function (it) {
      if (it.qtyCheck === undefined) return;
      if (it.price === null) { it.price = it.qtyCheck; it.flags.push('price from qty'); return; }
      if (it.price === it.qtyCheck) return;
      var pv = variants(it.price, 2), qv = variants(it.qtyCheck, 2);
      var match = pv.filter(function (v) { return qv.indexOf(v) !== -1; });
      if (match.length) {
        var best = match.indexOf(it.price) !== -1 ? it.price : match[0];
        if (best !== it.price) { it.price = best; it.flags.push('auto-fixed'); }
      }
    });

    // 2) Make the items add up to the receipt total, trying the fewest digit fixes.
    var totals = findTotal(lines.slice(stop));
    var targets = {};
    totals.forEach(function (t) { variants(t.v, 1).forEach(function (v, idx) { targets[v] = Math.max(targets[v] || 0, idx === 0 ? t.w * 2 : t.w); }); });
    var sum = items.reduce(function (s, it) { return s + (it.price || 0); }, 0);
    var total = null;

    if (targets[sum]) total = sum;
    else if (items.length && totals.length) {
      // Candidate single-digit changes
      var changes = [];
      items.forEach(function (it, idx) {
        if (it.price === null) return;
        variants(it.price, 1).forEach(function (v) { if (v !== it.price) changes.push({ idx: idx, delta: v - it.price, v: v }); });
      });
      var bestFix = null;
      var tryFix = function (combo) {
        var used = {}; var d = 0;
        for (var c = 0; c < combo.length; c++) { if (used[combo[c].idx]) return; used[combo[c].idx] = 1; d += combo[c].delta; }
        var score = targets[sum + d];
        if (score && (!bestFix || combo.length < bestFix.combo.length || (combo.length === bestFix.combo.length && score > bestFix.score)))
          bestFix = { combo: combo, score: score, total: sum + d };
      };
      for (var a = 0; a < changes.length; a++) {
        tryFix([changes[a]]);
        for (var b = a + 1; b < changes.length; b++) {
          tryFix([changes[a], changes[b]]);
          if (changes.length <= 60) for (var c3 = b + 1; c3 < changes.length; c3++) tryFix([changes[a], changes[b], changes[c3]]);
        }
        if (bestFix && bestFix.combo.length === 1) break;
      }
      if (bestFix) {
        bestFix.combo.forEach(function (ch) { items[ch.idx].price = ch.v; items[ch.idx].flags.push('auto-fixed'); });
        total = bestFix.total;
      } else {
        // No fix found: report the most trusted total.
        totals.sort(function (x, y) { return y.w - x.w; });
        var counts = {};
        totals.forEach(function (t) { counts[t.v] = (counts[t.v] || 0) + t.w; });
        total = Number(Object.keys(counts).sort(function (x, y) { return counts[y] - counts[x]; })[0]);
      }
    }

    items.forEach(function (it) {
      if (it.price === null) it.flags.push('missing price');
      else if (total && Math.abs(it.price) > total && it.flags.indexOf('auto-fixed') === -1) it.flags.push('looks too high');
      delete it.qtyCheck;
    });
    return { items: items, total: total };
  }

  function fmt(cents) {
    if (cents === null || cents === undefined || isNaN(cents)) return '—';
    var neg = cents < 0; cents = Math.abs(Math.round(cents));
    return (neg ? '-' : '') + Math.floor(cents / 100) + ',' + String(cents % 100).padStart(2, '0');
  }

  /*
   * Split: items = [{price (cents), people: ['K','M'] | ['ALL']}], people = ['K','M',...], payer = 'K'
   * Returns per-person share in cents (rounded so shares add up exactly to the assigned total).
   */
  function split(items, people, payer) {
    var share = {}; people.forEach(function (p) { share[p] = 0; });
    var detail = {}; people.forEach(function (p) { detail[p] = []; });
    var unassigned = [];
    items.forEach(function (it, idx) {
      if (it.price === null || it.price === undefined || isNaN(it.price)) return;
      var who = (it.people || []).indexOf('ALL') !== -1 ? people.slice() : (it.people || []).filter(function (p) { return share[p] !== undefined; });
      if (!who.length) { unassigned.push(idx); return; }
      // Distribute cents exactly: base share + leftover cents to the first people (rotated per item for fairness).
      var base = Math.trunc(it.price / who.length);
      var rest = it.price - base * who.length;
      who.forEach(function (p, i) {
        var rot = (i + idx) % who.length;
        var extra = rest > 0 ? (rot < rest ? 1 : 0) : (rot < -rest ? -1 : 0);
        share[p] += base + extra;
        detail[p].push({ name: it.name, amount: base + extra, of: who.length });
      });
    });
    var owes = people.filter(function (p) { return p !== payer && share[p] !== 0; })
      .map(function (p) { return { from: p, to: payer, amount: share[p] }; });
    return { share: share, detail: detail, owes: owes, unassigned: unassigned };
  }

  /*
   * Handwritten initials written in the left margin usually come out of OCR glued to the
   * start of the item name ("DH CHEWING GUM", "KM. OVA FRESCHE"). If the first token is made
   * only of known initials (or ALL / TUTTI), pre-assign them and strip them from the name.
   */
  function extractInitials(name, codes) {
    var m = name.match(/^\s*([A-Za-z]{1,6})[.,:;]?\s+(.*)$/);
    if (!m) return { name: name, people: [] };
    var tok = m[1].toUpperCase();
    if (tok === 'ALL' || tok === 'TUTTI' || tok === 'TUTTO') return { name: m[2], people: ['ALL'] };
    var upper = codes.map(function (c) { return c.toUpperCase(); });
    if (upper.indexOf(tok) !== -1) return { name: m[2], people: [codes[upper.indexOf(tok)]] };
    var singles = upper.filter(function (c) { return c.length === 1; });
    if (tok.length >= 2 && tok.length <= 4 && tok.split('').every(function (ch) { return singles.indexOf(ch) !== -1; })) {
      var ppl = [];
      tok.split('').forEach(function (ch) { var c = codes[upper.indexOf(ch)]; if (ppl.indexOf(c) === -1) ppl.push(c); });
      return { name: m[2], people: ppl };
    }
    return { name: name, people: [] };
  }

  var api = { extractInitials: extractInitials, parseReceipt: parseReceipt, split: split, fmt: fmt, toCents: toCents, variants: variants };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReceiptParser = api;
})(typeof window !== 'undefined' ? window : this);
