/* ==========================================================================
   Tab: Flow control and ARQ  (Unit 3, Data Link Layer)
   Stop-and-Wait, Go-Back-N and Selective Repeat on a lossy link.

   Part 1 - the simulator (no DOM). It is an event-driven simulation: a list of
            future events (frame finishes sending, frame arrives, ACK arrives,
            timer fires) is processed in time order. Time is measured in units
            of Tf, the time to put one frame on the wire.
   Part 2 - the interface: an animated space-time (ladder) diagram, window
            strips, an event log and comparison charts.
   ========================================================================== */
(function (root) {
  'use strict';
  const CN = (root.CN = root.CN || {});
  const FC = (CN.flowControl = {});

  /* ----------------------------------------------------------------------
     Small priority queue (binary heap) ordered by time, then priority, then id
     ---------------------------------------------------------------------- */
  function makeHeap() {
    const a = [];
    const less = (x, y) => x.t < y.t || (x.t === y.t && (x.p < y.p || (x.p === y.p && x.id < y.id)));
    return {
      get size() { return a.length; },
      push(e) {
        a.push(e);
        let i = a.length - 1;
        while (i > 0) {
          const parent = (i - 1) >> 1;
          if (!less(a[i], a[parent])) break;
          [a[i], a[parent]] = [a[parent], a[i]];
          i = parent;
        }
      },
      pop() {
        const top = a[0];
        const last = a.pop();
        if (a.length) {
          a[0] = last;
          let i = 0;
          for (;;) {
            let m = i;
            const l = 2 * i + 1; const r = l + 1;
            if (l < a.length && less(a[l], a[m])) m = l;
            if (r < a.length && less(a[r], a[m])) m = r;
            if (m === i) break;
            [a[i], a[m]] = [a[m], a[i]];
            i = m;
          }
        }
        return top;
      },
    };
  }

  FC.defaults = { protocol: 'gbn', N: 10, W: 4, Tf: 1, Tp: 2, timeout: null, pData: 0, pAck: 0, seed: 1, dropData: [], dropAck: [], record: true, maxEvents: 400000 };

  /* The timer starts when a frame has been fully sent. An ACK comes back 2*Tp later, so the timeout must be a bit longer. */
  FC.autoTimeout = (o) => 2 * o.Tp + 0.1;

  /* Ideal efficiency with no losses: fraction of time the sender is busy sending frames. a = Tp / Tf. */
  FC.idealEfficiency = function (protocol, W, Tp, Tf) {
    const a = Tp / (Tf || 1);
    if (protocol === 'sw') return 1 / (1 + 2 * a);
    return Math.min(1, W / (1 + 2 * a));
  };

  /* Large-window approximations for a link that only loses data frames (probability p). Used for the dashed lines. */
  FC.lossyEfficiency = function (protocol, p, Tp, Tf) {
    const a = Tp / (Tf || 1);
    if (protocol === 'sw') return (1 - p) / (1 + 2 * a);
    if (protocol === 'gbn') return (1 - p) / (1 + 2 * a * p);
    return 1 - p;
  };

  FC.simulate = function (cfg) {
    const o = Object.assign({}, FC.defaults, cfg);
    const N = o.N; const Tf = o.Tf; const Tp = o.Tp;
    const isSR = o.protocol === 'sr';
    const W = o.protocol === 'sw' ? 1 : Math.max(1, Math.floor(o.W));
    const T = o.timeout !== null && o.timeout !== undefined ? o.timeout : FC.autoTimeout(o);
    const maxTime = o.maxTime || N * (T + Tf + 2 * Tp) * 40;
    const rng = CN.makeRng(o.seed);
    const dropData = new Set(o.dropData);
    const dropAck = new Set(o.dropAck);
    const dropAckUsed = new Set();
    const round = (x) => Math.round(x * 1e9) / 1e9;

    const heap = makeHeap();
    let idc = 0;
    const sched = (t, p, ev) => { ev.t = round(t); ev.p = p; ev.id = idc++; heap.push(ev); };

    const sendCount = new Array(N).fill(0);
    const acked = new Array(N).fill(false);
    let base = 0; let nextSeq = 0; let txBusy = false;
    const queue = [];
    let rcvNext = 0; const rcvBuf = new Set(); let delivered = 0;
    let finish = null; let aborted = false;
    let discards = 0; let dupAcks = 0; let timeouts = 0;

    const rec = o.record;
    const log = { frames: [], acks: [], timeouts: [], rx: [], events: [], snaps: [] };
    const say = (t, kind, text) => { if (rec) log.events.push({ t: round(t), kind, text }); };
    const snap = (t) => {
      if (!rec) return;
      log.snaps.push({ t: round(t), base, windowEnd: Math.min(N, base + W), acked: acked.slice(), sendCount: sendCount.slice(), rcvNext, buf: Array.from(rcvBuf), delivered });
    };
    const rx = (t, kind, seq) => { if (rec) log.rx.push({ t: round(t), kind, seq }); };

    function fill() { while (nextSeq < N && nextSeq < base + W) { queue.push(nextSeq); nextSeq++; } }

    function startTx(t) {
      if (txBusy) return;
      let seq;
      while (queue.length) {
        const s = queue.shift();
        if (acked[s] || (!isSR && s < base)) continue; // already confirmed while waiting in the queue
        seq = s; break;
      }
      if (seq === undefined) return;
      const attempt = ++sendCount[seq];
      const roll = rng();
      const lost = (attempt === 1 && dropData.has(seq)) || roll < o.pData;
      txBusy = true;
      const fr = { seq, attempt, start: round(t), end: round(t + Tf), arrive: round(t + Tf + Tp), lost, retx: attempt > 1 };
      if (rec) log.frames.push(fr);
      say(t, attempt > 1 ? 'retx' : 'send', (attempt > 1 ? 'Resend F' : 'Send F') + seq + (attempt > 1 ? ' (attempt ' + attempt + ')' : ''));
      sched(t + Tf, 2, { type: 'txEnd', seq, attempt, lost });
    }
    function pump(t) { fill(); startTx(t); }

    function sendAck(t, ackNo) {
      const roll = rng();
      let lost = roll < o.pAck;
      if (dropAck.has(ackNo) && !dropAckUsed.has(ackNo)) { lost = true; dropAckUsed.add(ackNo); }
      if (rec) log.acks.push({ ackNo, send: round(t), arrive: round(t + Tp), lost });
      say(t, lost ? 'loss' : 'ack', 'Receiver sends ACK ' + ackNo + (lost ? ' (lost in the channel)' : ''));
      if (!lost) sched(t + Tp, 1, { type: 'ack', ackNo });
    }

    function onData(t, seq) {
      if (!isSR) {
        if (seq === rcvNext) { rcvNext++; delivered++; rx(t, 'deliver', seq); say(t, 'ok', 'Receiver accepts F' + seq + ' and delivers it'); }
        else if (seq > rcvNext) { discards++; rx(t, 'discard', seq); say(t, 'recv', 'F' + seq + ' arrives out of order (expected F' + rcvNext + '): discarded'); }
        else { discards++; rx(t, 'dup', seq); say(t, 'recv', 'F' + seq + ' is a duplicate: discarded'); }
        sendAck(t, rcvNext); // cumulative: "I am ready for frame rcvNext"
        return;
      }
      if (seq < rcvNext) { rx(t, 'dup', seq); say(t, 'recv', 'F' + seq + ' is a duplicate: re-acknowledged'); sendAck(t, seq); return; }
      if (seq >= rcvNext + W) { discards++; rx(t, 'discard', seq); say(t, 'recv', 'F' + seq + ' is outside the receive window: discarded'); return; }
      if (!rcvBuf.has(seq)) rcvBuf.add(seq);
      sendAck(t, seq);
      if (seq === rcvNext) {
        while (rcvBuf.has(rcvNext)) { rcvBuf.delete(rcvNext); rx(t, 'deliver', rcvNext); say(t, 'ok', 'Receiver delivers F' + rcvNext); rcvNext++; delivered++; }
      } else { rx(t, 'buffer', seq); say(t, 'recv', 'F' + seq + ' arrives early: buffered until F' + rcvNext + ' shows up'); }
    }

    function onAck(t, ackNo) {
      if (!isSR) {
        if (ackNo > base) {
          for (let i = base; i < ackNo; i++) acked[i] = true;
          base = ackNo;
          say(t, 'ack', 'Sender gets ACK ' + ackNo + ': window slides to start at F' + base);
        } else { dupAcks++; say(t, 'ack', 'Sender gets ACK ' + ackNo + ' again: nothing new'); }
      } else if (!acked[ackNo]) {
        acked[ackNo] = true;
        while (base < N && acked[base]) base++;
        say(t, 'ack', 'Sender gets ACK ' + ackNo + (base > ackNo ? ': window slides to F' + base : ''));
      } else { dupAcks++; say(t, 'ack', 'Sender gets ACK ' + ackNo + ' again: nothing new'); }
      if (base >= N) finish = t;
    }

    function onTimeout(t, ev) {
      const seq = ev.seq;
      const live = sendCount[seq] === ev.token && !acked[seq] && (isSR || seq >= base);
      if (!live) return;
      if (!isSR) {
        if (seq !== base) return; // only the oldest unacknowledged frame owns the timer
        const resend = [];
        for (let s = base; s < nextSeq; s++) resend.push(s);
        timeouts++;
        if (rec) log.timeouts.push({ t: round(t), seq, startedAt: ev.startedAt, kind: 'go-back', resend });
        say(t, 'timeout', 'Timeout for F' + seq + (o.protocol === 'sw' ? ': resend it' : ': go back and resend F' + base + (resend.length > 1 ? ' to F' + resend[resend.length - 1] : '')));
        nextSeq = base; queue.length = 0;
      } else {
        timeouts++;
        if (rec) log.timeouts.push({ t: round(t), seq, startedAt: ev.startedAt, kind: 'retransmit', resend: [seq] });
        say(t, 'timeout', 'Timeout for F' + seq + ': resend only F' + seq);
        if (!queue.includes(seq)) queue.unshift(seq);
      }
    }

    pump(0); snap(0);
    let count = 0;
    while (heap.size && finish === null) {
      const ev = heap.pop();
      if (++count > o.maxEvents || ev.t > maxTime) { aborted = true; break; }
      const t = ev.t;
      if (ev.type === 'txEnd') {
        txBusy = false;
        if (ev.lost) say(t, 'loss', 'F' + ev.seq + ' is lost in the channel');
        else sched(t + Tp, 0, { type: 'data', seq: ev.seq });
        sched(t + T, 3, { type: 'timeout', seq: ev.seq, token: ev.attempt, startedAt: round(t) });
        pump(t);
      } else if (ev.type === 'data') onData(t, ev.seq);
      else if (ev.type === 'ack') { onAck(t, ev.ackNo); if (finish === null) pump(t); }
      else if (ev.type === 'timeout') { onTimeout(t, ev); pump(t); }
      snap(t);
    }

    let totalTx = 0;
    sendCount.forEach((c) => { totalTx += c; });
    const done = finish !== null;
    return {
      cfg: Object.assign({}, o, { W, timeout: T }),
      finish: done ? finish : null, aborted,
      stats: {
        N, totalTx, retx: totalTx - N, timeouts, discards, dupAcks, delivered,
        efficiency: done ? (N * Tf) / finish : 0,
        throughput: done ? N / finish : 0,
      },
      log,
    };
  };

  /* Average efficiency over many seeds (for the comparison charts) */
  FC.average = function (cfg, runs) {
    let eff = 0; let retx = 0; let ok = 0;
    for (let i = 0; i < runs; i++) {
      const r = FC.simulate(Object.assign({}, cfg, { seed: (cfg.seed || 1) * 1000 + i + 1, record: false, dropData: [], dropAck: [] }));
      if (r.finish !== null) { eff += r.stats.efficiency; retx += r.stats.retx / r.stats.N; ok++; }
    }
    return { efficiency: ok ? eff / ok : 0, retxPerFrame: ok ? retx / ok : 0 };
  };

  FC.sweepLoss = function (base, losses, runs) {
    const out = { sw: [], gbn: [], sr: [] };
    ['sw', 'gbn', 'sr'].forEach((p) => {
      losses.forEach((l) => { out[p].push(FC.average(Object.assign({}, base, { protocol: p, pData: l }), runs).efficiency); });
    });
    return out;
  };

  FC.sweepWindow = function (base, windows, runs) {
    const out = { sw: [], gbn: [], sr: [] };
    out.sw = windows.map(() => FC.average(Object.assign({}, base, { protocol: 'sw' }), runs).efficiency);
    ['gbn', 'sr'].forEach((p) => {
      windows.forEach((w) => { out[p].push(FC.average(Object.assign({}, base, { protocol: p, W: w }), runs).efficiency); });
    });
    return out;
  };

  /* "2, 5 7" -> [2,5,7]; returns null when something is not a whole number */
  FC.parseList = function (text) {
    const t = String(text).trim();
    if (!t) return [];
    const parts = t.split(/[\s,;]+/).filter(Boolean);
    const out = [];
    for (const p of parts) { if (!/^\d+$/.test(p)) return null; out.push(Number(p)); }
    return out;
  };

  if (typeof document === 'undefined') return;

  /* ======================================================================
     USER INTERFACE
     ====================================================================== */
  const h = CN.h;
  let svgCounter = 0;

  const NAMES = { sw: 'Stop-and-Wait', gbn: 'Go-Back-N', sr: 'Selective Repeat' };

  /* ---------------------------------------------------------------- ladder diagram */
  function buildLadder(res) {
    const c = res.cfg;
    const Tf = c.Tf; const Tp = c.Tp;
    let totalT = res.finish !== null ? res.finish : 20;
    totalT = Math.max(totalT, 2);
    const px = totalT <= 30 ? 26 : totalT <= 60 ? 17 : totalT <= 120 ? 10 : 6;
    const W = 660; const xs = 170; const xr = 470; const top = 62;
    const Y = (t) => top + t * px;
    const Hh = Y(totalT) + 26;
    const id = 'reveal' + (++svgCounter);
    const slope = (Math.atan2(Tp * px, xr - xs) * 180) / Math.PI;

    const svg = h('svg', { viewBox: '0 0 ' + W + ' ' + Hh, width: W, height: Hh, role: 'img', 'aria-label': 'Space-time diagram of the transmission' });
    const defs = h('defs', null,
      h('marker', { id: 'arr' + id, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' },
        h('path', { d: 'M0,0 L10,5 L0,10 z', style: 'fill: var(--s3)' })),
      h('clipPath', { id }, h('rect', { x: 0, y: 0, width: W, height: Hh })));
    svg.appendChild(defs);

    // fixed furniture: time grid, columns, headings
    const grid = h('g', null);
    const step = px >= 17 ? 1 : px >= 10 ? 2 : 5;
    for (let t = 0; t <= totalT + 0.001; t += step) {
      grid.appendChild(h('line', { x1: 52, x2: W - 10, y1: Y(t), y2: Y(t), style: 'stroke: var(--rule); stroke-width:1; opacity:0.55' }));
      if (t % (step === 1 ? 5 : step === 2 ? 10 : 10) === 0) grid.appendChild(h('text', { x: 46, y: Y(t) + 4, 'text-anchor': 'end', style: 'font-size:11px; fill: var(--ink-3)' }, String(t)));
    }
    grid.appendChild(h('text', { x: 46, y: 36, 'text-anchor': 'end', style: 'font-size:11px; fill: var(--ink-3)' }, 'time (Tf)'));
    svg.appendChild(grid);
    svg.appendChild(h('line', { x1: xs, x2: xs, y1: top - 8, y2: Hh - 14, style: 'stroke: var(--ink); stroke-width:2' }));
    svg.appendChild(h('line', { x1: xr, x2: xr, y1: top - 8, y2: Hh - 14, style: 'stroke: var(--ink); stroke-width:2' }));
    svg.appendChild(h('text', { x: xs, y: 24, 'text-anchor': 'middle', style: 'font-size:15px; font-weight:700' }, 'Sender'));
    svg.appendChild(h('text', { x: xr, y: 24, 'text-anchor': 'middle', style: 'font-size:15px; font-weight:700' }, 'Receiver'));
    svg.appendChild(h('text', { x: xs, y: 42, 'text-anchor': 'middle', style: 'font-size:11.5px; fill: var(--ink-3)' }, c.protocol === 'sw' ? 'window = 1' : 'window = ' + c.W));
    svg.appendChild(h('text', { x: xr, y: 42, 'text-anchor': 'middle', style: 'font-size:11.5px; fill: var(--ink-3)' }, c.protocol === 'sr' ? 'buffers out-of-order frames' : 'accepts in order only'));

    // everything that happens over time is revealed by the clip rectangle
    const g = h('g', { 'clip-path': 'url(#' + id + ')' });
    svg.appendChild(g);
    const clipRect = defs.querySelector('rect');

    // timers that expired
    res.log.timeouts.forEach((to, i) => {
      const x = xs - 18 - (i % 3) * 9;
      g.appendChild(h('line', { x1: x, x2: x, y1: Y(to.startedAt), y2: Y(to.t), style: 'stroke: var(--s2); stroke-width:2; stroke-dasharray:3 3' }));
      g.appendChild(h('circle', { cx: x, cy: Y(to.t), r: 5, style: 'fill: var(--s2); stroke: var(--surface); stroke-width:2' }));
      g.appendChild(h('text', { x: x - 9, y: Y(to.t) + 4, 'text-anchor': 'end', style: 'font-size:11.5px; font-weight:600' }, 'timeout F' + to.seq));
    });

    // frames
    res.log.frames.forEach((f) => {
      const color = f.retx ? 'var(--s2)' : 'var(--s1)';
      const frac = f.lost ? 0.5 : 1;
      const x2 = xs + (xr - xs) * frac;
      const dy = Tp * px * frac;
      const pts = [[xs, Y(f.start)], [xs, Y(f.end)], [x2, Y(f.end) + dy], [x2, Y(f.start) + dy]];
      g.appendChild(h('polygon', { points: pts.map((p) => p[0] + ',' + p[1]).join(' '), style: 'fill:' + color + '; fill-opacity:0.3; stroke:' + color + '; stroke-width:1.5' + (f.lost ? '; stroke-dasharray:4 3' : '') }));
      const lf = f.lost ? 0.27 : 0.5;
      const cx = xs + (xr - xs) * lf; const cy = (Y(f.start) + Y(f.end)) / 2 + Tp * px * lf;
      g.appendChild(h('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', transform: 'rotate(' + slope.toFixed(1) + ' ' + cx + ' ' + cy + ')', style: 'font-size:12px; font-weight:700' }, 'F' + f.seq));
      if (f.lost) g.appendChild(h('text', { x: x2 + 2, y: (Y(f.start) + Y(f.end)) / 2 + dy + 6, 'text-anchor': 'middle', style: 'font-size:17px; font-weight:800; fill: var(--bad)' }, '✕'));
    });

    // acknowledgements
    res.log.acks.forEach((a) => {
      const frac = a.lost ? 0.5 : 1;
      const xe = xr - (xr - xs) * frac;
      const ye = Y(a.send) + Tp * px * frac;
      g.appendChild(h('line', { x1: xr, y1: Y(a.send), x2: xe, y2: ye, style: 'stroke: var(--s3); stroke-width:2' + (a.lost ? '; stroke-dasharray:4 3' : ''), 'marker-end': a.lost ? null : 'url(#arr' + id + ')' }));
      const lf = a.lost ? 0.27 : 0.5;
      const cx = xr - (xr - xs) * lf; const cy = Y(a.send) + Tp * px * lf - 6;
      g.appendChild(h('text', { x: cx, y: cy, 'text-anchor': 'middle', transform: 'rotate(' + (-slope).toFixed(1) + ' ' + cx + ' ' + cy + ')', style: 'font-size:11px; fill: var(--ink-2)' }, 'ACK ' + a.ackNo));
      if (a.lost) g.appendChild(h('text', { x: xe - 2, y: ye + 6, 'text-anchor': 'middle', style: 'font-size:17px; font-weight:800; fill: var(--bad)' }, '✕'));
    });

    // what the receiver does
    res.log.rx.forEach((r) => {
      const good = r.kind === 'deliver'; const buf = r.kind === 'buffer';
      g.appendChild(h('circle', { cx: xr, cy: Y(r.t), r: 4.5, style: good ? 'fill: var(--good)' : buf ? 'fill: var(--s1)' : 'fill: var(--surface); stroke: var(--ink-3); stroke-width:1.5' }));
      if (px * Tf >= 12 || good) {
        g.appendChild(h('text', { x: xr + 11, y: Y(r.t) + 4, style: 'font-size:11px; fill: var(--ink-2)' },
          r.kind === 'deliver' ? 'deliver F' + r.seq : r.kind === 'buffer' ? 'buffer F' + r.seq : 'drop F' + r.seq));
      }
    });

    // playhead
    const head = h('line', { x1: 52, x2: W - 10, y1: Y(0), y2: Y(0), style: 'stroke: var(--accent); stroke-width:2' });
    const headLabel = h('text', { x: W - 12, y: Y(0) - 5, 'text-anchor': 'end', style: 'font-size:11.5px; font-weight:700; fill: var(--accent)' }, 't = 0');
    svg.appendChild(head); svg.appendChild(headLabel);

    return {
      svg, Y, px, height: Hh,
      setTime(t) {
        const tt = Math.max(0, Math.min(t, totalT));
        clipRect.setAttribute('height', String(Y(tt) + 1));
        head.setAttribute('y1', String(Y(tt))); head.setAttribute('y2', String(Y(tt)));
        headLabel.setAttribute('y', String(Y(tt) - 5));
        headLabel.textContent = 't = ' + (Math.round(tt * 10) / 10);
      },
    };
  }

  function snapAt(res, t) {
    const s = res.log.snaps;
    let lo = 0; let hi = s.length - 1; let ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (s[mid].t <= t + 1e-9) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return s[ans];
  }

  /* ---------------------------------------------------------------- page */
  CN.registerTab({
    id: 'flow',
    group: { layer: 2, name: 'Data Link' },
    title: 'Flow control',
    mount(page) {
      page.appendChild(CN.pageHead({
        title: 'Flow control and ARQ',
        lead: 'Watch Stop-and-Wait, Go-Back-N and Selective Repeat handle a frame that never arrives. Drop frames, add loss, resize the window, and see exactly what the sender and receiver do.',
        units: [{ unit: 3, name: 'Data Link Layer', co: 3, level: 'Understand' }],
        topics: ['Stop and Wait protocol', 'Sliding window: Go-Back-N, Selective Repeat', 'Performance analysis'],
      }));

      /* ---- controls ---- */
      const proto = CN.segmented({ label: 'Protocol', options: [{ value: 'sw', label: 'Stop-and-Wait' }, { value: 'gbn', label: 'Go-Back-N' }, { value: 'sr', label: 'Selective Repeat' }], value: 'gbn', onChange: onConfig });
      const win = CN.slider({ label: 'Window size', min: 2, max: 8, value: 4, onInput: onConfig, hint: 'How many frames may be unacknowledged at once.' });
      const nFrames = CN.slider({ label: 'Frames to send', min: 5, max: 16, value: 10, onInput: onConfig });
      const tp = CN.slider({ label: 'Propagation delay', min: 0.5, max: 4, step: 0.5, value: 2, format: (v) => v.toFixed(1) + ' Tf', onInput: onConfig, hint: 'One-way trip time in units of the frame sending time.' });
      const autoTo = CN.check({ label: 'Pick the timeout automatically', checked: true, onChange: onConfig });
      const tout = CN.slider({ label: 'Timeout', min: 1, max: 14, step: 0.5, value: 5, format: (v) => v.toFixed(1) + ' Tf', onInput: onConfig, hint: 'Counted from when the frame has been fully sent.' });
      const pd = CN.slider({ label: 'Random frame loss', min: 0, max: 50, value: 0, format: (v) => v + '%', onInput: onConfig });
      const pa = CN.slider({ label: 'Random ACK loss', min: 0, max: 50, value: 0, format: (v) => v + '%', onInput: onConfig });
      const dropD = CN.textField({ label: 'Always lose these frames (first try)', value: '2', mono: true, hint: 'Frame numbers like 2, 5. Retries get through.', onInput: onConfig });
      const dropA = CN.textField({ label: 'Always lose these ACKs (first try)', value: '', mono: true, hint: 'For Stop-and-Wait and Go-Back-N, ACK n means "send frame n next".', onInput: onConfig });
      const seed = CN.textField({ label: 'Random seed', value: '7', mono: true, onInput: onConfig });
      const speed = CN.slider({ label: 'Animation speed', min: 0.5, max: 5, step: 0.5, value: 1.5, format: (v) => v + 'x' });

      const btnPlay = CN.button('Play', { kind: 'primary' });
      const btnStep = CN.button('Step');
      const btnAll = CN.button('Show everything');

      const controls = h('div', { class: 'controls' },
        h('h3', null, 'Protocol'), proto.el, win.el,
        h('h3', null, 'Link'), nFrames.el, tp.el, autoTo.el, tout.el,
        h('h3', null, 'What goes wrong'), dropD.el, dropA.el, pd.el, pa.el, seed.el,
        h('h3', null, 'Playback'), speed.el,
        h('div', { class: 'row tight' }, btnPlay, btnStep, btnAll));

      /* ---- stage pieces ---- */
      const senderStrip = h('div', { class: 'window-strip' });
      const receiverStrip = h('div', { class: 'window-strip' });
      const stripKey = h('div', { class: 'key' },
        h('span', null, h('i', { style: 'background: var(--good-soft); border-color: var(--good)' }), 'acknowledged / delivered'),
        h('span', null, h('i', { style: 'background: var(--info-soft); border-color: var(--info)' }), 'sent, waiting (or buffered)'),
        h('span', null, h('i', { style: 'background: var(--warn-soft); border-color: var(--warn)' }), 'sent again'),
        h('span', null, h('i', { style: 'border-style: dashed; border-color: var(--ink-2)' }), 'allowed to send next'),
        h('span', null, h('i', { style: 'border-top: 3px solid var(--accent)' }), 'inside the window'));
      const ladderWrap = h('div', { class: 'ladder-wrap' });
      const ladderKey = h('div', { class: 'key', style: 'margin-top:10px' },
        h('span', null, h('i', { style: 'background: var(--s1); opacity:.5' }), 'frame'),
        h('span', null, h('i', { style: 'background: var(--s2); opacity:.5' }), 'frame sent again'),
        h('span', null, h('i', { style: 'background: var(--s3)' }), 'ACK'),
        h('span', null, h('b', { style: 'color: var(--bad)' }, '✕'), 'lost in the channel'),
        h('span', null, h('i', { style: 'background: var(--s2); border-radius:50%' }), 'timer ran out'));
      const logBox = h('div', { class: 'log', role: 'log', 'aria-label': 'Event log' });
      const verdict = h('div');
      const ro = {
        finish: CN.readout('Finished at'), tx: CN.readout('Frames sent in total'), retx: CN.readout('Frames sent again'),
        to: CN.readout('Timeouts'), disc: CN.readout('Dropped by receiver'), eff: CN.readout('Link efficiency'), ideal: CN.readout('Ideal efficiency'),
      };
      const formula = h('div');

      const stage = h('div', { class: 'stage' },
        CN.panel('Windows right now', 'Frame numbers run left to right. The blue bar marks the sender window.',
          h('div', { class: 'field-top', style: 'margin-bottom:4px' }, h('span', { class: 'field-label' }, 'Sender')), senderStrip,
          h('div', { class: 'field-top', style: 'margin:12px 0 4px' }, h('span', { class: 'field-label' }, 'Receiver')), receiverStrip,
          h('div', { style: 'margin-top:12px' }, stripKey)),
        CN.panel('Space-time diagram', 'Time runs downward. Slanted bands are frames travelling to the receiver; green arrows are ACKs coming back.', ladderWrap, ladderKey),
        CN.panel('What happened', null, logBox),
        verdict,
        h('div', { class: 'readouts' }, ro.finish.el, ro.tx.el, ro.retx.el, ro.to.el, ro.disc.el, ro.eff.el, ro.ideal.el),
        CN.panel('Where the efficiency comes from', null, formula));

      /* ---- sweep charts ---- */
      const sweepMode = CN.segmented({ label: 'Sweep', options: [{ value: 'loss', label: 'Efficiency vs frame loss' }, { value: 'window', label: 'Efficiency vs window size' }], value: 'loss', onChange: runSweep });
      const chartHost = h('div');
      const chart = new CN.Chart(chartHost, { height: 320, label: 'Efficiency comparison' });
      const sweepStatus = h('span', { class: 'field-hint' });
      const sweepNote = h('div');
      const sweepPanel = CN.panel('Compare the three protocols', 'Each point averages 16 random runs of 100 frames with the link settings on the left (loss sweeps use the current ACK loss; window sweeps use the current frame loss).',
        h('div', { class: 'row', style: 'margin-bottom:10px' }, sweepMode.el, CN.button('Run again', { onClick: runSweep }), sweepStatus), chartHost, h('div', { style: 'margin-top:12px' }, sweepNote));

      /* ---- state and playback ---- */
      let res = null; let playhead = 0; let playing = false; let logPtr = 0; let ladder = null; let sweepTimer = 0;
      const loop = CN.makeLoop((dt) => {
        if (!res || res.finish === null) return;
        playhead += dt * 3 * speed.get();
        if (playhead >= res.finish) { playhead = res.finish; setPlaying(false); }
        render(playhead);
      });

      function setPlaying(v) {
        playing = v;
        btnPlay.textContent = v ? 'Pause' : (res && playhead >= res.finish ? 'Replay' : 'Play');
        if (v) loop.start(); else loop.stop();
      }

      function readConfig() {
        const dropData = FC.parseList(dropD.get()); const dropAck = FC.parseList(dropA.get());
        dropD.invalid(dropData === null); dropA.invalid(dropAck === null);
        const N = nFrames.get();
        return {
          protocol: proto.get(), N, W: win.get(), Tf: 1, Tp: tp.get(),
          timeout: autoTo.get() ? null : tout.get(), pData: pd.get() / 100, pAck: pa.get() / 100,
          seed: parseInt(seed.get(), 10) || 1,
          dropData: (dropData || []).filter((x) => x < N), dropAck: (dropAck || []).filter((x) => x <= N),
        };
      }

      function onConfig() {
        win.setDisabled(proto.get() === 'sw');
        tout.setDisabled(autoTo.get());
        const cfg = readConfig();
        res = FC.simulate(cfg);
        if (autoTo.get()) tout.set(Math.min(14, Math.round(res.cfg.timeout * 2) / 2));
        rebuild();
        playhead = res.finish !== null ? res.finish : 0;
        setPlaying(false);
        render(playhead, true);
        scheduleSweep();
      }

      function rebuild() {
        CN.clear(ladderWrap);
        ladder = buildLadder(res);
        ladderWrap.appendChild(ladder.svg);
        buildSummary();
      }

      function stripCell(cls, text, inwin) { return h('div', { class: 'wcell' + (cls ? ' ' + cls : '') + (inwin ? ' inwin' : '') }, String(text)); }

      function render(t, jump) {
        if (!res) return;
        ladder.setTime(t);
        // follow the playhead
        if (playing) ladderWrap.scrollTop = Math.max(0, ladder.Y(t) - ladderWrap.clientHeight * 0.65);
        const s = snapAt(res, t);
        const N = res.cfg.N;
        CN.clear(senderStrip); CN.clear(receiverStrip);
        for (let i = 0; i < N; i++) {
          const inwin = i >= s.base && i < s.windowEnd;
          let cls = '';
          if (s.acked[i]) cls = 'acked';
          else if (s.sendCount[i] > 1) cls = 'retx';
          else if (s.sendCount[i] === 1) cls = 'sent';
          else if (inwin) cls = 'ready';
          senderStrip.appendChild(stripCell(cls, i, inwin));
          let rc = '';
          if (i < s.rcvNext) rc = 'acked';
          else if (s.buf.indexOf(i) >= 0) rc = 'sent';
          else if (i === s.rcvNext) rc = 'ready';
          receiverStrip.appendChild(stripCell(rc, i, false));
        }
        // log: show every entry up to t
        const ev = res.log.events;
        if (jump || (logPtr > 0 && ev[logPtr - 1] && ev[logPtr - 1].t > t + 1e-9)) { CN.clear(logBox); logPtr = 0; }
        while (logPtr < ev.length && ev[logPtr].t <= t + 1e-9) {
          const e = ev[logPtr++];
          logBox.appendChild(h('div', { class: 'log-row ' + (e.kind === 'loss' || e.kind === 'timeout' ? 'loss' : e.kind === 'retx' ? 'retx' : e.kind === 'ok' ? 'ok' : '') },
            h('span', { class: 't' }, 't=' + (Math.round(e.t * 10) / 10)), h('span', null, e.text)));
        }
        logBox.scrollTop = logBox.scrollHeight;
      }

      function buildSummary() {
        const st = res.stats; const c = res.cfg;
        const a = c.Tp / c.Tf;
        CN.clear(verdict); CN.clear(formula);
        if (res.finish === null) {
          ro.finish.set('never'); ro.tx.set(String(st.totalTx)); ro.retx.set(String(st.retx)); ro.to.set(String(st.timeouts)); ro.disc.set(String(st.discards)); ro.eff.set('0%'); ro.ideal.set('-');
          verdict.appendChild(CN.note('bad', 'The transfer did not finish: with this much loss the sender keeps timing out. Lower the loss or raise the timeout.'));
          return;
        }
        ro.finish.set(CN.fmt(res.finish, 1) + ' Tf'); ro.tx.set(String(st.totalTx), 'for ' + st.N + ' frames'); ro.retx.set(String(st.retx));
        ro.to.set(String(st.timeouts)); ro.disc.set(String(st.discards)); ro.eff.set(CN.pct(st.efficiency, 1), 'measured: ' + st.N + ' frames / ' + CN.fmt(res.finish, 1) + ' Tf');
        const ideal = FC.idealEfficiency(c.protocol, c.W, c.Tp, c.Tf);
        ro.ideal.set(CN.pct(ideal, 1), 'with no loss');

        const lines = [];
        const lostFrames = res.log.frames.filter((f) => f.lost).map((f) => 'F' + f.seq + (f.retx ? ' (retry)' : ''));
        const lostAcks = res.log.acks.filter((x) => x.lost).map((x) => 'ACK ' + x.ackNo);
        if (!lostFrames.length && !lostAcks.length) lines.push('Nothing was lost, so every frame was sent exactly once.');
        else {
          lines.push((lostFrames.length ? 'Lost frames: ' + lostFrames.join(', ') + '. ' : '') + (lostAcks.length ? 'Lost ACKs: ' + lostAcks.join(', ') + '. ' : ''));
          if (c.protocol === 'sw') lines.push('Stop-and-Wait has only one frame outstanding, so after each loss the line sits idle for the whole timeout before the single repeat.');
          else if (c.protocol === 'gbn') lines.push('Go-Back-N cannot keep frames that arrive after a gap. The receiver dropped ' + st.discards + ' frame' + (st.discards === 1 ? '' : 's') + ' and the sender repeated ' + st.retx + ' (a whole window each time).');
          else lines.push('Selective Repeat buffers frames that arrive early and only repeats the ones that were actually lost: ' + st.retx + ' repeat' + (st.retx === 1 ? '' : 's') + ' for ' + st.timeouts + ' timeout' + (st.timeouts === 1 ? '' : 's') + '.');
        }
        verdict.appendChild(CN.note(st.retx ? 'warn' : 'good', lines.join(' ')));

        const needW = 1 + 2 * a;
        const f = [];
        f.push(h('p', null, 'a = Tp / Tf = ', h('b', { class: 'mono' }, CN.fmt(a, 1)), '. The sender needs ', h('b', { class: 'mono' }, '1 + 2a = ' + CN.fmt(needW, 1)), ' frames in flight to keep the link busy while waiting for the first ACK.'));
        if (c.protocol === 'sw') f.push(h('p', null, 'Stop-and-Wait sends one frame per round trip: efficiency = 1 / (1 + 2a) = ', h('b', { class: 'mono' }, CN.pct(ideal, 1)), '.'));
        else f.push(h('p', null, 'With window W = ' + c.W + ': efficiency = min(1, W / (1 + 2a)) = min(1, ' + c.W + ' / ' + CN.fmt(needW, 1) + ') = ', h('b', { class: 'mono' }, CN.pct(ideal, 1)), '. ', c.W >= needW ? 'The window is big enough to fill the pipe.' : 'The window is too small; the sender stalls waiting for ACKs. Try a larger window.'));
        f.push(h('p', { style: 'margin:0' }, 'The measured value is lower than the ideal one when frames are lost, because time is spent waiting for timeouts and resending.'));
        formula.appendChild(h('div', null, f));
      }

      /* ---- buttons ---- */
      btnPlay.addEventListener('click', () => {
        if (!res || res.finish === null) return;
        if (playing) { setPlaying(false); return; }
        if (playhead >= res.finish - 1e-9) { playhead = 0; render(0, true); }
        setPlaying(true);
      });
      btnStep.addEventListener('click', () => {
        if (!res || res.finish === null) return;
        setPlaying(false);
        if (playhead >= res.finish - 1e-9) { playhead = 0; render(0, true); }
        const next = res.log.events.find((e) => e.t > playhead + 1e-9);
        playhead = next ? next.t : res.finish;
        render(playhead);
        btnPlay.textContent = playhead >= res.finish ? 'Replay' : 'Play';
      });
      btnAll.addEventListener('click', () => {
        if (!res || res.finish === null) return;
        setPlaying(false);
        playhead = res.finish; render(playhead, true);
        btnPlay.textContent = 'Replay';
      });

      /* ---- sweep ---- */
      function scheduleSweep() { clearTimeout(sweepTimer); sweepTimer = setTimeout(runSweep, 450); }
      function runSweep() {
        clearTimeout(sweepTimer);
        sweepStatus.textContent = 'Running...';
        setTimeout(() => {
          const t0 = performance.now();
          const cfg = readConfig();
          const base = { N: 100, W: cfg.W, Tf: 1, Tp: cfg.Tp, timeout: cfg.timeout, pData: cfg.pData, pAck: cfg.pAck, seed: cfg.seed };
          const colors = { sw: 's1', gbn: 's2', sr: 's3' };
          let series = [];
          let note = '';
          if (sweepMode.get() === 'loss') {
            const losses = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4];
            const r = FC.sweepLoss(base, losses, 16);
            series = ['sw', 'gbn', 'sr'].map((p) => ({ name: NAMES[p], color: colors[p], points: losses.map((l, i) => [l * 100, r[p][i] * 100]), marker: true }));
            chart.set({ xLabel: 'Frame loss probability (%)', yLabel: 'Link efficiency (%)', yMin: 0, yMax: 100, xMin: 0, xMax: 40, xTipLabel: 'loss ', yUnit: '%', yFormat: (v) => String(Math.round(v)), series });
            note = 'As loss grows, Go-Back-N falls fastest because every loss triggers a whole window of repeats; Selective Repeat degrades gently; Stop-and-Wait starts low because it only fills one frame time per round trip.';
          } else {
            const ws = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14];
            const r = FC.sweepWindow(base, ws, 16);
            series = [
              { name: NAMES.sw, color: colors.sw, points: ws.map((w, i) => [w, r.sw[i] * 100]), marker: false, dash: [5, 4] },
              { name: NAMES.gbn, color: colors.gbn, points: ws.map((w, i) => [w, r.gbn[i] * 100]), marker: true },
              { name: NAMES.sr, color: colors.sr, points: ws.map((w, i) => [w, r.sr[i] * 100]), marker: true },
            ];
            chart.set({ xLabel: 'Window size (frames)', yLabel: 'Link efficiency (%)', yMin: 0, yMax: 100, xMin: 1, xMax: 14, xTipLabel: 'window ', yUnit: '%', yFormat: (v) => String(Math.round(v)), vlines: [{ x: 1 + 2 * cfg.Tp, label: 'window needed: 1 + 2a' }], series });
            note = 'Efficiency climbs with the window until it reaches 1 + 2a (the dashed vertical line), then flattens: a bigger window cannot help once the pipe is full. Stop-and-Wait is the dashed horizontal line because it ignores the window.';
          }
          CN.clear(sweepNote);
          sweepNote.appendChild(CN.note('info', note));
          sweepStatus.textContent = 'Done in ' + Math.round(performance.now() - t0) + ' ms.';
        }, 20);
      }

      page.appendChild(h('div', { class: 'workbench' }, controls, stage));
      page.appendChild(CN.section('Compare the protocols', 'Averages over many random runs', sweepPanel));
      page.appendChild(CN.section('How it works', 'Short notes for revision', h('div', { class: 'stage', style: 'gap:10px' },
        CN.theory('Stop-and-Wait', '<ul><li>Send one frame, start a timer, wait for its ACK. If the ACK does not come before the timer expires, send the same frame again.</li><li>Receiver uses frame numbers (0 and 1 alternately in a real protocol) to tell a new frame from a duplicate caused by a lost ACK.</li><li>Efficiency = 1 / (1 + 2a) where a = Tp / Tf. When the link is long compared to the frame, the sender is idle almost all the time.</li></ul>'),
        CN.theory('Go-Back-N', '<ul><li>The sender may have up to W frames outstanding. ACKs are cumulative: "ACK n" means everything before n arrived.</li><li>The receiver only accepts the next expected frame. Anything later is discarded and the last ACK is repeated.</li><li>When the timer for the oldest frame fires, the sender goes back and resends that frame and every frame after it.</li><li>Needs a window of at most 2<sup>k</sup> &minus; 1 with k-bit sequence numbers. Simple receiver, wasteful on lossy links.</li></ul>'),
        CN.theory('Selective Repeat', '<ul><li>Receiver has its own window and buffers frames that arrive out of order. It acknowledges each frame individually.</li><li>Every sent frame has its own timer; only the frame whose timer fires is resent.</li><li>Needs a window of at most 2<sup>k&minus;1</sup> with k-bit sequence numbers, or old duplicates can be mistaken for new frames.</li><li>Best use of the link on lossy channels, at the cost of buffers and a more complex receiver.</li></ul>'),
        CN.theory('Reading the efficiency numbers', '<ul><li>Efficiency (utilisation) = time spent sending useful frames / total time.</li><li>Ideal with no loss: Stop-and-Wait 1/(1+2a); sliding window min(1, W/(1+2a)).</li><li>With frame loss probability p and a large window: Selective Repeat about 1 &minus; p; Go-Back-N about (1 &minus; p)/(1 + 2ap); Stop-and-Wait about (1 &minus; p)/(1 + 2a).</li></ul>'))));

      onConfig();
      // start with a short replay so the page opens with motion that explains itself
      if (res.finish !== null) { playhead = 0; render(0, true); setPlaying(true); }
      return { destroy() { loop.stop(); clearTimeout(sweepTimer); } };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
