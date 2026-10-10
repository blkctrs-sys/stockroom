// Stockroom data store: state, persistence, and derived numbers.
// Everything lives in one plain object saved to this device's localStorage.
window.SR = window.SR || {};
(() => {
  'use strict';

  const KEY = 'stockroom:v1';

  // Movement types and the sign they apply to on-hand quantity.
  const MOVE_TYPES = {
    receive: { label: 'Received', sign: 1 },
    usage: { label: 'Used / sold', sign: -1 },
    waste: { label: 'Waste / damaged', sign: -1 },
    transfer_out: { label: 'Transfer out', sign: -1 },
    transfer_in: { label: 'Transfer in', sign: 1 },
    return: { label: 'Returned to vendor', sign: -1 },
    adjust: { label: 'Count adjustment', sign: 1 }, // qty already carries its sign
  };

  const COUNT_REASONS = [
    'Miscount (recounted)',
    'Receiving error',
    'Waste not logged',
    'Damaged / unsellable',
    'Transfer not logged',
    'Theft / unexplained',
    'Unit of measure mix-up',
  ];

  let state = null;

  const uid = (p) => p + Math.random().toString(36).slice(2, 9);
  const round2 = (n) => Math.round(n * 100) / 100;
  const today = () => toISO(new Date());

  function toISO(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function empty() {
    return { version: 1, demo: false, vendors: [], items: [], orders: [], moves: [], counts: [] };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { state = JSON.parse(raw); return true; }
    } catch { /* storage unavailable: fall through to in-memory */ }
    return false;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { SR.toast && SR.toast('Could not save on this device. Changes last until you close the tab.', 'warn'); }
  }

  function replace(next) { state = next; save(); }

  // ---------- lookups ----------
  const vendor = (id) => state.vendors.find((v) => v.id === id);
  const item = (id) => state.items.find((i) => i.id === id);
  const order = (id) => state.orders.find((o) => o.id === id);
  const count = (id) => state.counts.find((c) => c.id === id);

  // ---------- derived ----------
  function onHand(itemId, asOf) {
    let q = 0;
    for (const m of state.moves) {
      if (m.itemId !== itemId || (asOf && m.date > asOf)) continue;
      q += m.qty * MOVE_TYPES[m.type].sign;
    }
    return round2(q);
  }

  function inventoryValue() {
    return round2(state.items.reduce((s, i) => s + Math.max(0, onHand(i.id)) * (i.cost || 0), 0));
  }

  const lineTotal = (l) => round2((l.qty || 0) * (l.cost || 0));
  const orderTotal = (o) => round2(o.lines.reduce((s, l) => s + lineTotal(l), 0));
  // What was actually received and accepted (received minus damaged), at invoice cost.
  const receivedTotal = (o) => round2(o.lines.reduce((s, l) => s + Math.max(0, (l.received || 0) - (l.damaged || 0)) * (l.cost || 0), 0));
  const spendOf = (o) => (o.status === 'received' ? receivedTotal(o) : 0);

  // Price history for an item from received orders, oldest first.
  function priceHistory(itemId) {
    const out = [];
    for (const o of state.orders) {
      if (o.status !== 'received') continue;
      for (const l of o.lines) if (l.itemId === itemId && l.cost) out.push({ date: o.receivedDate || o.date, unit: l.unit, cost: l.cost, orderId: o.id, vendorId: o.vendorId });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Compares a new price to the last price paid in the SAME unit.
  // Different units are reported as a unit change, never as a price change.
  function priceCheck(itemId, unit, cost, beforeDate) {
    const hist = priceHistory(itemId).filter((h) => !beforeDate || h.date < beforeDate);
    if (!hist.length || !cost) return null;
    const sameUnit = hist.filter((h) => h.unit === unit);
    if (!sameUnit.length) {
      const last = hist[hist.length - 1];
      return { kind: 'unit', message: `Unit changed: last bought by the ${last.unit} at ${SR.money(last.cost)}. This line is by the ${unit}, so the prices can't be compared directly.` };
    }
    const last = sameUnit[sameUnit.length - 1];
    const change = (cost - last.cost) / last.cost;
    if (Math.abs(change) >= 0.4) {
      return { kind: 'outlier', last, change, message: `${change > 0 ? 'Up' : 'Down'} ${Math.round(Math.abs(change) * 100)}% from the last ${SR.money(last.cost)} per ${unit}. Check the invoice for a typo before receiving.` };
    }
    if (Math.abs(change) >= 0.005) return { kind: 'change', last, change };
    return null;
  }

  // Recent same-unit price changes across all items.
  function priceChanges(limit = 8) {
    const out = [];
    for (const i of state.items) {
      const h = priceHistory(i.id);
      for (let k = h.length - 1; k > 0; k--) {
        const cur = h[k];
        const prev = h.slice(0, k).reverse().find((p) => p.unit === cur.unit);
        if (prev && Math.abs(cur.cost - prev.cost) > 0.004) { out.push({ item: i, from: prev.cost, to: cur.cost, unit: cur.unit, date: cur.date }); break; }
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  }

  function countSummary(c) {
    let expVal = 0, varVal = 0, matched = 0;
    for (const l of c.lines) {
      const it = item(l.itemId); const cost = (it && it.cost) || 0;
      const v = (l.counted ?? l.expected) - l.expected;
      expVal += Math.max(0, l.expected) * cost;
      varVal += v * cost;
      if (Math.abs(v) < 0.001) matched++;
    }
    const lines = c.lines.length;
    return {
      lines, matched,
      accuracy: lines ? matched / lines : 1,
      varianceValue: round2(varVal),
      absVarianceValue: round2(c.lines.reduce((s, l) => { const it = item(l.itemId); return s + Math.abs(((l.counted ?? l.expected) - l.expected) * ((it && it.cost) || 0)); }, 0)),
      expectedValue: round2(expVal),
    };
  }

  const monthKey = (iso) => iso.slice(0, 7);

  Object.defineProperty(SR, 'state', { get: () => state, configurable: true });
  Object.assign(SR, {
    MOVE_TYPES, COUNT_REASONS, uid, round2, today, toISO, empty, load, save, replace,
    vendor, item, order, count, onHand, inventoryValue, lineTotal, orderTotal, receivedTotal, spendOf,
    priceHistory, priceCheck, priceChanges, countSummary, monthKey,
  });
})();
