// Imports an "ordering cost sheet" tab exported from Google Sheets (File > Download > CSV).
// Expected layout: row 1 has delivery days (13th, 16th...), row 2 has column labels
// (Quantity, Quantity Type, Cost Each, Cost Total...), column A has categories and
// column B has vendor headings followed by item names.
window.SR = window.SR || {};
(() => {
  'use strict';

  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  const num = (v) => {
    const m = String(v ?? '').replace(/[$,\s]/g, '').match(/^-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };

  function normUnit(u) {
    let s = String(u || '').toLowerCase().replace('/s', '').trim();
    if (!s) return 'each';
    if (s.endsWith('ches') || s.endsWith('shes')) s = s.slice(0, -2);
    else if (s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
    return s;
  }

  // Finds each delivery block from the "Cost Each" labels in row 2.
  function findBlocks(g) {
    const labels = g[1] || [], dates = g[0] || [];
    const blocks = [];
    labels.forEach((h, c) => {
      if (!/cost\s*each/i.test(h)) return;
      let qty = -1, unit = -1;
      for (let k = c - 1; k >= Math.max(0, c - 3); k--) {
        if (unit < 0 && /quantity\s*type|unit/i.test(labels[k])) unit = k;
        if (/^\s*quantity\s*$/i.test(labels[k])) { qty = k; break; }
      }
      if (qty < 0) qty = c - 1;
      let label = '';
      for (let k = qty; k >= Math.max(0, qty - 2) && !label; k--) label = (dates[k] || '').trim();
      const day = parseInt(label, 10);
      blocks.push({ qty, unit, each: c, label, day: isNaN(day) ? null : day });
    });
    return blocks;
  }

  // Returns a preview: { orders, items, vendors, flags, skipped }.
  function preview(text, year, month) {
    const g = parseCSV(text);
    if (g.length < 3) throw new Error('That file looks empty.');
    const blocks = findBlocks(g).filter((b) => b.day);
    if (!blocks.length) throw new Error('Couldn\'t find any "Cost Each" columns with a date above them. Check that rows 1 and 2 hold the dates and column labels.');

    const vendors = new Map(), items = new Map(), lines = [];
    let category = '', vendorName = '';
    for (let r = 2; r < g.length; r++) {
      const row = g[r];
      const a = (row[0] || '').trim(), b = (row[1] || '').trim();
      if (/^total/i.test(a) || /^total/i.test(b)) break;
      if (a) category = a;
      if (!b) continue;
      // Vendor headings have nothing to the right of the name; item rows carry quantities,
      // prices, or the sheet's zero formulas.
      if (!row.slice(2).some((x) => String(x).trim())) {
        // A heading row: vendor name (possibly with the category in column A).
        vendorName = b; if (!vendors.has(b)) vendors.set(b, { name: b });
        continue;
      }
      for (const bl of blocks) {
        const rawQty = (row[bl.qty] || '').trim();
        const qty = num(rawQty), cost = num(row[bl.each]);
        if (!qty || !cost) continue;
        const unitWord = bl.unit >= 0 && (row[bl.unit] || '').trim() ? row[bl.unit] : rawQty.replace(/^[\d.\s]+/, '');
        const unit = normUnit(unitWord);
        const key = `${vendorName}|${b}`;
        if (!items.has(key)) items.set(key, { name: b, category: category || 'Uncategorized', vendorName: vendorName || 'Unknown vendor', unit });
        lines.push({ key, name: b, vendorName: vendorName || 'Unknown vendor', date: `${year}-${String(month).padStart(2, '0')}-${String(bl.day).padStart(2, '0')}`, qty, unit, cost });
      }
    }

    // Flag same-unit price jumps of 40% or more against the item's median price in this file.
    const flags = [];
    const byKeyUnit = {};
    for (const l of lines) (byKeyUnit[l.key + '|' + l.unit] = byKeyUnit[l.key + '|' + l.unit] || []).push(l.cost);
    for (const l of lines) {
      const all = byKeyUnit[l.key + '|' + l.unit].slice().sort((x, y) => x - y);
      const med = all[Math.floor(all.length / 2)];
      if (all.length > 1 && Math.abs(l.cost - med) / med >= 0.4) flags.push({ ...l, note: `${SR.money(l.cost)} per ${l.unit} vs usual ${SR.money(med)} (line total ${SR.money(l.qty * l.cost)})` });
      else if (l.qty * l.cost > 2000) flags.push({ ...l, note: `Large line: ${l.qty} × ${SR.money(l.cost)} = ${SR.money(l.qty * l.cost)}. Check for a typo.` });
    }
    const unitMixes = [];
    const unitsByItem = {};
    for (const l of lines) (unitsByItem[l.key] = unitsByItem[l.key] || new Set()).add(l.unit);
    for (const [k, set] of Object.entries(unitsByItem)) if (set.size > 1) unitMixes.push({ name: k.split('|')[1], units: [...set] });

    const orders = {};
    for (const l of lines) {
      const ok = l.vendorName + '|' + l.date;
      (orders[ok] = orders[ok] || { vendorName: l.vendorName, date: l.date, lines: [] }).lines.push(l);
    }
    return { orders: Object.values(orders), items: [...items.values()], vendors: [...vendors.values()], lines, flags, unitMixes };
  }

  // Applies a preview to the live state. Imported orders count as received spending and
  // price history only. They don't change on-hand stock (a cycle count sets that).
  function apply(p) {
    const st = SR.state;
    const vByName = new Map(st.vendors.map((v) => [v.name.toLowerCase(), v]));
    const getVendor = (name) => {
      let v = vByName.get(name.toLowerCase());
      if (!v) { v = { id: SR.uid('v_'), name, days: [] }; st.vendors.push(v); vByName.set(name.toLowerCase(), v); }
      return v;
    };
    const getItem = (name, vendorId, category, unit, cost) => {
      let it = st.items.find((i) => i.name.toLowerCase() === name.toLowerCase() && i.vendorId === vendorId);
      if (!it) { it = { id: SR.uid('i_'), name, category, vendorId, unit, par: 0, cost }; st.items.push(it); }
      return it;
    };
    for (const o of p.orders.sort((a, b) => a.date.localeCompare(b.date))) {
      const v = getVendor(o.vendorName);
      const lines = o.lines.map((l) => {
        const meta = p.items.find((i) => i.name === l.name && i.vendorName === l.vendorName);
        const it = getItem(l.name, v.id, meta ? meta.category : 'Uncategorized', l.unit, l.cost);
        if (it.unit === l.unit) it.cost = l.cost;
        return { itemId: it.id, qty: l.qty, unit: l.unit, cost: l.cost, received: l.qty, damaged: 0, note: '' };
      });
      st.orders.push({ id: SR.uid('o_'), number: 1000 + st.orders.length + 1, date: o.date, deliveryDate: o.date, receivedDate: o.date, vendorId: v.id, status: 'received', imported: true, lines, notes: 'Imported from spreadsheet' });
    }
    st.orders.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
    SR.save();
  }

  SR.importer = { parseCSV, preview, apply };
})();
