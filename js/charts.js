// Small SVG charts with hover tooltips and a table view. Colors come from CSS custom
// properties (--series-1..4), assigned to vendors in a fixed order.
window.SR = window.SR || {};
(() => {
  'use strict';

  const esc = (s) => SR.esc(s);
  let tip = null;

  function tooltip() {
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; document.body.appendChild(tip); }
    return tip;
  }
  function showTip(e, html) {
    const t = tooltip(); t.innerHTML = html; t.hidden = false;
    const pad = 12, w = t.offsetWidth, h = t.offsetHeight;
    let x = e.clientX + pad, y = e.clientY - h - pad;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    if (y < 8) y = e.clientY + pad;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  const hideTip = () => { if (tip) tip.hidden = true; };

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  const short = (v) => (v >= 1000 ? '$' + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : '$' + Math.round(v));

  // A bar path with a 4px rounded top and a square base on the baseline.
  function barPath(x, y, w, h, roundTop) {
    const r = roundTop ? Math.min(4, w / 2, h) : 0;
    return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''}V${y + h}Z`;
  }

  // series: [{ key, label, colorVar }], rows: [{ label, values: {key: number} }]
  function stackedBars(el, { series, rows, title }) {
    const W = 640, H = 240, m = { t: 12, r: 8, b: 28, l: 48 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const totals = rows.map((r) => series.reduce((s, se) => s + (r.values[se.key] || 0), 0));
    const max = niceMax(Math.max(...totals, 1));
    const band = iw / rows.length, bw = Math.min(56, band * 0.5);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
    for (let k = 0; k <= 4; k++) {
      const v = (max / 4) * k, y = m.t + ih - (v / max) * ih;
      svg += `<line class="grid${k === 0 ? ' base' : ''}" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`;
      svg += `<text class="tick" x="${m.l - 8}" y="${y + 4}" text-anchor="end">${short(v)}</text>`;
    }
    rows.forEach((r, i) => {
      const x = m.l + band * i + (band - bw) / 2;
      let y0 = m.t + ih;
      const present = series.filter((se) => (r.values[se.key] || 0) > 0);
      svg += `<rect class="hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" fill="transparent"
        data-tip="${esc(`<strong>${esc(r.label)}</strong>: ${SR.money(totals[i])}<br>` + present.map((se) => `${esc(se.label)}: ${SR.money(r.values[se.key])}`).join('<br>'))}"/>`;
      present.forEach((se, j) => {
        const v = r.values[se.key], h = (v / max) * ih;
        y0 -= h;
        svg += `<path class="seg" d="${barPath(x, y0, bw, h, j === present.length - 1)}" style="fill:var(${se.colorVar})"
          data-tip="${esc(`<strong>${esc(se.label)}</strong><br>${esc(r.label)}: ${SR.money(v)}`)}"/>`;
      });
      svg += `<text class="tick" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(r.label)}</text>`;
      svg += `<text class="val" x="${x + bw / 2}" y="${m.t + ih - (totals[i] / max) * ih - 6}" text-anchor="middle">${short(totals[i])}</text>`;
    });
    svg += '</svg>';

    const legend = `<ul class="legend">${series.map((se) => `<li><span class="key" style="background:var(${se.colorVar})"></span>${esc(se.label)}</li>`).join('')}</ul>`;
    const table = `<table class="data"><thead><tr><th>Month</th>${series.map((se) => `<th class="num">${esc(se.label)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>${
      rows.map((r, i) => `<tr><td>${esc(r.label)}</td>${series.map((se) => `<td class="num">${SR.money(r.values[se.key] || 0)}</td>`).join('')}<td class="num"><strong>${SR.money(totals[i])}</strong></td></tr>`).join('')}</tbody></table>`;

    el.innerHTML = `${legend}<div class="chart">${svg}</div>
      <details class="table-view"><summary>Show as table</summary>${table}</details>`;
    wire(el);
  }

  // Horizontal bars for one measure. rows: [{ label, value, colorVar? }]
  function hBars(el, { rows, title, format = SR.money }) {
    const max = Math.max(...rows.map((r) => r.value), 1);
    el.innerHTML = `<ul class="hbars" aria-label="${esc(title)}">${rows.map((r) => `
      <li data-tip="${esc(`<strong>${esc(r.label)}</strong>: ${format(r.value)}`)}">
        <span class="hb-label">${esc(r.label)}</span>
        <span class="hb-track"><span class="hb-bar" style="width:${Math.max(1, (r.value / max) * 100)}%;background:var(${r.colorVar || '--series-1'})"></span></span>
        <span class="hb-val">${format(r.value)}</span>
      </li>`).join('')}</ul>`;
    wire(el);
  }

  function wire(el) {
    el.querySelectorAll('[data-tip]').forEach((n) => {
      n.addEventListener('mousemove', (e) => showTip(e, n.dataset.tip));
      n.addEventListener('mouseleave', hideTip);
    });
  }

  SR.charts = { stackedBars, hBars, hideTip };
})();
