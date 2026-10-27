/* ==========================================================================
   Protocol Lab - tiny canvas chart library
   No external libraries, so the project works offline. Supports line, step
   and scatter series, shaded bands, reference lines, a hover crosshair with a
   tooltip, a clickable legend and a "view as table" fallback for accessibility.

   Usage:
     const chart = new CN.Chart(hostDiv, { height: 280 });
     chart.set({ xLabel:'Round', yLabel:'cwnd (MSS)',
                 series:[{ name:'Tahoe', color:'s1', type:'step', points:[[0,1],[1,2]] }] });
   ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  const CN = root.CN;
  const h = CN.h;

  function niceTicks(min, max, target) {
    if (!(max > min)) { max = min + 1; }
    const span = max - min;
    const raw = span / Math.max(2, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const start = Math.ceil(min / step - 1e-9) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { ticks, step };
  }

  function defaultFmt(v) {
    if (!Number.isFinite(v)) return '-';
    const a = Math.abs(v);
    if (a >= 1000) return String(Math.round(v));
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return String(parseFloat(v.toFixed(1)));
    if (a >= 1) return String(parseFloat(v.toFixed(2)));
    return String(parseFloat(v.toFixed(3)));
  }

  function resolveColor(c) {
    if (!c) return CN.cssVar('--ink');
    if (/^s[1-8]$/.test(c)) return CN.cssVar('--' + c);
    if (/^(ink|ink-2|ink-3|good|warn|bad|info|accent|rule|rule-strong)$/.test(c)) return CN.cssVar('--' + c);
    return c;
  }

  function withAlpha(color, alpha) {
    // color is #rrggbb or rgb(); draw translucent fills by using globalAlpha instead when unsure
    const m = /^#([0-9a-f]{6})$/i.exec(color);
    if (!m) return color;
    const n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  CN.Chart = function (host, options) {
    const opts = Object.assign({ height: 280 }, options);
    let cfg = { series: [] };
    const canvas = h('canvas', { role: 'img', 'aria-label': opts.label || 'chart' });
    const tip = h('div', { class: 'chart-tip', style: 'display:none' });
    const legend = h('div', { class: 'legend' });
    const tableBox = h('details', { class: 'chart-table' }, h('summary', null, 'View data as a table'));
    const wrap = h('div', { class: 'chart' }, canvas, tip);
    host.appendChild(wrap);
    host.appendChild(legend);
    host.appendChild(tableBox);

    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    let plot = null; // geometry of the last draw
    let hover = null;
    const hidden = new Set();

    /* ---------- geometry helpers ---------- */
    function visibleSeries() {
      return cfg.series.filter((s) => !hidden.has(s.name) && s.points && s.points.length);
    }

    function extents(list) {
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      list.forEach((s) => s.points.forEach((p) => {
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
        if (p[0] < xmin) xmin = p[0];
        if (p[0] > xmax) xmax = p[0];
        if (p[1] < ymin) ymin = p[1];
        if (p[1] > ymax) ymax = p[1];
      }));
      (cfg.hlines || []).forEach((l) => { if (l.y < ymin) ymin = l.y; if (l.y > ymax) ymax = l.y; });
      if (!Number.isFinite(xmin)) { xmin = 0; xmax = 1; ymin = 0; ymax = 1; }
      return { xmin, xmax, ymin, ymax };
    }

    /* ---------- drawing ---------- */
    function draw() {
      if (!ctx || !host.isConnected) return;
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(280, host.clientWidth || 600);
      const H = cfg.height || opts.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const ink = CN.cssVar('--ink');
      const ink2 = CN.cssVar('--ink-2');
      const ink3 = CN.cssVar('--ink-3');
      const rule = CN.cssVar('--rule');
      const ruleStrong = CN.cssVar('--rule-strong');
      const surface = CN.cssVar('--surface');
      const font = '12px "Chivo", system-ui, sans-serif';

      const list = visibleSeries();
      const ex = extents(list);
      let xmin = cfg.xMin !== undefined ? cfg.xMin : ex.xmin;
      let xmax = cfg.xMax !== undefined ? cfg.xMax : ex.xmax;
      let ymin = cfg.yMin !== undefined ? cfg.yMin : (cfg.yZero === false ? ex.ymin : Math.min(0, ex.ymin));
      let ymax = cfg.yMax !== undefined ? cfg.yMax : ex.ymax;
      if (xmax === xmin) xmax = xmin + 1;
      if (ymax === ymin) ymax = ymin + 1;
      const yt0 = niceTicks(ymin, ymax, 5);
      if (cfg.yMax === undefined) ymax = Math.max(ymax, yt0.ticks[yt0.ticks.length - 1] || ymax);
      if (cfg.yMax === undefined && ymax - ex.ymax < (ymax - ymin) * 0.04) ymax += (ymax - ymin) * 0.05;
      const yt = niceTicks(ymin, ymax, 5);
      const xt = cfg.xTicks ? { ticks: cfg.xTicks } : niceTicks(xmin, xmax, Math.max(3, Math.floor(W / 90)));

      const xf = cfg.xFormat || defaultFmt;
      const yf = cfg.yFormat || defaultFmt;

      ctx.font = font;
      const yLabelW = Math.max(...yt.ticks.map((t) => ctx.measureText(yf(t)).width), 10);

      // direct labels at line ends (only when 2..4 series, as recommended for readability)
      const useDirect = list.length >= 2 && list.length <= 4 && cfg.directLabels !== false && W > 520 && !list.some((s) => s.noLegend);
      const directW = useDirect ? Math.min(130, Math.max(...list.map((s) => ctx.measureText(s.name).width)) + 14) : 0;

      const m = {
        l: Math.round(yLabelW + 20 + (cfg.yLabel ? 16 : 0)),
        r: 14 + directW,
        t: 14,
        b: 26 + (cfg.xLabel ? 18 : 0),
      };
      const pw = W - m.l - m.r;
      const ph = H - m.t - m.b;
      const X = (x) => m.l + ((x - xmin) / (xmax - xmin)) * pw;
      const Y = (y) => m.t + ph - ((y - ymin) / (ymax - ymin)) * ph;
      plot = { m, pw, ph, W, H, X, Y, xmin, xmax, ymin, ymax, xf, yf, list };

      // bands (for example the slow-start / congestion-avoidance phases)
      (cfg.bands || []).forEach((b) => {
        const x0 = Math.max(xmin, b.x0);
        const x1 = Math.min(xmax, b.x1);
        if (x1 <= x0) return;
        ctx.fillStyle = withAlpha(resolveColor(b.color || 's1'), b.alpha || 0.1);
        ctx.fillRect(X(x0), m.t, X(x1) - X(x0), ph);
        if (b.label) {
          ctx.fillStyle = ink2;
          ctx.font = font;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(b.label, X(x0) + 5, m.t + 4);
        }
      });

      // horizontal grid + y tick labels
      ctx.lineWidth = 1;
      ctx.font = font;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      yt.ticks.forEach((t) => {
        const y = Math.round(Y(t)) + 0.5;
        ctx.strokeStyle = t === 0 ? ruleStrong : rule;
        ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
        ctx.fillStyle = ink2;
        ctx.fillText(yf(t), m.l - 8, y);
      });

      // x ticks
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      xt.ticks.forEach((t) => {
        if (t < xmin - 1e-9 || t > xmax + 1e-9) return;
        const x = Math.round(X(t)) + 0.5;
        ctx.strokeStyle = ruleStrong;
        ctx.beginPath(); ctx.moveTo(x, m.t + ph); ctx.lineTo(x, m.t + ph + 4); ctx.stroke();
        ctx.fillStyle = ink2;
        ctx.fillText(xf(t), x, m.t + ph + 7);
      });

      // axis titles
      if (cfg.xLabel) {
        ctx.fillStyle = ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(cfg.xLabel, m.l + pw / 2, H - 2);
      }
      if (cfg.yLabel) {
        ctx.save();
        ctx.translate(13, m.t + ph / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(cfg.yLabel, 0, 0);
        ctx.restore();
      }

      // reference lines (their text labels are drawn after the series so data never covers them)
      const deferred = [];
      ctx.save();
      ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
      (cfg.vlines || []).forEach((l) => {
        if (l.x < xmin || l.x > xmax) return;
        const x = Math.round(X(l.x)) + 0.5;
        ctx.strokeStyle = resolveColor(l.color || 'ink-3'); ctx.setLineDash(l.dash || [4, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
        ctx.setLineDash([]);
        if (l.label) deferred.push(() => {
          ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          const tw = ctx.measureText(l.label).width;
          const tx = x + 5 + tw + 6 > m.l + pw ? x - 5 - tw - 6 : x + 5;
          ctx.fillStyle = withAlpha(surface, 0.9); ctx.fillRect(tx - 2, m.t + 3, tw + 6, 16);
          ctx.fillStyle = ink2; ctx.fillText(l.label, tx + 1, m.t + 6);
        });
      });
      (cfg.hlines || []).forEach((l) => {
        const y = Math.round(Y(l.y)) + 0.5;
        ctx.strokeStyle = resolveColor(l.color || 'ink-3'); ctx.setLineDash(l.dash || [4, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
        ctx.setLineDash([]);
        if (l.label) deferred.push(() => {
          ctx.font = font; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
          const tw = ctx.measureText(l.label).width;
          const below = y - 20 < m.t; const top = below ? y + 4 : y - 20;
          ctx.fillStyle = withAlpha(surface, 0.9); ctx.fillRect(m.l + pw - tw - 10, top, tw + 8, 16);
          ctx.fillStyle = ink2; ctx.fillText(l.label, m.l + pw - 6, top + 15);
        });
      });
      ctx.restore();

      // series
      const ends = [];
      list.forEach((s) => {
        const color = resolveColor(s.color);
        const pts = s.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (!pts.length) return;
        ctx.save();
        ctx.beginPath(); ctx.rect(m.l - 1, m.t - 6, pw + 2, ph + 12); ctx.clip();
        const type = s.type || 'line';
        if (type !== 'scatter') {
          ctx.beginPath();
          pts.forEach((p, i) => {
            const px = X(p[0]); const py = Y(p[1]);
            if (i === 0) ctx.moveTo(px, py);
            else if (type === 'step') { ctx.lineTo(px, Y(pts[i - 1][1])); ctx.lineTo(px, py); }
            else ctx.lineTo(px, py);
          });
          if (s.fill) {
            const last = pts[pts.length - 1];
            ctx.lineTo(X(last[0]), Y(Math.max(ymin, 0)));
            ctx.lineTo(X(pts[0][0]), Y(Math.max(ymin, 0)));
            ctx.closePath();
            ctx.fillStyle = withAlpha(color, 0.14);
            ctx.fill();
            ctx.beginPath();
            pts.forEach((p, i) => {
              const px = X(p[0]); const py = Y(p[1]);
              if (i === 0) ctx.moveTo(px, py);
              else if (type === 'step') { ctx.lineTo(px, Y(pts[i - 1][1])); ctx.lineTo(px, py); }
              else ctx.lineTo(px, py);
            });
          }
          ctx.strokeStyle = color; ctx.lineWidth = s.width || 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.setLineDash(s.dash || []);
          ctx.stroke(); ctx.setLineDash([]);
        }
        const showMarkers = type === 'scatter' || s.marker === true || (s.marker !== false && pts.length <= 14);
        if (showMarkers) {
          pts.forEach((p) => {
            ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), s.radius || 4, 0, Math.PI * 2);
            ctx.fillStyle = color; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = surface; ctx.stroke(); // surface ring keeps overlapping marks legible
          });
        }
        ctx.restore();
        const lastP = pts[pts.length - 1];
        ends.push({ name: s.name, y: Y(lastP[1]), color });
      });

      ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip(); deferred.forEach((f) => f()); ctx.restore();

      // direct labels with simple collision avoidance
      if (useDirect) {
        ends.sort((a, b) => a.y - b.y);
        for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
        ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ends.forEach((e) => {
          ctx.fillStyle = e.color; ctx.fillRect(m.l + pw + 5, e.y - 1.5, 8, 3);
          ctx.fillStyle = ink; ctx.fillText(e.name, m.l + pw + 17, e.y);
        });
      }

      // hover crosshair + highlighted points
      if (hover && hover.snapX !== undefined) {
        const x = Math.round(X(hover.snapX)) + 0.5;
        ctx.strokeStyle = ink3; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke(); ctx.setLineDash([]);
        hover.rows.forEach((r) => {
          ctx.beginPath(); ctx.arc(X(r.x), Y(r.y), 5, 0, Math.PI * 2);
          ctx.fillStyle = r.color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = surface; ctx.stroke();
        });
      }
    }

    /* ---------- hover ---------- */
    function onMove(ev) {
      if (!plot) return;
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      if (mx < plot.m.l - 4 || mx > plot.m.l + plot.pw + 4 || my < plot.m.t || my > plot.m.t + plot.ph) { onLeave(); return; }
      // choose the data x closest to the cursor over all visible series
      let bestX; let bestD = Infinity;
      plot.list.forEach((s) => s.points.forEach((p) => {
        const d = Math.abs(plot.X(p[0]) - mx);
        if (d < bestD) { bestD = d; bestX = p[0]; }
      }));
      if (bestX === undefined || bestD > 40) { onLeave(); return; }
      const rows = [];
      plot.list.forEach((s) => {
        let near = null; let nd = Infinity;
        s.points.forEach((p) => { const d = Math.abs(plot.X(p[0]) - plot.X(bestX)); if (d < nd) { nd = d; near = p; } });
        if (near && nd <= 14) rows.push({ name: s.name, x: near[0], y: near[1], color: resolveColor(s.color) });
      });
      hover = { snapX: bestX, rows };
      draw();
      CN.clear(tip);
      tip.appendChild(h('div', { class: 'tip-x' }, (cfg.xTipLabel || '') + plot.xf(bestX)));
      rows.forEach((r) => tip.appendChild(h('div', { class: 'tip-row' },
        h('span', { class: 'sw', style: 'background:' + r.color }), h('span', null, r.name),
        h('span', { class: 'tip-v' }, plot.yf(r.y) + (cfg.yUnit || '')))));
      tip.style.display = 'block';
      const tw = tip.offsetWidth;
      let left = plot.X(bestX) + 14;
      if (left + tw > plot.W - 4) left = plot.X(bestX) - tw - 14;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = Math.max(4, my - 20) + 'px';
    }
    function onLeave() {
      if (!hover) return;
      hover = null; tip.style.display = 'none'; draw();
    }
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);

    /* ---------- legend + table ---------- */
    function buildLegend() {
      CN.clear(legend);
      const listed = cfg.series.filter((s) => !s.noLegend);
      const many = listed.length >= 2;
      legend.style.display = many ? '' : 'none';
      if (!many) return;
      listed.forEach((s) => {
        const color = resolveColor(s.color);
        const isDot = s.type === 'scatter';
        const sw = h('span', { class: 'sw' + (isDot ? ' dot' : (s.dash ? ' dash' : '')), style: (isDot ? 'background:' : 'border-color:') + color });
        const b = h('button', { type: 'button', 'aria-pressed': String(!hidden.has(s.name)), title: 'Click to show or hide' }, sw, h('span', null, s.name));
        b.addEventListener('click', () => {
          if (hidden.has(s.name)) hidden.delete(s.name); else hidden.add(s.name);
          b.setAttribute('aria-pressed', String(!hidden.has(s.name)));
          draw();
        });
        legend.appendChild(b);
      });
    }

    tableBox.addEventListener('toggle', () => {
      if (!tableBox.open) return;
      while (tableBox.childNodes.length > 1) tableBox.removeChild(tableBox.lastChild);
      const rows = [];
      cfg.series.forEach((s) => (s.points || []).slice(0, 300).forEach((p) => rows.push([s.name, p[0], p[1]])));
      const xf = cfg.xFormat || defaultFmt; const yf = cfg.yFormat || defaultFmt;
      tableBox.appendChild(h('div', { class: 'scroll-x', style: 'max-height:240px;overflow-y:auto' },
        h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', null, 'Series'), h('th', { class: 'num' }, cfg.xLabel || 'x'), h('th', { class: 'num' }, cfg.yLabel || 'y'))),
          h('tbody', null, rows.map((r) => h('tr', null, h('td', null, r[0]), h('td', { class: 'num' }, xf(r[1])), h('td', { class: 'num' }, yf(r[2]))))))));
    });

    /* ---------- public api ---------- */
    const api = {
      set(next) {
        cfg = Object.assign({ series: [] }, next);
        const names = new Set(cfg.series.map((s) => s.name));
        for (const n of Array.from(hidden)) if (!names.has(n)) hidden.delete(n);
        buildLegend();
        tableBox.style.display = cfg.series.length ? '' : 'none';
        if (tableBox.open) { tableBox.open = false; }
        canvas.setAttribute('aria-label', (opts.label || 'chart') + ': ' + cfg.series.map((s) => s.name).join(', '));
        draw();
      },
      draw,
      destroy() { if (ro) ro.disconnect(); CN.offThemeChange(themeFn); },
    };

    const themeFn = () => { if (!host.isConnected) { api.destroy(); return; } draw(); };
    CN.onThemeChange(themeFn);
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      let lastW = 0;
      ro = new ResizeObserver(() => { if (host.clientWidth !== lastW) { lastW = host.clientWidth; draw(); } });
      ro.observe(host);
    }
    return api;
  };
})(typeof window !== 'undefined' ? window : globalThis);
