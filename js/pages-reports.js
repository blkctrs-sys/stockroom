// Monthly report and the data page (import, backup, reset).
(() => {
  'use strict';
  const { esc, money, qty, pct, plural, fmtDate, monthLabel } = SR;

  function monthsWithData() {
    const set = new Set(SR.state.orders.filter((o) => o.status === 'received').map((o) => SR.monthKey(o.receivedDate)));
    set.add(SR.monthKey(SR.today()));
    return [...set].sort().reverse();
  }

  // ---------- monthly report ----------
  SR.route(/^\/reports(?:\?(\d{4}-\d{2}))?$/, (view, mk) => {
    const st = SR.state, months = monthsWithData();
    mk = mk || months[1] || months[0]; // default to the last full month
    const inMonth = (iso) => iso && SR.monthKey(iso) === mk;
    const orders = st.orders.filter((o) => o.status === 'received' && inMonth(o.receivedDate));
    const spend = orders.reduce((s, o) => s + SR.receivedTotal(o), 0);

    const byVendor = {}, byCat = {}, byItem = {};
    let ordUnits = 0, gotUnits = 0;
    const issues = [];
    for (const o of orders) for (const l of o.lines) {
      const it = SR.item(l.itemId); if (!it) continue;
      const amt = Math.max(0, l.received - l.damaged) * l.cost;
      byVendor[o.vendorId] = (byVendor[o.vendorId] || 0) + amt;
      byCat[it.category] = (byCat[it.category] || 0) + amt;
      byItem[it.id] = (byItem[it.id] || 0) + amt;
      ordUnits += l.qty; gotUnits += Math.max(0, l.received - l.damaged);
      if (l.received < l.qty || l.damaged) issues.push({ o, l, it });
    }
    const moves = st.moves.filter((m) => inMonth(m.date));
    const costOf = (m) => { const it = SR.item(m.itemId); return m.qty * (m.unitCost || (it && it.cost) || 0); };
    const waste = moves.filter((m) => m.type === 'waste').reduce((s, m) => s + costOf(m), 0);
    const counts = st.counts.filter((c) => c.status === 'posted' && inMonth(c.date));
    const reasons = {};
    let netVar = 0;
    for (const c of counts) for (const l of c.lines) {
      const it = SR.item(l.itemId); if (!it) continue;
      const d = (l.counted ?? l.expected) - l.expected; if (Math.abs(d) < 0.001) continue;
      const v = d * (it.cost || 0); netVar += v;
      const r = l.reason || 'No reason given';
      reasons[r] = reasons[r] || { n: 0, v: 0 }; reasons[r].n++; reasons[r].v += v;
    }
    const avgAcc = counts.length ? counts.reduce((s, c) => s + SR.countSummary(c).accuracy, 0) / counts.length : null;
    const topItems = Object.entries(byItem).sort((a, b) => b[1] - a[1]).slice(0, 10);

    view.innerHTML = `
      <header class="page-head"><div><h1>Monthly report</h1><p class="sub">${monthLabel(mk, true)}</p></div>
        <div class="row no-print"><select id="month" aria-label="Month">${months.map((m) => `<option value="${m}" ${m === mk ? 'selected' : ''}>${monthLabel(m, true)}</option>`).join('')}</select>
          <button class="btn" id="csv">Export CSV</button><button class="btn primary" id="print">Print / PDF</button></div></header>

      <section class="tiles">
        <div class="tile"><span class="t-label">Purchases received</span><span class="t-value">${money(spend)}</span><span class="t-foot">${plural(orders.length, 'delivery', 'deliveries')}</span></div>
        <div class="tile"><span class="t-label">Vendor fill rate</span><span class="t-value">${ordUnits ? pct(gotUnits / ordUnits) : '—'}</span><span class="t-foot">${plural(issues.length, 'short or damaged line')}</span></div>
        <div class="tile"><span class="t-label">Logged waste</span><span class="t-value">${money(waste)}</span><span class="t-foot">${spend ? pct(waste / spend) + ' of purchases' : ''}</span></div>
        <div class="tile"><span class="t-label">Count variance</span><span class="t-value ${netVar < 0 ? 'down' : ''}">${money(netVar)}</span><span class="t-foot">${counts.length ? `${plural(counts.length, 'count')} · ${pct(avgAcc)} avg accuracy` : 'No counts this month'}</span></div>
      </section>

      <section class="grid-2">
        <div class="card"><h2>Spend by vendor</h2><div id="by-vendor"></div></div>
        <div class="card"><h2>Spend by category</h2><div id="by-cat"></div></div>
        <div class="card"><h2>Top 10 items by spend</h2>${topItems.length ? `<table class="data compact"><tbody>${topItems.map(([id, v]) => `<tr><td><a href="#/items/${id}">${esc(SR.item(id).name)}</a></td><td class="num">${money(v)}</td><td class="num muted">${pct(v / spend)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No purchases this month.</p>'}</div>
        <div class="card"><h2>Count discrepancies by reason</h2>${Object.keys(reasons).length ? `<table class="data compact"><thead><tr><th>Reason</th><th class="num">Lines</th><th class="num">Value</th></tr></thead><tbody>${Object.entries(reasons).sort((a, b) => a[1].v - b[1].v).map(([r, x]) => `<tr><td>${esc(r)}</td><td class="num">${x.n}</td><td class="num ${x.v < 0 ? 'down' : ''}">${money(x.v)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No discrepancies this month.</p>'}</div>
        <div class="card span-2"><h2>Receiving issues</h2>${issues.length ? `<table class="data compact"><thead><tr><th>Date</th><th>Vendor</th><th>Item</th><th class="num">Ordered</th><th class="num">Accepted</th><th class="num">Value missing</th><th>Note</th></tr></thead><tbody>
          ${issues.map(({ o, l, it }) => `<tr><td>${fmtDate(o.receivedDate, { month: 'short', day: 'numeric' })}</td><td>${esc(SR.vendor(o.vendorId).name)}</td><td>${esc(it.name)}</td><td class="num">${qty(l.qty)}</td><td class="num">${qty(Math.max(0, l.received - l.damaged))}</td><td class="num down">${money((l.qty - Math.max(0, l.received - l.damaged)) * l.cost)}</td><td class="muted small">${esc(l.note)}</td></tr>`).join('')}
          </tbody></table><p class="muted small">Use this list to follow up on vendor credits.</p>` : '<p class="empty">Every delivery came in complete.</p>'}</div>
      </section>`;

    SR.charts.hBars(view.querySelector('#by-vendor'), { title: 'Spend by vendor', rows: st.vendors.filter((v) => byVendor[v.id]).map((v) => ({ label: v.name, value: byVendor[v.id], colorVar: SR.vendorColor(v.id) })) });
    SR.charts.hBars(view.querySelector('#by-cat'), { title: 'Spend by category', rows: Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v })) });
    view.querySelector('#month').onchange = (e) => { location.hash = '#/reports?' + e.target.value; };
    view.querySelector('#print').onclick = () => window.print();
    view.querySelector('#csv').onclick = () => {
      const rows = [['Received', 'PO', 'Vendor', 'Item', 'Category', 'Unit', 'Ordered', 'Received', 'Damaged', 'Cost each', 'Accepted total', 'Note']];
      for (const o of orders) for (const l of o.lines) { const it = SR.item(l.itemId); if (it) rows.push([o.receivedDate, o.number, SR.vendor(o.vendorId).name, it.name, it.category, l.unit, l.qty, l.received, l.damaged, l.cost, SR.round2(Math.max(0, l.received - l.damaged) * l.cost), l.note]); }
      SR.download(`stockroom-purchases-${mk}.csv`, SR.toCSV(rows), 'text/csv');
    };
  });

  // ---------- data ----------
  SR.route(/^\/data$/, (view) => {
    const st = SR.state, now = new Date();
    let pending = null;
    view.innerHTML = `
      <header class="page-head"><div><h1>Data</h1><p class="sub">Your data is stored only in this browser on this device. Nothing is uploaded anywhere.</p></div></header>

      <section class="card">
        <h2>Import from a Google Sheets ordering sheet</h2>
        <p>In Google Sheets, open the month's tab and choose <strong>File → Download → Comma-separated values (.csv)</strong>. Pick that file here. Row 1 should have the delivery days (13th, 16th…), row 2 the column labels (Quantity, Cost Each…), and column B the vendors and items.</p>
        <div class="form-grid three">
          <label>CSV file<input type="file" id="file" accept=".csv,text/csv"></label>
          <label>Month<select id="im-month">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i === now.getMonth() ? 'selected' : ''}>${new Date(2000, i, 1).toLocaleDateString('en-US', { month: 'long' })}</option>`).join('')}</select></label>
          <label>Year<input type="number" id="im-year" value="${now.getFullYear()}" min="2000" max="2100"></label>
        </div>
        <div id="preview"></div>
      </section>

      <section class="card">
        <h2>Backup</h2>
        <p>Save everything to a file, or restore from one. Use this to move your data to another device.</p>
        <div class="row wrap gap-s"><button class="btn" id="export">Download backup</button>
          <label class="btn file-btn">Restore from backup<input type="file" id="restore" accept=".json,application/json" hidden></label></div>
      </section>

      <section class="card">
        <h2>Start over</h2>
        <p>${st.demo ? 'You\'re using sample data.' : 'You\'re using your own data.'} ${plural(st.items.length, 'item')}, ${plural(st.orders.length, 'order')}, ${plural(st.counts.length, 'count')}.</p>
        <div class="row wrap gap-s"><button class="btn" id="demo">Load sample data</button><button class="btn danger" id="clear">Start empty</button></div>
      </section>`;

    const fileIn = view.querySelector('#file'), prevEl = view.querySelector('#preview');
    function runPreview() {
      const f = fileIn.files[0]; if (!f) return;
      f.text().then((text) => {
        try {
          pending = SR.importer.preview(text, +view.querySelector('#im-year').value, +view.querySelector('#im-month').value);
          const total = pending.lines.reduce((s, l) => s + l.qty * l.cost, 0);
          prevEl.innerHTML = `<div class="preview">
            <p><strong>Found ${plural(pending.orders.length, 'delivery', 'deliveries')}</strong> from ${plural(new Set(pending.orders.map((o) => o.vendorName)).size, 'vendor')}: ${plural(pending.lines.length, 'line')}, ${plural(pending.items.length, 'item')}, ${money(total)} total.</p>
            ${pending.flags.length ? `<div class="alert serious"><strong>⚠ ${plural(pending.flags.length, 'line looks', 'lines look')} off.</strong> Check these against your invoices:<ul>${pending.flags.map((x) => `<li>${fmtDate(x.date, { month: 'short', day: 'numeric' })} · ${esc(x.name)}: ${esc(x.note)}</li>`).join('')}</ul></div>` : '<p class="status good">✓ No unusual prices found.</p>'}
            ${pending.unitMixes.length ? `<div class="alert"><strong>Mixed units:</strong> these items were bought in different units, so their prices won't be compared to each other: ${pending.unitMixes.map((u) => `${esc(u.name)} (${u.units.map(esc).join(', ')})`).join('; ')}.</div>` : ''}
            <p class="muted small">Imported deliveries count toward spending and price history. They don't change on-hand stock. Run a cycle count to set that.</p>
            <div class="row gap-s">${st.demo ? '<label class="check-row"><input type="checkbox" id="replace-demo" checked> <span>Remove the sample data first</span></label>' : ''}<button class="btn primary" id="do-import">Import</button></div></div>`;
          view.querySelector('#do-import').onclick = () => {
            const rep = view.querySelector('#replace-demo');
            if (rep && rep.checked) SR.replace(SR.empty());
            SR.importer.apply(pending);
            SR.toast(`Imported ${plural(pending.orders.length, 'delivery', 'deliveries')}.`, 'good');
            location.hash = '#/reports?' + pending.orders[0].date.slice(0, 7);
          };
        } catch (err) { prevEl.innerHTML = `<div class="alert serious">${esc(err.message)}</div>`; }
      });
    }
    fileIn.onchange = runPreview;
    view.querySelector('#im-month').onchange = runPreview;
    view.querySelector('#im-year').onchange = runPreview;

    view.querySelector('#export').onclick = () => SR.download(`stockroom-backup-${SR.today()}.json`, JSON.stringify(SR.state, null, 1), 'application/json');
    view.querySelector('#restore').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then(async (t) => {
        try {
          const data = JSON.parse(t);
          if (!data || !Array.isArray(data.items) || !Array.isArray(data.orders)) throw new Error('bad');
          if (await SR.confirmBox({ title: 'Restore this backup?', body: '<p>It replaces everything currently in Stockroom on this device.</p>', ok: 'Restore', danger: true })) {
            SR.replace(data); SR.toast('Backup restored.', 'good'); location.hash = '#/';
          }
        } catch { SR.toast('That file isn\'t a Stockroom backup.', 'warn'); }
      });
    };
    view.querySelector('#demo').onclick = async () => {
      if (await SR.confirmBox({ title: 'Load sample data?', body: '<p>This replaces everything on this device with the sample restaurant. Download a backup first if you want to keep your data.</p>', ok: 'Load sample data', danger: !st.demo })) {
        SR.replace(SR.buildDemo()); SR.toast('Sample data loaded.'); location.hash = '#/';
      }
    };
    view.querySelector('#clear').onclick = async () => {
      if (await SR.confirmBox({ title: 'Start with an empty Stockroom?', body: '<p>All items, orders and counts on this device are removed. Download a backup first if you want to keep them.</p>', ok: 'Start empty', danger: true })) {
        SR.replace(SR.empty()); SR.toast('Stockroom is empty. Add items or import a sheet.'); location.hash = '#/data';
      }
    };
  });
})();
