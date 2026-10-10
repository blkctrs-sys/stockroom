// Cycle counts, the item catalog, and the stock movement log.
(() => {
  'use strict';
  const { esc, money, qty, pct, plural, fmtDate } = SR;

  const scopeLabel = (s) => (s.type === 'all' ? 'All items' : s.type === 'vendor' ? (SR.vendor(s.value) || {}).name || 'Vendor' : s.value);
  const categories = () => [...new Set(SR.state.items.map((i) => i.category))].sort();

  // ---------- counts list ----------
  SR.route(/^\/counts$/, (view) => {
    const list = SR.state.counts.slice().sort((a, b) => b.date.localeCompare(a.date));
    const posted = list.filter((c) => c.status === 'posted');
    const avg = posted.length ? posted.slice(0, 6).reduce((s, c) => s + SR.countSummary(c).accuracy, 0) / Math.min(6, posted.length) : null;
    view.innerHTML = `
      <header class="page-head"><div><h1>Cycle counts</h1><p class="sub">Count part of the stockroom often instead of everything at once</p></div>
        <a class="btn primary" href="#/counts/new">Start a count</a></header>
      ${avg !== null ? `<p class="lede">Average accuracy over the last ${Math.min(6, posted.length)} counts: <strong>${pct(avg)}</strong> of lines matched the system exactly.</p>` : ''}
      <div class="card flush">${list.length ? `<table class="data clickable"><thead><tr><th>Count</th><th>Date</th><th>Scope</th><th class="num">Lines</th><th class="num">Accuracy</th><th class="num">Net variance</th><th>Status</th></tr></thead><tbody>
        ${list.map((c) => { const s = SR.countSummary(c); return `<tr data-href="#/counts/${c.id}"><td><a href="#/counts/${c.id}">#${c.number}</a></td><td>${fmtDate(c.date)}</td><td>${esc(scopeLabel(c.scope))}</td><td class="num">${s.lines}</td>
          <td class="num">${c.status === 'posted' ? pct(s.accuracy) : '—'}</td><td class="num ${s.varianceValue < 0 ? 'down' : ''}">${c.status === 'posted' ? money(s.varianceValue) : '—'}</td>
          <td>${c.status === 'posted' ? '<span class="status good">✓ Posted</span>' : '<span class="status warn">● In progress</span>'}</td></tr>`; }).join('')}
      </tbody></table>` : '<p class="empty pad">No counts yet. Start with one category; it takes a few minutes.</p>'}</div>`;
    view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.tagName !== 'A') location.hash = tr.dataset.href; }));
  });

  // ---------- new count ----------
  SR.route(/^\/counts\/new$/, (view) => {
    const st = SR.state;
    view.innerHTML = `
      <header class="page-head"><div><a class="back" href="#/counts">← Counts</a><h1>Start a count</h1></div></header>
      <form class="card narrow" id="f">
        <fieldset><legend>What are you counting?</legend>
          <label class="radio"><input type="radio" name="type" value="category" checked> One category
            <select name="category">${categories().map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
          <label class="radio"><input type="radio" name="type" value="vendor"> One vendor's items
            <select name="vendor">${st.vendors.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></label>
          <label class="radio"><input type="radio" name="type" value="all"> Everything (full inventory)</label>
        </fieldset>
        <label class="check-row"><input type="checkbox" name="blind" checked> <span><strong>Blind count</strong>: hide the expected quantities while counting, so counts aren't nudged toward what the system says.</span></label>
        <div class="row end"><button class="btn primary">Start counting</button></div>
      </form>`;
    view.querySelector('#f').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target), type = f.get('type');
      const scope = { type, value: type === 'category' ? f.get('category') : type === 'vendor' ? f.get('vendor') : '' };
      const items = st.items.filter((i) => type === 'all' || (type === 'category' ? i.category === scope.value : i.vendorId === scope.value))
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      if (!items.length) { SR.toast('No items in that group.', 'warn'); return; }
      const c = { id: SR.uid('c_'), number: 200 + st.counts.length + 1, date: SR.today(), scope, blind: !!f.get('blind'), status: 'draft',
        lines: items.map((i) => ({ itemId: i.id, expected: SR.onHand(i.id), counted: null, reason: '' })) };
      st.counts.push(c); SR.save();
      location.hash = '#/counts/' + c.id;
    };
  });

  // ---------- count sheet / review / posted ----------
  SR.route(/^\/counts\/(c_\w+)$/, (view, id) => {
    const c = SR.count(id);
    if (!c) { view.innerHTML = '<p class="empty">Count not found.</p>'; return; }
    let reviewing = c.status === 'posted';

    function render() {
      const s = SR.countSummary(c);
      const done = c.lines.filter((l) => l.counted !== null && l.counted !== '').length;
      const showExpected = !c.blind || reviewing;
      const head = `<header class="page-head"><div><a class="back" href="#/counts">← Counts</a><h1>Count #${c.number}</h1>
        <p class="sub">${esc(scopeLabel(c.scope))} · ${fmtDate(c.date)}${c.blind ? ' · blind' : ''}</p></div>
        ${c.status === 'posted' ? '<span class="status good big">✓ Posted</span>' : `<span class="muted">${done} of ${c.lines.length} counted</span>`}</header>`;

      if (c.status === 'posted' || reviewing) {
        const vars = c.lines.filter((l) => Math.abs((l.counted ?? l.expected) - l.expected) > 0.001);
        view.innerHTML = head + `
          <section class="tiles three">
            <div class="tile"><span class="t-label">Accuracy</span><span class="t-value">${pct(s.accuracy)}</span><span class="t-foot">${s.matched} of ${s.lines} lines matched</span></div>
            <div class="tile"><span class="t-label">Net variance</span><span class="t-value ${s.varianceValue < 0 ? 'down' : ''}">${money(s.varianceValue)}</span><span class="t-foot">${pct(s.expectedValue ? Math.abs(s.varianceValue) / s.expectedValue : 0)} of expected value</span></div>
            <div class="tile"><span class="t-label">Gross variance</span><span class="t-value">${money(s.absVarianceValue)}</span><span class="t-foot">Overs and shorts added together</span></div>
          </section>
          ${c.status !== 'posted' && vars.length ? '<div class="alert">Give each discrepancy a reason before posting. Reasons show up in the monthly report, so patterns (like unlogged waste) are easy to spot.</div>' : ''}
          <div class="card flush"><table class="data"><thead><tr><th>Item</th><th class="num">Expected</th><th class="num">Counted</th><th class="num">Variance</th><th class="num">Value</th><th>Reason</th></tr></thead><tbody>
          ${c.lines.map((l, k) => { const it = SR.item(l.itemId), d = SR.round2((l.counted ?? l.expected) - l.expected), off = Math.abs(d) > 0.001; return `<tr class="${off ? 'flag' : ''}">
            <td>${esc(it.name)} <span class="muted small">${esc(it.unit)}</span></td><td class="num">${qty(l.expected)}</td><td class="num">${qty(l.counted ?? l.expected)}</td>
            <td class="num ${d < 0 ? 'down' : d > 0 ? 'up' : ''}">${off ? (d > 0 ? '+' : '') + qty(d) : '✓'}</td><td class="num">${off ? money(d * (it.cost || 0)) : ''}</td>
            <td>${off ? (c.status === 'posted' ? esc(l.reason) : `<select data-r="${k}"><option value="">Choose a reason…</option>${SR.COUNT_REASONS.map((r) => `<option ${r === l.reason ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`) : ''}</td></tr>`; }).join('')}
          </tbody></table></div>
          ${c.status !== 'posted' ? `<div class="row end top-gap"><button class="btn ghost" id="back">Back to counting</button><button class="btn primary" id="post">Post count</button></div>` : ''}`;
        view.querySelectorAll('[data-r]').forEach((sel) => sel.onchange = () => { c.lines[+sel.dataset.r].reason = sel.value; SR.save(); });
        const back = view.querySelector('#back'); if (back) back.onclick = () => { reviewing = false; render(); };
        const post = view.querySelector('#post');
        if (post) post.onclick = async () => {
          const missing = vars.filter((l) => !l.reason).length;
          if (missing && !(await SR.confirmBox({ title: 'Post without reasons?', body: `<p>${plural(missing, 'discrepancy has', 'discrepancies have')} no reason yet.</p>`, ok: 'Post anyway' }))) return;
          for (const l of c.lines) {
            const d = SR.round2((l.counted ?? l.expected) - l.expected);
            if (d) SR.state.moves.push({ id: SR.uid('m_'), date: c.date, itemId: l.itemId, type: 'adjust', qty: d, ref: c.id, note: `Count #${c.number}${l.reason ? ': ' + l.reason : ''}` });
          }
          c.status = 'posted'; c.postedDate = SR.today(); SR.save();
          SR.toast(`Count #${c.number} posted. Stock levels updated.`, 'good'); render();
        };
        return;
      }

      // counting sheet
      let cat = '';
      view.innerHTML = head + `
        <div class="card flush"><table class="data count-sheet"><thead><tr><th>Item</th><th>Unit</th>${showExpected ? '<th class="num">Expected</th>' : ''}<th class="num">Counted</th></tr></thead><tbody>
        ${c.lines.map((l, k) => { const it = SR.item(l.itemId); const h = it.category !== cat ? `<tr class="group"><td colspan="${showExpected ? 4 : 3}">${esc(cat = it.category)}</td></tr>` : ''; return h + `<tr>
          <td>${esc(it.name)}</td><td class="muted">${esc(it.unit)}</td>${showExpected ? `<td class="num">${qty(l.expected)}</td>` : ''}
          <td class="num"><input class="num-in" type="number" min="0" step="any" inputmode="decimal" data-k="${k}" value="${l.counted ?? ''}" aria-label="Counted ${esc(it.name)}"></td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="row end top-gap"><button class="btn ghost danger-text" id="discard">Discard</button><button class="btn primary" id="review">Review variances</button></div>`;
      view.querySelectorAll('[data-k]').forEach((inp) => {
        inp.addEventListener('change', () => { c.lines[+inp.dataset.k].counted = inp.value === '' ? null : parseFloat(inp.value); SR.save(); });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const nx = view.querySelector(`[data-k="${+inp.dataset.k + 1}"]`); (nx || view.querySelector('#review')).focus(); } });
      });
      view.querySelector('#discard').onclick = async () => {
        if (await SR.confirmBox({ title: 'Discard this count?', body: '<p>Nothing has been posted, so stock levels won\'t change.</p>', ok: 'Discard', danger: true })) {
          SR.state.counts.splice(SR.state.counts.indexOf(c), 1); SR.save(); location.hash = '#/counts';
        }
      };
      view.querySelector('#review').onclick = async () => {
        const blank = c.lines.filter((l) => l.counted === null).length;
        if (blank && !(await SR.confirmBox({ title: 'Some items aren\'t counted', body: `<p>${plural(blank, 'item is', 'items are')} blank. Blank items are treated as matching the system.</p>`, ok: 'Review anyway' }))) return;
        reviewing = true; render();
      };
    }
    render();
  });

  // ---------- items ----------
  SR.route(/^\/items$/, (view) => {
    const st = SR.state;
    let q = '', cat = '';
    function render() {
      const list = st.items.filter((i) => (!cat || i.category === cat) && (!q || i.name.toLowerCase().includes(q))).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      const tbody = list.map((i) => { const oh = SR.onHand(i.id), low = i.par > 0 && oh < i.par * 0.5; return `<tr data-href="#/items/${i.id}">
        <td><a href="#/items/${i.id}">${esc(i.name)}</a></td><td>${esc(i.category)}</td><td><span class="dot" style="background:var(${SR.vendorColor(i.vendorId)})"></span>${esc((SR.vendor(i.vendorId) || {}).name)}</td>
        <td class="num">${qty(oh)} <span class="muted small">${esc(i.unit)}</span></td><td class="num">${qty(i.par)}</td>
        <td>${low ? '<span class="status serious">● Low</span>' : oh < i.par ? '<span class="status warn">● Below par</span>' : '<span class="status good">✓ OK</span>'}</td>
        <td class="num">${money(i.cost)}</td><td class="num">${money(Math.max(0, oh) * (i.cost || 0))}</td></tr>`; }).join('');
      view.querySelector('#rows').innerHTML = tbody || '<tr><td colspan="8" class="empty">No matching items.</td></tr>';
      view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.tagName !== 'A') location.hash = tr.dataset.href; }));
    }
    view.innerHTML = `
      <header class="page-head"><div><h1>Items</h1><p class="sub">${plural(st.items.length, 'item')} · ${money(SR.inventoryValue())} on hand</p></div>
        <a class="btn primary" href="#/items/new">Add item</a></header>
      <div class="row wrap gap-s bottom-gap"><input type="search" id="q" placeholder="Search items" aria-label="Search items">
        <select id="cat" aria-label="Category"><option value="">All categories</option>${categories().map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="card flush"><table class="data clickable"><thead><tr><th>Item</th><th>Category</th><th>Vendor</th><th class="num">On hand</th><th class="num">Par</th><th>Status</th><th class="num">Cost</th><th class="num">Value</th></tr></thead><tbody id="rows"></tbody></table></div>`;
    view.querySelector('#q').oninput = (e) => { q = e.target.value.toLowerCase(); render(); };
    view.querySelector('#cat').onchange = (e) => { cat = e.target.value; render(); };
    render();
  });

  function itemForm(it) {
    const st = SR.state;
    return `<form class="card narrow" id="item-form">
      <div class="form-grid two">
        <label>Name<input name="name" required value="${esc(it.name || '')}"></label>
        <label>Category<input name="category" required list="cats" value="${esc(it.category || '')}"><datalist id="cats">${categories().map((c) => `<option>${esc(c)}</option>`).join('')}</datalist></label>
        <label>Vendor<input name="vendor" required list="vends" value="${esc((SR.vendor(it.vendorId) || {}).name || '')}"><datalist id="vends">${st.vendors.map((v) => `<option>${esc(v.name)}</option>`).join('')}</datalist></label>
        <label>Unit<input name="unit" required placeholder="case, lb, each…" value="${esc(it.unit || '')}"></label>
        <label>Par level<input name="par" type="number" min="0" step="any" value="${it.par ?? ''}"></label>
        <label>Current cost<input name="cost" type="number" min="0" step="0.01" value="${it.cost ?? ''}"></label>
      </div>
      <div class="row end top-gap">${it.id ? '<button type="button" class="btn ghost danger-text" id="del">Delete item</button>' : ''}<button class="btn primary">${it.id ? 'Save changes' : 'Add item'}</button></div>
    </form>`;
  }
  function bindItemForm(view, it) {
    view.querySelector('#item-form').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target), st = SR.state;
      const vname = f.get('vendor').trim();
      let v = st.vendors.find((x) => x.name.toLowerCase() === vname.toLowerCase());
      if (!v) { v = { id: SR.uid('v_'), name: vname, days: [] }; st.vendors.push(v); }
      const data = { name: f.get('name').trim(), category: f.get('category').trim(), vendorId: v.id, unit: f.get('unit').trim(), par: parseFloat(f.get('par')) || 0, cost: parseFloat(f.get('cost')) || 0 };
      if (it.id) Object.assign(it, data); else { it = { id: SR.uid('i_'), ...data }; st.items.push(it); }
      SR.save(); SR.toast('Saved.', 'good'); location.hash = '#/items/' + it.id;
    };
    const del = view.querySelector('#del');
    if (del) del.onclick = async () => {
      if (await SR.confirmBox({ title: `Delete ${esc(it.name)}?`, body: '<p>Its stock history stays in old orders and counts, but the item leaves the catalog.</p>', ok: 'Delete', danger: true })) {
        const st = SR.state; st.items.splice(st.items.indexOf(it), 1); st.moves = st.moves.filter((m) => m.itemId !== it.id); SR.save(); location.hash = '#/items';
      }
    };
  }

  SR.route(/^\/items\/new$/, (view) => {
    view.innerHTML = `<header class="page-head"><div><a class="back" href="#/items">← Items</a><h1>Add item</h1></div></header>` + itemForm({});
    bindItemForm(view, {});
  });

  SR.route(/^\/items\/(i_\w+)$/, (view, id) => {
    const it = SR.item(id);
    if (!it) { view.innerHTML = '<p class="empty">Item not found.</p>'; return; }
    const oh = SR.onHand(id), hist = SR.priceHistory(id).slice().reverse();
    const moves = SR.state.moves.filter((m) => m.itemId === id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
    view.innerHTML = `
      <header class="page-head"><div><a class="back" href="#/items">← Items</a><h1>${esc(it.name)}</h1><p class="sub">${esc(it.category)} · ${esc((SR.vendor(it.vendorId) || {}).name)} · by the ${esc(it.unit)}</p></div></header>
      <section class="tiles">
        <div class="tile"><span class="t-label">On hand</span><span class="t-value">${qty(oh)}</span><span class="t-foot">${esc(it.unit)} · par ${qty(it.par)}</span></div>
        <div class="tile"><span class="t-label">Value</span><span class="t-value">${money(Math.max(0, oh) * (it.cost || 0))}</span><span class="t-foot">at ${money(it.cost)} per ${esc(it.unit)}</span></div>
        <div class="tile"><span class="t-label">Times ordered</span><span class="t-value">${hist.length}</span><span class="t-foot">${hist[0] ? 'Last ' + fmtDate(hist[0].date, { month: 'short', day: 'numeric' }) : 'Never'}</span></div>
      </section>
      <section class="grid-2">
        <div class="card"><h2>Price history</h2>${hist.length ? `<table class="data compact"><thead><tr><th>Date</th><th>Unit</th><th class="num">Cost</th><th class="num">Change</th></tr></thead><tbody>
          ${hist.slice(0, 15).map((h, k) => { const prev = hist.slice(k + 1).find((p) => p.unit === h.unit); const ch = prev ? (h.cost - prev.cost) / prev.cost : 0;
            return `<tr><td>${fmtDate(h.date, { month: 'short', day: 'numeric' })}</td><td>${esc(h.unit)}</td><td class="num">${money(h.cost)}</td><td class="num ${ch > 0 ? 'up' : ch < 0 ? 'down' : ''}">${prev && Math.abs(ch) > 0.004 ? (ch > 0 ? '▲ ' : '▼ ') + pct(Math.abs(ch)) : prev && h.unit !== prev.unit ? 'unit change' : ''}</td></tr>`; }).join('')}
          </tbody></table>` : '<p class="empty">Not ordered yet.</p>'}</div>
        <div class="card"><h2>Stock movements</h2>${moves.length ? `<table class="data compact"><thead><tr><th>Date</th><th>Type</th><th class="num">Qty</th><th>Note</th></tr></thead><tbody>
          ${moves.map((m) => { const s = m.qty * SR.MOVE_TYPES[m.type].sign; return `<tr><td>${fmtDate(m.date, { month: 'short', day: 'numeric' })}</td><td>${esc(SR.MOVE_TYPES[m.type].label)}</td><td class="num ${s < 0 ? 'down' : 'up'}">${s > 0 ? '+' : ''}${qty(s)}</td><td class="muted small">${esc(m.note || '')}</td></tr>`; }).join('')}
          </tbody></table>` : '<p class="empty">No movements yet.</p>'}</div>
      </section>
      <h2 class="section-title">Edit item</h2>${itemForm(it)}`;
    bindItemForm(view, it);
  });

  // ---------- stock log ----------
  SR.route(/^\/log$/, (view) => {
    const st = SR.state;
    let type = '';
    const types = ['waste', 'transfer_out', 'transfer_in', 'return', 'usage'];
    function rows() {
      return st.moves.filter((m) => (type ? m.type === type : m.type !== 'usage')).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80)
        .map((m) => { const it = SR.item(m.itemId); if (!it) return ''; const s = m.qty * SR.MOVE_TYPES[m.type].sign; return `<tr><td>${fmtDate(m.date)}</td><td>${esc(SR.MOVE_TYPES[m.type].label)}</td><td><a href="#/items/${it.id}">${esc(it.name)}</a></td>
          <td class="num ${s < 0 ? 'down' : 'up'}">${s > 0 ? '+' : ''}${qty(s)} <span class="muted small">${esc(it.unit)}</span></td><td class="num">${money(Math.abs(s) * (m.unitCost || it.cost || 0))}</td><td class="muted small">${esc(m.note || '')}</td></tr>`; }).join('');
    }
    view.innerHTML = `
      <header class="page-head"><div><h1>Stock log</h1><p class="sub">Record anything that moves stock outside of orders and counts</p></div></header>
      <form class="card" id="f">
        <div class="form-grid four">
          <label>What happened<select name="type">${types.map((t) => `<option value="${t}">${esc(SR.MOVE_TYPES[t].label)}</option>`).join('')}</select></label>
          <label>Item<select name="item">${st.items.slice().sort((a, b) => a.name.localeCompare(b.name)).map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join('')}</select></label>
          <label>Quantity<input name="qty" type="number" min="0" step="any" required></label>
          <label>Date<input name="date" type="date" value="${SR.today()}" required></label>
        </div>
        <label class="top-gap">Note<input name="note" placeholder="e.g. Dropped case, sent to the other location, wrong item returned"></label>
        <div class="row end top-gap"><button class="btn primary">Record</button></div>
      </form>
      <div class="row wrap gap-s top-gap bottom-gap"><h2 class="grow">Recent activity</h2>
        <select id="type" aria-label="Filter"><option value="">Everything except daily usage</option>${types.map((t) => `<option value="${t}">${esc(SR.MOVE_TYPES[t].label)}</option>`).join('')}<option value="adjust">Count adjustments</option><option value="receive">Received</option></select></div>
      <div class="card flush"><table class="data"><thead><tr><th>Date</th><th>Type</th><th>Item</th><th class="num">Qty</th><th class="num">Value</th><th>Note</th></tr></thead><tbody id="rows">${rows()}</tbody></table></div>`;
    view.querySelector('#type').onchange = (e) => { type = e.target.value; view.querySelector('#rows').innerHTML = rows(); };
    view.querySelector('#f').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target), q = parseFloat(f.get('qty'));
      if (!(q > 0)) return;
      const it = SR.item(f.get('item'));
      st.moves.push({ id: SR.uid('m_'), date: f.get('date'), itemId: it.id, type: f.get('type'), qty: q, unitCost: it.cost, note: f.get('note').trim() });
      SR.save(); SR.toast(`Recorded: ${SR.MOVE_TYPES[f.get('type')].label.toLowerCase()}, ${qty(q)} ${it.unit} ${it.name}.`, 'good');
      e.target.reset(); view.querySelector('[name=date]').value = SR.today(); view.querySelector('#rows').innerHTML = rows();
    };
  });
})();
