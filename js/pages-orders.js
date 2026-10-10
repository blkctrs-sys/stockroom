// Dashboard, orders, and receiving.
(() => {
  'use strict';
  const { esc, money, qty, pct, plural, fmtDate, monthLabel } = SR;

  // ---------- dashboard ----------
  SR.route(/^\/$/, (view) => {
    const st = SR.state, now = SR.today(), mk = SR.monthKey(now);
    const prevKey = SR.monthKey(SR.toISO(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)));
    const received = st.orders.filter((o) => o.status === 'received');
    const dayOfMonth = now.slice(8, 10);
    // Month-to-date vs the same point last month, so a partial month isn't compared to a full one.
    const spendIn = (k, upToDay) => received.filter((o) => SR.monthKey(o.receivedDate) === k && (!upToDay || o.receivedDate.slice(8, 10) <= upToDay)).reduce((s, o) => s + SR.spendOf(o), 0);
    const spend = spendIn(mk), prev = spendIn(prevKey, dayOfMonth);
    const open = st.orders.filter((o) => o.status === 'ordered');
    const due = open.filter((o) => o.deliveryDate <= now);
    const lastCount = st.counts.filter((c) => c.status === 'posted').sort((a, b) => b.date.localeCompare(a.date))[0];
    const lc = lastCount && SR.countSummary(lastCount);
    const below = st.items.filter((i) => i.par > 0 && SR.onHand(i.id) < i.par * 0.5);
    const changes = SR.priceChanges(6);

    // last 4 months of spend by vendor
    const months = [];
    for (let k = 3; k >= 0; k--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); months.push(SR.monthKey(SR.toISO(d))); }
    const rows = months.map((m) => {
      const values = {};
      for (const o of received) if (SR.monthKey(o.receivedDate) === m) values[o.vendorId] = (values[o.vendorId] || 0) + SR.spendOf(o);
      return { label: monthLabel(m), values };
    });
    const series = st.vendors.map((v) => ({ key: v.id, label: v.name, colorVar: SR.vendorColor(v.id) }));

    const delta = prev ? (spend - prev) / prev : null;
    view.innerHTML = `
      <header class="page-head"><div><h1>Dashboard</h1><p class="sub">${fmtDate(now, { weekday: 'long', month: 'long', day: 'numeric' })}</p></div>
        <div class="row"><a class="btn" href="#/counts/new">Start a count</a><a class="btn primary" href="#/orders/new">New order</a></div></header>

      <section class="tiles">
        <div class="tile"><span class="t-label">Spend, ${monthLabel(mk, true)}</span><span class="t-value">${money(spend)}</span>
          <span class="t-foot">${delta === null ? 'Received orders so far' : `${delta >= 0 ? '▲' : '▼'} ${pct(Math.abs(delta))} vs same point in ${monthLabel(prevKey, true).split(' ')[0]}`}</span></div>
        <div class="tile"><span class="t-label">Inventory value</span><span class="t-value">${money(SR.inventoryValue())}</span>
          <span class="t-foot">${plural(st.items.length, 'item')} on hand at last cost</span></div>
        <div class="tile"><span class="t-label">Open orders</span><span class="t-value">${open.length}</span>
          <span class="t-foot">${due.length ? `<span class="status warn">● ${plural(due.length, 'delivery', 'deliveries')} due to receive</span>` : 'Nothing due today'}</span></div>
        <div class="tile"><span class="t-label">Last count accuracy</span><span class="t-value">${lc ? pct(lc.accuracy) : '—'}</span>
          <span class="t-foot">${lc ? `${lastCount.scope.value || 'All items'}, ${fmtDate(lastCount.date, { month: 'short', day: 'numeric' })} · ${money(lc.varianceValue)} net` : 'No counts yet'}</span></div>
      </section>

      <section class="grid-2">
        <div class="card span-2"><h2>Monthly spend by vendor</h2><div id="spend-chart"></div></div>

        <div class="card"><h2>Needs attention</h2>
          ${due.length || below.length ? `<ul class="list">
            ${due.map((o) => `<li><a href="#/orders/${o.id}"><span class="status warn">● Receive</span> PO #${o.number} · ${esc(SR.vendor(o.vendorId).name)}</a><span class="muted">${o.deliveryDate < now ? 'Overdue' : 'Due today'}</span></li>`).join('')}
            ${below.slice(0, 8).map((i) => `<li><a href="#/items/${i.id}"><span class="status serious">● Low</span> ${esc(i.name)}</a><span class="muted">${qty(SR.onHand(i.id))} of ${qty(i.par)} ${esc(i.unit)}</span></li>`).join('')}
          </ul>` : '<p class="empty">All caught up.</p>'}
        </div>

        <div class="card"><h2>Recent price changes</h2>
          ${changes.length ? `<table class="data compact"><thead><tr><th>Item</th><th class="num">Was</th><th class="num">Now</th><th class="num">Change</th></tr></thead><tbody>
            ${changes.map((c) => { const ch = (c.to - c.from) / c.from; return `<tr><td><a href="#/items/${c.item.id}">${esc(c.item.name)}</a><div class="muted small">per ${esc(c.unit)} · ${fmtDate(c.date, { month: 'short', day: 'numeric' })}</div></td>
              <td class="num">${money(c.from)}</td><td class="num">${money(c.to)}</td><td class="num ${ch > 0 ? 'up' : 'down'}">${ch > 0 ? '▲' : '▼'} ${pct(Math.abs(ch))}</td></tr>`; }).join('')}
          </tbody></table><p class="muted small">Only compares prices in the same unit (case to case, lb to lb).</p>` : '<p class="empty">No price changes yet.</p>'}
        </div>
      </section>`;
    SR.charts.stackedBars(document.getElementById('spend-chart'), { series, rows, title: 'Monthly spend by vendor' });
  });

  // ---------- orders list ----------
  SR.route(/^\/orders(?:\?(\w+))?$/, (view, filter) => {
    filter = filter || 'open';
    const st = SR.state;
    const list = st.orders.filter((o) => filter === 'all' || (filter === 'open' ? o.status === 'ordered' : o.status === 'received'))
      .slice().sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate));
    const shown = list.slice(0, 120);
    view.innerHTML = `
      <header class="page-head"><div><h1>Orders</h1><p class="sub">Purchase orders and receiving</p></div>
        <a class="btn primary" href="#/orders/new">New order</a></header>
      <nav class="tabs">${['open', 'received', 'all'].map((f) => `<a href="#/orders?${f}" class="${f === filter ? 'active' : ''}">${f[0].toUpperCase() + f.slice(1)}</a>`).join('')}</nav>
      <div class="card flush">${shown.length ? `<table class="data clickable"><thead><tr><th>PO</th><th>Vendor</th><th>Delivery</th><th class="num">Lines</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>
        ${shown.map((o) => `<tr data-href="#/orders/${o.id}"><td><a href="#/orders/${o.id}">#${o.number}</a></td><td><span class="dot" style="background:var(${SR.vendorColor(o.vendorId)})"></span>${esc(SR.vendor(o.vendorId).name)}</td>
          <td>${fmtDate(o.deliveryDate)}</td><td class="num">${o.lines.length}</td><td class="num">${money(o.status === 'received' ? SR.receivedTotal(o) : SR.orderTotal(o))}</td>
          <td>${o.status === 'received' ? '<span class="status good">✓ Received</span>' : o.deliveryDate <= SR.today() ? '<span class="status warn">● To receive</span>' : '<span class="status">○ Ordered</span>'}</td></tr>`).join('')}
      </tbody></table>${list.length > shown.length ? `<p class="muted small pad">Showing the latest ${shown.length} of ${list.length}.</p>` : ''}` : '<p class="empty pad">No orders here.</p>'}</div>`;
    view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.tagName !== 'A') location.hash = tr.dataset.href; }));
  });

  // ---------- new order ----------
  SR.route(/^\/orders\/new$/, (view) => {
    const st = SR.state;
    const draft = { vendorId: st.vendors[0] && st.vendors[0].id, date: SR.today(), deliveryDate: SR.today(), lines: [], notes: '' };

    function vendorItems() { return st.items.filter((i) => i.vendorId === draft.vendorId).sort((a, b) => a.name.localeCompare(b.name)); }
    function addLine(it, q) { draft.lines.push({ itemId: it.id, qty: q || 1, unit: it.unit, cost: it.cost || 0 }); }

    function render() {
      const items = vendorItems();
      const total = draft.lines.reduce((s, l) => s + l.qty * l.cost, 0);
      view.innerHTML = `
        <header class="page-head"><div><a class="back" href="#/orders">← Orders</a><h1>New order</h1></div></header>
        <div class="card">
          <div class="form-grid">
            <label>Vendor<select id="vendor">${st.vendors.map((v) => `<option value="${v.id}" ${v.id === draft.vendorId ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
            <label>Order date<input type="date" id="date" value="${draft.date}"></label>
            <label>Delivery date<input type="date" id="delivery" value="${draft.deliveryDate}"></label>
          </div>
          <div class="row wrap gap-s top-gap">
            <button class="btn" id="suggest" type="button">Add items below par</button>
            <select id="add-item"><option value="">+ Add an item…</option>${items.map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join('')}</select>
          </div>
          ${draft.lines.length ? `<table class="data top-gap"><thead><tr><th>Item</th><th class="num">On hand / par</th><th class="num">Qty</th><th>Unit</th><th class="num">Cost each</th><th class="num">Line total</th><th></th></tr></thead><tbody>
            ${draft.lines.map((l, k) => { const it = SR.item(l.itemId); return `<tr>
              <td>${esc(it.name)}</td><td class="num muted">${qty(SR.onHand(it.id))} / ${qty(it.par)}</td>
              <td class="num"><input class="num-in" type="number" min="0" step="any" data-k="${k}" data-f="qty" value="${l.qty}"></td>
              <td><input class="unit-in" data-k="${k}" data-f="unit" value="${esc(l.unit)}"></td>
              <td class="num"><input class="num-in" type="number" min="0" step="0.01" data-k="${k}" data-f="cost" value="${l.cost}"></td>
              <td class="num">${money(l.qty * l.cost)}</td><td><button class="icon-btn" data-del="${k}" aria-label="Remove ${esc(it.name)}">×</button></td></tr>`; }).join('')}
          </tbody><tfoot><tr><td colspan="5" class="num">Order total</td><td class="num"><strong>${money(total)}</strong></td><td></td></tr></tfoot></table>` : '<p class="empty">No lines yet. Add items below par or pick items one at a time.</p>'}
          <label class="top-gap">Notes<textarea id="notes" rows="2">${esc(draft.notes)}</textarea></label>
          <div class="row end top-gap"><a class="btn ghost" href="#/orders">Cancel</a><button class="btn primary" id="save" ${draft.lines.length ? '' : 'disabled'}>Place order</button></div>
        </div>`;

      view.querySelector('#vendor').onchange = (e) => { draft.vendorId = e.target.value; draft.lines = []; render(); };
      view.querySelector('#date').onchange = (e) => { draft.date = e.target.value; };
      view.querySelector('#delivery').onchange = (e) => { draft.deliveryDate = e.target.value; };
      view.querySelector('#notes').oninput = (e) => { draft.notes = e.target.value; };
      view.querySelector('#add-item').onchange = (e) => { const it = SR.item(e.target.value); if (it) { addLine(it, 1); render(); } };
      view.querySelector('#suggest').onclick = () => {
        let n = 0;
        for (const it of items) {
          const need = it.par - SR.onHand(it.id);
          if (it.par > 0 && need > 0 && !draft.lines.some((l) => l.itemId === it.id)) { addLine(it, Math.ceil(need)); n++; }
        }
        SR.toast(n ? `Added ${plural(n, 'item')} to bring stock up to par.` : 'Everything from this vendor is at or above par.');
        render();
      };
      view.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', (e) => {
        const l = draft.lines[+e.target.dataset.k], f = e.target.dataset.f;
        l[f] = f === 'unit' ? e.target.value.trim() : parseFloat(e.target.value) || 0; render();
      }));
      view.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { draft.lines.splice(+b.dataset.del, 1); render(); });
      view.querySelector('#save').onclick = () => {
        const o = { id: SR.uid('o_'), number: 1000 + st.orders.length + 1, date: draft.date, deliveryDate: draft.deliveryDate, vendorId: draft.vendorId, status: 'ordered',
          lines: draft.lines.filter((l) => l.qty > 0).map((l) => ({ ...l, received: 0, damaged: 0, note: '' })), notes: draft.notes };
        st.orders.push(o); SR.save();
        SR.toast(`PO #${o.number} placed.`, 'good');
        location.hash = '#/orders/' + o.id;
      };
    }
    if (!st.vendors.length) { view.innerHTML = '<div class="card"><p class="empty">Add an item and vendor first on the <a href="#/items">Items</a> page.</p></div>'; return; }
    render();
  });

  // ---------- jump to the first open order with a price or unit flag ----------
  SR.route(/^\/orders\/flagged$/, (view) => {
    const open = SR.state.orders.filter((o) => o.status === 'ordered').sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
    const hit = open.find((o) => o.lines.some((l) => { const c = SR.priceCheck(l.itemId, l.unit, l.cost, o.deliveryDate); return c && c.kind !== 'change'; }));
    if (hit) location.replace('#/orders/' + hit.id);
    else { view.innerHTML = '<p class="empty">No open orders need a second look.</p>'; }
  });

  // ---------- order detail & receiving ----------
  SR.route(/^\/orders\/(o_\w+)$/, (view, id) => {
    const o = SR.order(id);
    if (!o) { view.innerHTML = '<p class="empty">Order not found.</p>'; return; }
    const v = SR.vendor(o.vendorId);

    if (o.status === 'received') {
      const ordered = o.lines.reduce((s, l) => s + l.qty, 0), got = o.lines.reduce((s, l) => s + (l.received - l.damaged), 0);
      const issues = o.lines.filter((l) => l.received !== l.qty || l.damaged);
      view.innerHTML = `
        <header class="page-head"><div><a class="back" href="#/orders?received">← Orders</a><h1>PO #${o.number}</h1>
          <p class="sub">${esc(v.name)} · received ${fmtDate(o.receivedDate)}${o.imported ? ' · imported from spreadsheet' : ''}</p></div>
          <span class="status good big">✓ Received</span></header>
        <section class="tiles three">
          <div class="tile"><span class="t-label">Invoice total</span><span class="t-value">${money(SR.receivedTotal(o))}</span><span class="t-foot">Ordered ${money(SR.orderTotal(o))}</span></div>
          <div class="tile"><span class="t-label">Fill rate</span><span class="t-value">${pct(ordered ? got / ordered : 1)}</span><span class="t-foot">${qty(got)} of ${qty(ordered)} units accepted</span></div>
          <div class="tile"><span class="t-label">Issues</span><span class="t-value">${issues.length}</span><span class="t-foot">${issues.length ? 'Shorts or damaged lines' : 'Clean delivery'}</span></div>
        </section>
        <div class="card flush"><table class="data"><thead><tr><th>Item</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Damaged</th><th>Unit</th><th class="num">Cost each</th><th class="num">Total</th><th>Note</th></tr></thead><tbody>
          ${o.lines.map((l) => { const it = SR.item(l.itemId); return `<tr class="${l.received !== l.qty || l.damaged ? 'flag' : ''}"><td><a href="#/items/${it.id}">${esc(it.name)}</a></td><td class="num">${qty(l.qty)}</td><td class="num">${qty(l.received)}</td><td class="num">${l.damaged ? qty(l.damaged) : ''}</td><td>${esc(l.unit)}</td><td class="num">${money(l.cost)}</td><td class="num">${money(Math.max(0, l.received - l.damaged) * l.cost)}</td><td class="muted">${esc(l.note)}</td></tr>`; }).join('')}
        </tbody></table></div>
        ${o.notes ? `<p class="muted">Notes: ${esc(o.notes)}</p>` : ''}`;
      return;
    }

    // Receiving form
    const work = o.lines.map((l) => ({ received: l.qty, damaged: 0, cost: l.cost, note: '' }));
    let recvDate = SR.today() < o.deliveryDate ? o.deliveryDate : SR.today();

    function checks() { return o.lines.map((l, k) => SR.priceCheck(l.itemId, l.unit, work[k].cost, recvDate)); }

    function render() {
      const ck = checks();
      const flagged = ck.filter((c) => c && (c.kind === 'outlier' || c.kind === 'unit')).length;
      const total = work.reduce((s, w) => s + Math.max(0, w.received - w.damaged) * w.cost, 0);
      view.innerHTML = `
        <header class="page-head"><div><a class="back" href="#/orders">← Orders</a><h1>Receive PO #${o.number}</h1>
          <p class="sub">${esc(v.name)} · ordered ${fmtDate(o.date)} · due ${fmtDate(o.deliveryDate)}</p></div>
          <button class="btn ghost danger-text" id="cancel-po">Cancel order</button></header>
        ${flagged ? `<div class="alert serious" role="alert"><strong>⚠ ${plural(flagged, 'line needs', 'lines need')} a second look.</strong> Compare against the invoice before receiving. Fixing a typo here keeps your costs and reports right.</div>` : ''}
        <div class="card flush">
          <table class="data receive"><thead><tr><th>Item</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Damaged</th><th class="num">Invoice cost</th><th class="num">Accepted total</th><th>Note</th></tr></thead><tbody>
          ${o.lines.map((l, k) => { const it = SR.item(l.itemId), w = work[k], c = ck[k]; return `<tr class="${c && c.kind !== 'change' ? 'flag' : ''}">
            <td><strong>${esc(it.name)}</strong><div class="muted small">per ${esc(l.unit)}</div>
              ${c && c.kind !== 'change' ? `<div class="check ${c.kind}">⚠ ${esc(c.message)}</div>` : ''}
              ${c && c.kind === 'change' ? `<div class="muted small">${c.change > 0 ? '▲' : '▼'} ${pct(Math.abs(c.change))} vs last ${money(c.last.cost)}</div>` : ''}</td>
            <td class="num">${qty(l.qty)}</td>
            <td class="num"><input class="num-in" type="number" min="0" step="any" data-k="${k}" data-f="received" value="${w.received}" aria-label="Received ${esc(it.name)}"></td>
            <td class="num"><input class="num-in" type="number" min="0" step="any" data-k="${k}" data-f="damaged" value="${w.damaged}" aria-label="Damaged ${esc(it.name)}"></td>
            <td class="num"><input class="num-in wide" type="number" min="0" step="0.01" data-k="${k}" data-f="cost" value="${w.cost}" aria-label="Invoice cost ${esc(it.name)}"></td>
            <td class="num">${money(Math.max(0, w.received - w.damaged) * w.cost)}</td>
            <td><input class="note-in" data-k="${k}" data-f="note" value="${esc(w.note)}" placeholder="${w.received < l.qty ? 'Short: reason?' : ''}"></td></tr>`; }).join('')}
          </tbody><tfoot><tr><td colspan="5" class="num">Accepted total</td><td class="num"><strong>${money(total)}</strong></td><td></td></tr></tfoot></table>
        </div>
        <div class="row end top-gap wrap">
          <label class="inline">Received on <input type="date" id="recv-date" value="${recvDate}"></label>
          <button class="btn primary" id="receive">Receive into stock</button></div>`;

      view.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', (e) => {
        const w = work[+e.target.dataset.k], f = e.target.dataset.f;
        w[f] = f === 'note' ? e.target.value : Math.max(0, parseFloat(e.target.value) || 0);
        if (w.damaged > w.received) w.damaged = w.received;
        render();
      }));
      view.querySelector('#recv-date').onchange = (e) => { recvDate = e.target.value; render(); };
      view.querySelector('#cancel-po').onclick = async () => {
        if (await SR.confirmBox({ title: `Cancel PO #${o.number}?`, body: 'The order is removed. Nothing has been received from it.', ok: 'Cancel order', danger: true })) {
          SR.state.orders.splice(SR.state.orders.indexOf(o), 1); SR.save(); SR.toast(`PO #${o.number} canceled.`); location.hash = '#/orders';
        }
      };
      view.querySelector('#receive').onclick = async () => {
        if (flagged && !(await SR.confirmBox({ title: 'Receive with flagged prices?', body: `<p>${plural(flagged, 'line still has', 'lines still have')} an unusual price or unit. If the invoice really says this, go ahead. Otherwise fix the cost first.</p>`, ok: 'Receive anyway' }))) return;
        o.lines.forEach((l, k) => {
          const w = work[k];
          Object.assign(l, { received: w.received, damaged: w.damaged, cost: w.cost, note: w.note || (w.received < l.qty ? 'Short on delivery' : w.damaged ? 'Damaged on arrival' : '') });
          const accepted = Math.max(0, w.received - w.damaged);
          if (accepted > 0) SR.state.moves.push({ id: SR.uid('m_'), date: recvDate, itemId: l.itemId, type: 'receive', qty: accepted, unitCost: w.cost, ref: o.id });
          const it = SR.item(l.itemId);
          if (it.unit === l.unit && w.cost) it.cost = w.cost;
        });
        o.status = 'received'; o.receivedDate = recvDate; SR.save();
        SR.toast(`PO #${o.number} received into stock.`, 'good');
        SR.navigate();
      };
    }
    render();
  });
})();
