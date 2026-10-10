// Builds a realistic, made-up restaurant dataset: about 14 weeks of orders, receiving,
// daily usage, waste, and bi-weekly cycle counts, ending today.
// Vendor names, items and prices are fictional.
window.SR = window.SR || {};
(() => {
  'use strict';

  function rng(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // [name, unit, cost, par, weekly usage]
  const CATALOG = {
    Produce: { vendor: 'Garden State Produce', days: [1, 4], items: [
      ['Arugula', 'case', 19.5, 4, 6], ['Asparagus', 'case', 59, 3, 4], ['Broccoli Rabe', 'case', 48, 2, 3],
      ['Brussels Sprouts', 'case', 58, 3, 4], ['Lemons', 'case', 36, 2, 2.5], ['Limes', 'case', 39, 1, 1.5],
      ['Garlic, peeled', 'jar', 17.5, 4, 5], ['Shiitake Mushrooms', 'case', 18, 3, 4], ['Romaine', 'case', 34, 3, 4],
      ['Scallions', 'bunch', 1.5, 20, 25], ['Cilantro', 'bunch', 1.75, 10, 14], ['Fingerling Potatoes', 'case', 16.68, 4, 6],
    ] },
    Dairy: { vendor: 'Hudson Valley Dairy Co.', days: [2, 5], items: [
      ['Butter', 'lb', 4.31, 60, 70], ['Heavy Cream', 'case', 48.7, 4, 4], ['Whole Milk', 'case', 23.23, 2, 2],
      ['Shaved Parmesan', 'lb', 25.5, 6, 6], ['Eggs, 15 dozen', 'case', 33.5, 2, 2], ['Shredded Cheddar', 'lb', 3.17, 20, 18],
    ] },
    'Dry Goods': { vendor: 'Liberty Foodservice', days: [3], items: [
      ['Vegetable Oil', 'case', 47.21, 3, 2], ['Balsamic Vinegar', 'case', 61.95, 2, 1], ['Smoked Paprika', 'jar', 14.1, 4, 2],
      ['Ground Black Pepper', 'jar', 22.19, 4, 2.5], ['Dark Brown Sugar', 'case', 39.37, 2, 1], ['Pan Spray', 'case', 31.99, 2, 1],
      ['Kosher Salt', 'case', 28.4, 2, 1.5],
    ] },
    Beverages: { vendor: 'Meadowbrook Beverage', days: [1], items: [
      ['Sparkling Water', 'case', 40.49, 12, 10], ['Still Water', 'case', 26.99, 8, 7], ['Ginger Beer', 'case', 32.5, 4, 3],
    ] },
  };

  const DAYS = 98;

  function build() {
    const R = rng(20261009);
    const st = SR.empty();
    st.demo = true;
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const end = new Date(); end.setHours(12, 0, 0, 0);
    const start = addDays(end, -DAYS);

    // vendors & items
    const sim = {}; // itemId -> { actual, system, weekly, cost, shrink }
    Object.entries(CATALOG).forEach(([category, def]) => {
      const v = { id: SR.uid('v_'), name: def.vendor, days: def.days };
      st.vendors.push(v);
      for (const [name, unit, cost, par, weekly] of def.items) {
        const it = { id: SR.uid('i_'), name, category, vendorId: v.id, unit, par, cost };
        st.items.push(it);
        sim[it.id] = { actual: par, system: par, weekly, cost, shrink: 0, nextChange: 20 + Math.floor(R() * 60) };
        st.moves.push({ id: SR.uid('m_'), date: SR.toISO(start), itemId: it.id, type: 'adjust', qty: par, note: 'Opening balance' });
      }
    });

    const intQty = (it) => it.unit !== 'lb';
    const nextDelivery = (v, d) => { for (let k = 1; k <= 7; k++) if (v.days.includes(addDays(d, k).getDay())) return k; return 7; };
    let countRot = 0;
    const cats = Object.keys(CATALOG);

    for (let day = 1; day <= DAYS; day++) {
      const d = addDays(start, day), iso = SR.toISO(d), dow = d.getDay(), isToday = day === DAYS;

      // price drift: an occasional real price change
      for (const it of st.items) {
        const s = sim[it.id];
        if (day === s.nextChange) { s.cost = SR.round2(s.cost * (1 + (R() > 0.35 ? 1 : -1) * (0.04 + R() * 0.1))); s.nextChange = day + 30 + Math.floor(R() * 50); }
      }

      // deliveries
      for (const v of st.vendors) {
        if (!v.days.includes(dow)) continue;
        const gap = nextDelivery(v, d);
        const lines = [];
        for (const it of st.items.filter((i) => i.vendorId === v.id)) {
          const s = sim[it.id];
          const need = it.par + (s.weekly / 7) * gap - s.system;
          if (need <= it.par * 0.25) continue;
          const qty = intQty(it) ? Math.max(1, Math.ceil(need)) : Math.max(5, Math.round(need / 5) * 5);
          lines.push({ itemId: it.id, qty, unit: it.unit, cost: s.cost, received: 0, damaged: 0, note: '' });
        }
        if (!lines.length) continue;
        const o = { id: SR.uid('o_'), number: 1000 + st.orders.length + 1, date: SR.toISO(addDays(d, -1)), deliveryDate: iso, vendorId: v.id, status: 'ordered', lines, notes: '' };
        st.orders.push(o);
        if (isToday) {
          continue; // deliveries due today stay open so they can be received in the demo
        }
        o.status = 'received'; o.receivedDate = iso;
        for (const l of lines) {
          const r = R();
          l.received = r < 0.07 ? Math.max(0, l.qty - Math.max(1, Math.round(l.qty * 0.3))) : l.qty;
          if (l.received !== l.qty) l.note = 'Short on delivery';
          if (R() < 0.03 && l.received > 0) { l.damaged = 1; l.note = 'Damaged in transit, credit requested'; }
          const accepted = l.received - l.damaged;
          if (accepted > 0) st.moves.push({ id: SR.uid('m_'), date: iso, itemId: l.itemId, type: 'receive', qty: accepted, unitCost: l.cost, ref: o.id });
          sim[l.itemId].actual += accepted; sim[l.itemId].system += accepted;
          st.items.find((i) => i.id === l.itemId).cost = l.cost;
        }
      }

      // daily usage (recorded from sales) plus a little unrecorded shrink
      for (const it of st.items) {
        const s = sim[it.id];
        let use = (s.weekly / 7) * (0.7 + R() * 0.6) * (dow === 5 || dow === 6 ? 1.4 : 0.85);
        use = intQty(it) ? Math.round(use * 4) / 4 : SR.round2(use);
        use = Math.min(use, Math.max(0, s.actual));
        if (use > 0) {
          st.moves.push({ id: SR.uid('m_'), date: iso, itemId: it.id, type: 'usage', qty: use, note: 'Daily usage' });
          s.actual -= use; s.system -= use;
        }
        if (it.category === 'Produce' && R() < 0.035 && s.actual >= 1) {
          if (R() < 0.8) {
            st.moves.push({ id: SR.uid('m_'), date: iso, itemId: it.id, type: 'waste', qty: 1, note: 'Spoiled, discarded' });
            s.system -= 1;
          } else s.shrink += 1; // spoiled but nobody logged it
          s.actual -= 1;
        }
        if (R() < 0.0015 && s.actual >= 1) { s.actual -= intQty(it) ? 1 : 2; s.shrink += 1; }
      }

      // bi-weekly cycle count, rotating categories, on Fridays
      if (dow === 5 && day > 7 && !isToday && Math.floor(day / 7) % 2 === 0) {
        const cat = cats[countRot++ % cats.length];
        const c = { id: SR.uid('c_'), number: 200 + st.counts.length + 1, date: iso, scope: { type: 'category', value: cat }, blind: true, status: 'posted', postedDate: iso, lines: [] };
        for (const it of st.items.filter((i) => i.category === cat)) {
          const s = sim[it.id];
          const expected = SR.round2(s.system);
          let counted = SR.round2(Math.max(0, s.actual));
          let reason = '';
          if (Math.abs(counted - expected) > 0.001) reason = s.shrink > 0 && it.category === 'Produce' ? 'Waste not logged' : 'Theft / unexplained';
          if (R() < 0.04) { counted = SR.round2(counted + 1); reason = 'Receiving error'; }
          c.lines.push({ itemId: it.id, expected, counted, reason });
          const diff = SR.round2(counted - expected);
          if (diff) st.moves.push({ id: SR.uid('m_'), date: iso, itemId: it.id, type: 'adjust', qty: diff, ref: c.id, note: `Count #${c.number}: ${reason}` });
          s.system = counted; s.actual = counted; s.shrink = 0;
        }
        st.counts.push(c);
      }
    }

    // Plant the invoice typo on today's open beverage order (extra digit: 404.85 vs 40.49).
    const bev = st.vendors.find((v) => v.name === 'Meadowbrook Beverage');
    const sparkling = st.items.find((i) => i.name === 'Sparkling Water');
    let open = st.orders.filter((o) => o.status === 'ordered' && o.vendorId === bev.id).pop();
    if (!open) {
      open = { id: SR.uid('o_'), number: 1000 + st.orders.length + 1, date: SR.toISO(addDays(end, -1)), deliveryDate: SR.toISO(end), vendorId: bev.id, status: 'ordered', lines: [], notes: '' };
      st.orders.push(open);
    }
    let line = open.lines.find((l) => l.itemId === sparkling.id);
    if (!line) { line = { itemId: sparkling.id, qty: 15, unit: 'case', cost: 0, received: 0, damaged: 0, note: '' }; open.lines.unshift(line); }
    line.qty = 15; line.cost = SR.round2(sparkling.cost * 10);
    open.notes = 'Entered from the vendor invoice.';

    st.orders.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
    return st;
  }

  SR.buildDemo = build;
})();
