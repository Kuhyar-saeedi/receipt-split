/*
 * Split maths — no DOM, so it also runs in Node for tests.
 * All money is in cents (integers) to avoid rounding errors.
 */
(function (root) {
  'use strict';

  function toCents(v) {
    v = String(v).trim().replace(/€/g, '').replace(/\s/g, '');
    if (!v) return null;
    var m = v.match(/^(-?)(\d*)(?:[.,](\d{0,2}))?$/);
    if (!m || (m[2] === '' && !m[3])) return null;
    var cents = parseInt(m[2] || '0', 10) * 100 + parseInt(((m[3] || '') + '00').slice(0, 2), 10);
    return m[1] ? -cents : cents;
  }

  function fmt(cents) {
    if (cents === null || cents === undefined || isNaN(cents)) return '';
    var neg = cents < 0; cents = Math.abs(Math.round(cents));
    return (neg ? '-' : '') + Math.floor(cents / 100) + ',' + String(cents % 100).padStart(2, '0');
  }

  /*
   * items:  [{ name, price (cents), people: ['Ali','Sara'] or ['ALL'] }]
   * people: ['Kuhyar','Ali','Sara']   payer: 'Kuhyar'
   * Each item is divided equally among its people; leftover cents are handed out
   * one by one (rotating per item) so the shares always add up to the exact total.
   */
  function split(items, people, payer) {
    var share = {}, detail = {};
    people.forEach(function (p) { share[p] = 0; detail[p] = []; });
    var unassigned = [];
    items.forEach(function (it, idx) {
      if (it.price === null || it.price === undefined || isNaN(it.price)) return;
      var who = (it.people || []).indexOf('ALL') !== -1
        ? people.slice()
        : (it.people || []).filter(function (p) { return share[p] !== undefined; });
      if (!who.length) { unassigned.push(idx); return; }
      var base = Math.trunc(it.price / who.length);
      var rest = it.price - base * who.length;
      who.forEach(function (p, i) {
        var rot = (i + idx) % who.length;
        var extra = rest > 0 ? (rot < rest ? 1 : 0) : (rot < -rest ? -1 : 0);
        share[p] += base + extra;
        detail[p].push({ name: it.name, amount: base + extra, of: who.length });
      });
    });
    var owes = people
      .filter(function (p) { return p !== payer && share[p] !== 0; })
      .map(function (p) { return { from: p, to: payer, amount: share[p] }; });
    return { share: share, detail: detail, owes: owes, unassigned: unassigned };
  }

  var api = { split: split, fmt: fmt, toCents: toCents };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Split = api;
})(typeof window !== 'undefined' ? window : this);
