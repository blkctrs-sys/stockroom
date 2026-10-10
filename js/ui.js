// Shared UI helpers, the hash router, and app start-up.
window.SR = window.SR || {};
(() => {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const money = (n) => moneyFmt.format(n || 0);
  const qty = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const pct = (n) => (n * 100).toFixed(n >= 0.995 || n < 0.1 ? 0 : 1) + '%';
  const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + 's'}`;

  function fmtDate(iso, opts) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', opts || { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const monthLabel = (key, long) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: long ? 'long' : 'short', year: 'numeric' }); };

  // Vendors keep a fixed color slot in the order they were added (never by rank).
  function vendorColor(vendorId) {
    const i = SR.state.vendors.findIndex((v) => v.id === vendorId);
    return i >= 0 && i < 4 ? `--series-${i + 1}` : '--series-other';
  }

  function toast(msg, kind) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast ' + (kind || ''); t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 3800);
  }

  // Simple confirm dialog. Resolves true or false.
  function confirmBox({ title, body, ok = 'Confirm', danger }) {
    return new Promise((resolve) => {
      const dlg = document.getElementById('dialog');
      dlg.innerHTML = `<form method="dialog" class="dialog-body">
        <h2>${esc(title)}</h2><div class="dialog-text">${body}</div>
        <div class="row end"><button value="cancel" class="btn ghost">Cancel</button>
        <button value="ok" class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div></form>`;
      dlg.onclose = () => resolve(dlg.returnValue === 'ok');
      dlg.showModal();
    });
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

  // ---------- router ----------
  const routes = [];
  const route = (pattern, render) => routes.push({ pattern, render });

  function navigate() {
    SR.charts && SR.charts.hideTip();
    const hash = location.hash.replace(/^#/, '') || '/';
    const view = document.getElementById('view');
    for (const r of routes) {
      const m = hash.match(r.pattern);
      if (m) {
        document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', hash === a.getAttribute('href').slice(1) || (a.getAttribute('href') !== '#/' && hash.startsWith(a.getAttribute('href').slice(1)))));
        r.render(view, ...m.slice(1));
        view.focus({ preventScroll: true });
        window.scrollTo(0, 0);
        renderBanner();
        return;
      }
    }
    location.hash = '#/';
  }

  function renderBanner() {
    const b = document.getElementById('banner');
    b.hidden = !SR.state.demo;
    b.innerHTML = SR.state.demo ? 'You\'re looking at <strong>sample data</strong> for a made-up restaurant. Bring in your own on the <a href="#/data">Data</a> page.' : '';
  }

  function start() {
    if (!SR.load()) SR.replace(SR.buildDemo());
    window.addEventListener('hashchange', navigate);
    navigate();
  }

  Object.assign(SR, { esc, money, qty, pct, plural, fmtDate, monthLabel, vendorColor, toast, confirmBox, download, toCSV, route, navigate, start });
})();
