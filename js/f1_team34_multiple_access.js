/* ==========================================================================
   Tab: Multiple access  (Unit 3, Data Link Layer)
   Pure ALOHA, Slotted ALOHA, CSMA (1-persistent, non-persistent, p-persistent)
   and CSMA/CD on a shared channel.

   Part 1 - two simulators (no DOM):
     * MAC.createSim()      a live model with N stations, queues of one frame,
                            real random back-off. Drives the animated timeline.
     * MAC.throughputPoint() a "Poisson offered load" model that matches the
                            textbook analysis, used to draw throughput curves and
                            check them against the formulas.
   Part 2 - the interface.

   Time is counted in minislots. One minislot is the one-way propagation delay,
   so a frame of L minislots has a = 1 / L (propagation delay / frame time).
   ========================================================================== */
(function (root) {
  'use strict';
  const CN = (root.CN = root.CN || {});
  const MAC = (CN.multipleAccess = {});

  MAC.PROTOCOLS = [
    { id: 'aloha', name: 'Pure ALOHA' },
    { id: 'slotted', name: 'Slotted ALOHA' },
    { id: 'csma1', name: '1-persistent CSMA' },
    { id: 'csmanp', name: 'Non-persistent CSMA' },
    { id: 'csmapp', name: 'p-persistent CSMA' },
    { id: 'csmacd', name: 'CSMA/CD' },
  ];
  MAC.name = (id) => MAC.PROTOCOLS.find((p) => p.id === id).name;
  const CD_OCCUPANCY = 3; // minislots a colliding CSMA/CD transmission lasts (detect + jam)

  /* ======================================================================
     Textbook formulas: throughput S (frames per frame time) for offered load G
     ====================================================================== */
  MAC.theory = {
    aloha: (G) => G * Math.exp(-2 * G),
    slotted: (G) => G * Math.exp(-G),
    // slotted versions from Kleinrock and Tobagi (the minislot model below matches these)
    csmanp: (G, a) => (a * G * Math.exp(-a * G)) / (1 - Math.exp(-a * G) + a),
    csma1: (G, a) => (G * Math.exp(-G * (1 + a)) * (1 + a - Math.exp(-a * G))) / ((1 + a) * (1 - Math.exp(-a * G)) + a * Math.exp(-G * (1 + a))),
  };
  MAC.hasTheory = (id) => id in MAC.theory;

  /* ======================================================================
     MODEL A: offered load G is a Poisson stream of attempts (infinite stations)
     ====================================================================== */
  MAC.throughputPoint = function (protocol, G, o) {
    o = Object.assign({ L: 10, p: 0.1, frames: 8000, seed: 1 }, o);
    const rng = CN.makeRng(o.seed);
    const L = o.L;
    if (protocol === 'aloha') {
      // a frame survives if nobody else starts within one frame time before or after it
      const times = [];
      let t = rng.exp(G);
      while (t < o.frames) { times.push(t); t += rng.exp(G); }
      let ok = 0;
      for (let i = 0; i < times.length; i++) {
        const before = i === 0 ? Infinity : times[i] - times[i - 1];
        const after = i === times.length - 1 ? Infinity : times[i + 1] - times[i];
        if (before >= 1 && after >= 1) ok++;
      }
      return ok / o.frames;
    }
    if (protocol === 'slotted') {
      let ok = 0;
      for (let s = 0; s < o.frames; s++) if (rng.poisson(G) === 1) ok++;
      return ok / o.frames;
    }
    // CSMA family, minislot by minislot
    const M = o.frames * L;
    const lam = G / L;
    let busyUntil = -1; let wait = 0; let succ = 0;
    for (let k = 0; k < M; k++) {
      const n = rng.poisson(lam);
      if (k <= busyUntil) { if (protocol !== 'csmanp') wait += n; continue; }
      let m;
      if (protocol === 'csmanp') m = n;
      else if (protocol === 'csmapp') { const c = wait + n; m = rng.binomial(c, o.p); wait = c - m; }
      else { m = wait + n; wait = 0; }
      if (m === 1) { succ++; busyUntil = k + L; }
      else if (m > 1) busyUntil = k + (protocol === 'csmacd' ? CD_OCCUPANCY : L);
    }
    return succ / o.frames;
  };

  /* ======================================================================
     MODEL B: a live network of N stations
     Station cell codes used for drawing:
       0 idle   1 has a frame, waiting/sensing   2 sending (not finished)
       3 sent OK   4 collided   5 backing off
     ====================================================================== */
  MAC.CAP = 2048;

  MAC.createSim = function (cfg) {
    const o = Object.assign({ protocol: 'aloha', N: 5, L: 10, load: 0.5, p: 0.2, seed: 1, maxAttempts: 16 }, cfg);
    const L = o.L; const N = o.N; const CAP = MAC.CAP;
    const rng = CN.makeRng(o.seed);
    const proto = o.protocol;
    const isCsma = proto.indexOf('csma') === 0;
    const pArr = Math.min(1, o.load / (N * L));
    const st = [];
    for (let i = 0; i < N; i++) st.push({ state: 0, fails: 0, born: 0, txStart: 0, txLeft: 0, collided: false, bo: 0, delivered: 0 }); // state: 0 idle 1 ready 2 tx 3 backoff
    const hist = new Uint8Array(N * CAP);
    const stats = { k: 0, generated: 0, attempts: 0, delivered: 0, collidedFrames: 0, dropped: 0, delaySum: 0 };
    let busyUntil = -1; // channel sensed busy at minislots <= busyUntil

    const setHist = (i, k, c) => { hist[i * CAP + (k % CAP)] = c; };

    function finish(i, k) {
      const s = st[i];
      const code = s.collided ? 4 : 3;
      for (let j = s.txStart; j <= k; j++) setHist(i, j, code);
      if (!s.collided) {
        stats.delivered++; s.delivered++; stats.delaySum += (k + 1 - s.born) / L; s.state = 0; s.fails = 0;
        return;
      }
      stats.collidedFrames++;
      s.fails++;
      if (s.fails >= o.maxAttempts) { stats.dropped++; s.state = 0; s.fails = 0; return; }
      if (proto === 'csmacd') s.bo = rng.int(0, Math.pow(2, Math.min(s.fails, 10)) - 1) * 2 + 1; // binary exponential backoff, slot = 2 minislots
      else s.bo = rng.int(1, Math.pow(2, Math.min(s.fails, 5))) * L;                              // random wait of whole frame times
      s.state = 3;
    }

    function step() {
      const k = stats.k;
      const recorded = new Array(N).fill(false);
      const starters = [];

      // 1. new frames appear at idle stations
      for (let i = 0; i < N; i++) {
        const s = st[i];
        if (s.state === 0 && rng() < pArr) { s.state = 1; s.born = k; stats.generated++; }
      }
      // 2. back-off timers count down
      for (let i = 0; i < N; i++) {
        const s = st[i];
        if (s.state === 3) { s.bo--; if (s.bo <= 0) s.state = 1; }
      }
      // 3. stations that are ready decide whether to start now
      const sensedBusy = k <= busyUntil;
      for (let i = 0; i < N; i++) {
        const s = st[i];
        if (s.state !== 1) continue;
        if (proto === 'aloha') starters.push(i);
        else if (proto === 'slotted') { if (k % L === 0) starters.push(i); }
        else if (!sensedBusy) {
          if (proto === 'csmapp') { if (rng() < o.p) starters.push(i); } else starters.push(i);
        } else if (proto === 'csmanp') {
          s.state = 3; s.bo = rng.int(Math.ceil(L / 2), 2 * L); // busy: wait a random time instead of listening continuously
        }
      }
      starters.forEach((i) => {
        const s = st[i];
        s.state = 2; s.txStart = k; s.txLeft = L; s.collided = false; stats.attempts++;
      });
      if (starters.length) busyUntil = Math.max(busyUntil, k + L);

      // 4. anything on the wire together is a collision
      const active = [];
      for (let i = 0; i < N; i++) if (st[i].state === 2) active.push(i);
      if (active.length >= 2) {
        active.forEach((i) => { st[i].collided = true; });
        if (proto === 'csmacd') {
          active.forEach((i) => { if (st[i].txStart === k) st[i].txLeft = Math.min(st[i].txLeft, CD_OCCUPANCY); });
          busyUntil = k + CD_OCCUPANCY;
        }
      }
      // 5. sending continues for one more minislot
      active.forEach((i) => {
        const s = st[i];
        setHist(i, k, 2); recorded[i] = true;
        s.txLeft--;
        if (s.txLeft <= 0) finish(i, k);
      });
      // 6. record what everyone else was doing
      for (let i = 0; i < N; i++) {
        if (recorded[i]) continue;
        const s = st[i];
        setHist(i, k, s.state === 1 ? 1 : s.state === 3 ? 5 : 0);
      }
      stats.k++;
    }

    function jain() {
      let s1 = 0; let s2 = 0;
      st.forEach((s) => { s1 += s.delivered; s2 += s.delivered * s.delivered; });
      return s2 === 0 ? 1 : (s1 * s1) / (N * s2);
    }

    return {
      cfg: o, stations: st, stats,
      step,
      run(n) { for (let i = 0; i < n; i++) step(); },
      code(i, k) { return k < 0 || k >= stats.k ? 0 : hist[i * CAP + (k % CAP)]; },
      summary() {
        const frames = Math.max(1e-9, stats.k / L);
        return {
          elapsed: frames,
          S: stats.delivered / frames,
          G: stats.attempts / frames,
          newLoad: stats.generated / frames,
          collidedShare: stats.attempts ? stats.collidedFrames / stats.attempts : 0,
          delay: stats.delivered ? stats.delaySum / stats.delivered : 0,
          fairness: jain(),
          dropped: stats.dropped,
          delivered: stats.delivered,
        };
      },
    };
  };

  /* Run every protocol on the same traffic and compare */
  MAC.compare = function (base, minislots) {
    return MAC.PROTOCOLS.map((p) => {
      const sim = MAC.createSim(Object.assign({}, base, { protocol: p.id }));
      sim.run(minislots);
      return Object.assign({ id: p.id, name: p.name }, sim.summary());
    });
  };

  /* Sweep offered load for the throughput chart */
  MAC.sweep = function (protocol, Gs, o) {
    return Gs.map((G, i) => MAC.throughputPoint(protocol, G, Object.assign({}, o, { seed: (o.seed || 1) * 100 + i })));
  };

  if (typeof document === 'undefined') return;

  /* ======================================================================
     USER INTERFACE
     ====================================================================== */
  const h = CN.h;

  const INFO = {
    aloha: 'Send the moment a frame is ready, never listen. If two frames overlap even by a hair, both are lost, so a frame is exposed for two frame times. Best case 18.4% of the channel, at G = 0.5.',
    slotted: 'Time is cut into frame-sized slots and everyone must start on a slot boundary. Frames now either collide completely or not at all, so the exposure halves to one frame time. Best case 36.8%, at G = 1.',
    csma1: 'Listen before sending. If the channel is idle, send; if it is busy, keep listening and send the instant it goes idle. Everyone who waited jumps in together, so busy periods tend to end in a collision.',
    csmanp: 'Listen before sending. If the channel is busy, do not keep listening: wait a random time and try again. Fewer pile-ups, at the price of some idle time.',
    csmapp: 'Listen before sending. When the channel is idle, send with probability p; otherwise wait one tiny slot and listen again. A small p spreads out the waiting stations.',
    csmacd: 'Like 1-persistent CSMA, but a sender keeps listening while it sends. On a collision it stops after a short jam signal and backs off for a random number of slots that doubles with each failure (binary exponential backoff). This is Ethernet (IEEE 802.3).',
  };

  const COLORS = { aloha: 's1', slotted: 's2', csma1: 's3', csmanp: 's4', csmapp: 's5', csmacd: 's7' };

  function drawTimeline(canvas, sim, view) {
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(320, canvas.parentNode.clientWidth || 700);
    const N = sim.cfg.N; const L = sim.cfg.L;
    const rowH = 24; const headH = 26; const labelW = 72;
    const H = headH + (N + 1) * rowH + 10;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const surface = CN.cssVar('--surface'); const ink = CN.cssVar('--ink'); const ink2 = CN.cssVar('--ink-2'); const ink3 = CN.cssVar('--ink-3');
    const rule = CN.cssVar('--rule'); const good = CN.cssVar('--good'); const bad = CN.cssVar('--bad'); const info = CN.cssVar('--s1'); const warn = CN.cssVar('--s4');
    const font = '12px "Chivo", system-ui, sans-serif';
    ctx.font = font;

    const plotW = W - labelW - 10;
    const cw = plotW / view;
    const kEnd = sim.stats.k; // exclusive
    const kStart = kEnd - view;

    // frame-time grid and labels
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (let k = Math.ceil(Math.max(0, kStart) / L) * L; k < kEnd; k += L) {
      const x = labelW + (k - kStart) * cw;
      ctx.strokeStyle = rule; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, headH - 4); ctx.lineTo(Math.round(x) + 0.5, H - 6); ctx.stroke();
      if ((k / L) % 2 === 0) { ctx.fillStyle = ink3; ctx.fillText(String(k / L), x + 3, headH / 2); }
    }
    ctx.fillStyle = ink3; ctx.textAlign = 'right'; ctx.fillText('frame times', labelW - 8, headH / 2);

    function cell(row, k, code) {
      const x = labelW + (k - kStart) * cw; const y = headH + row * rowH + 3; const w = Math.ceil(cw) + 0.5; const hh = rowH - 6;
      if (code === 0) return;
      if (code === 1) { ctx.fillStyle = warn; ctx.globalAlpha = 0.28; ctx.fillRect(x, y + hh / 2 - 3, w, 6); ctx.globalAlpha = 1; return; }
      if (code === 5) { ctx.fillStyle = ink3; ctx.globalAlpha = 0.35; ctx.fillRect(x, y + hh / 2 - 1.5, w, 3); ctx.globalAlpha = 1; return; }
      ctx.fillStyle = code === 3 ? good : code === 4 ? bad : info;
      ctx.fillRect(x, y, w, hh);
    }

    // channel row (derived from the stations)
    ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.font = '600 12px "Chivo", system-ui, sans-serif';
    ctx.fillText('Channel', labelW - 8, headH + rowH / 2);
    ctx.font = font;
    for (let k = Math.max(0, kStart); k < kEnd; k++) {
      let any = 0; let col = 0;
      for (let i = 0; i < N; i++) { const c = sim.code(i, k); if (c === 4) col = 4; else if (c === 3 || c === 2) any = 1; }
      if (col === 4) cell(0, k, 4); else if (any) cell(0, k, 3);
    }
    // station rows
    for (let i = 0; i < N; i++) {
      ctx.fillStyle = ink2; ctx.textAlign = 'right'; ctx.fillText('Station ' + (i + 1), labelW - 8, headH + (i + 1) * rowH + rowH / 2);
      ctx.strokeStyle = rule; ctx.beginPath(); ctx.moveTo(labelW, headH + (i + 1) * rowH + 0.5); ctx.lineTo(labelW + plotW, headH + (i + 1) * rowH + 0.5); ctx.stroke();
      for (let k = Math.max(0, kStart); k < kEnd; k++) cell(i + 1, k, sim.code(i, k));
    }
    // outline marking "now"
    ctx.strokeStyle = CN.cssVar('--accent'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(labelW + plotW + 1, headH - 4); ctx.lineTo(labelW + plotW + 1, H - 6); ctx.stroke();
  }

  CN.registerTab({
    id: 'access',
    group: { layer: 2, name: 'Data Link' },
    title: 'Multiple access',
    mount(page) {
      page.appendChild(CN.pageHead({
        title: 'Multiple access: sharing one channel',
        lead: 'Several stations share a single wire. Watch them collide, back off and retry under ALOHA, CSMA and CSMA/CD, then see how throughput changes as the traffic grows.',
        units: [{ unit: 3, name: 'Data Link Layer', co: 3, level: 'Understand' }],
        topics: ['Aloha, Slotted Aloha', 'CSMA, CSMA-CD', 'IEEE 802.3 (Ethernet)'],
      }));

      /* ---- controls ---- */
      const proto = CN.select({ label: 'Protocol', options: MAC.PROTOCOLS.map((p) => ({ value: p.id, label: p.name })), value: 'aloha', onChange: onConfig });
      const stations = CN.slider({ label: 'Stations', min: 2, max: 10, value: 5, onInput: onConfig });
      const load = CN.slider({ label: 'New traffic', min: 0.05, max: 3, step: 0.05, value: 0.6, format: (v) => v.toFixed(2) + ' frames per frame time', onInput: onConfig, hint: 'All stations together. 1.0 would fill the channel if nothing collided.' });
      const aSel = CN.segmented({ label: 'Propagation delay', options: [{ value: 5, label: 'a = 0.2' }, { value: 10, label: 'a = 0.1' }, { value: 20, label: 'a = 0.05' }], value: 10, onChange: onConfig });
      const pSlider = CN.slider({ label: 'Send probability p', min: 0.05, max: 1, step: 0.05, value: 0.2, format: (v) => v.toFixed(2), onInput: onConfig });
      const seed = CN.textField({ label: 'Random seed', value: '11', mono: true, onInput: onConfig });
      const speed = CN.slider({ label: 'Speed', min: 1, max: 12, value: 4, format: (v) => v + 'x' });
      const btnPlay = CN.button('Pause', { kind: 'primary' });
      const btnStep = CN.button('Step one frame');
      const btnReset = CN.button('Restart');

      const infoBox = h('div', { class: 'note' });
      const controls = h('div', { class: 'controls' },
        h('h3', null, 'Protocol'), proto.el, pSlider.el,
        h('h3', null, 'Traffic'), stations.el, load.el,
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Channel length'), aSel.el,
          h('span', { class: 'field-hint' }, 'a = propagation delay / frame time. Longer wires make carrier sensing less reliable.')),
        seed.el, speed.el,
        h('div', { class: 'row tight' }, btnPlay, btnStep, btnReset));

      /* ---- live timeline ---- */
      const canvas = h('canvas', { role: 'img', 'aria-label': 'Timeline of transmissions by each station' });
      const tlKey = h('div', { class: 'key', style: 'margin-top:10px' },
        h('span', null, h('i', { style: 'background: var(--good)' }), 'delivered'),
        h('span', null, h('i', { style: 'background: var(--bad)' }), 'collided'),
        h('span', null, h('i', { style: 'background: var(--s1)' }), 'sending'),
        h('span', null, h('i', { style: 'background: var(--s4); opacity:.35; height:6px' }), 'waiting to send'),
        h('span', null, h('i', { style: 'background: var(--ink-3); opacity:.4; height:4px' }), 'backing off'));
      const ro = {
        S: CN.readout('Throughput S'), G: CN.readout('Attempts G'), coll: CN.readout('Attempts that collided'),
        delay: CN.readout('Mean delay'), fair: CN.readout('Fairness'), theory: CN.readout('Textbook S at this G'),
      };
      const compareBox = h('div');
      const btnCompare = CN.button('Compare all protocols', { onClick: runCompare });
      const compareStatus = h('span', { class: 'field-hint' });

      const stage = h('div', { class: 'stage' },
        infoBox,
        CN.panel('Channel timeline', 'Time runs left to right and the newest moment is at the right edge. Each coloured block is one frame on the wire.', h('div', { class: 'timeline' }, canvas), tlKey),
        h('div', { class: 'readouts' }, ro.S.el, ro.G.el, ro.coll.el, ro.delay.el, ro.fair.el, ro.theory.el),
        CN.panel('Same traffic, every protocol', 'Runs all six protocols for about 200 frame times with the traffic and channel length chosen on the left.',
          h('div', { class: 'row', style: 'margin-bottom:10px' }, btnCompare, compareStatus), compareBox));

      /* ---- throughput chart ---- */
      const chartHost = h('div');
      const chart = new CN.Chart(chartHost, { height: 380, label: 'Throughput against offered load' });
      const checks = {};
      const checkRow = h('div', { class: 'row' });
      MAC.PROTOCOLS.forEach((p) => {
        checks[p.id] = CN.check({ label: p.name, checked: ['aloha', 'slotted', 'csma1', 'csmanp', 'csmacd'].includes(p.id), onChange: runCurves });
        checkRow.appendChild(checks[p.id].el);
      });
      const curveStatus = h('span', { class: 'field-hint' });
      const curveNote = h('div');
      const curvePanel = CN.panel('Throughput against offered load', 'Lines are the textbook formulas. Dots are simulated with the channel length and p chosen above. G is how many attempts (new frames and retries) are made per frame time; S is how many get through.',
        checkRow, h('div', { class: 'row', style: 'margin:10px 0' }, CN.button('Run simulation', { onClick: runCurves }), curveStatus), chartHost, h('div', { style: 'margin-top:12px' }, curveNote));

      /* ---- live state ---- */
      let sim = null; let playing = true; let acc = 0; let curveTimer = 0;
      const VIEW = 160;
      const loop = CN.makeLoop((dt) => {
        if (!sim) return;
        acc += dt * 30 * speed.get();
        const n = Math.floor(acc);
        if (n > 0) { acc -= n; sim.run(Math.min(n, 400)); draw(); }
      });

      function currentCfg(extra) {
        return Object.assign({ protocol: proto.get(), N: stations.get(), L: aSel.get(), load: load.get(), p: pSlider.get(), seed: parseInt(seed.get(), 10) || 1 }, extra);
      }

      function draw() {
        drawTimeline(canvas, sim, VIEW);
        const s = sim.summary(); const c = sim.cfg;
        ro.S.set(CN.fmt(s.S, 3), sim.stats.delivered + ' frames delivered');
        ro.G.set(CN.fmt(s.G, 3), 'new traffic ' + CN.fmt(s.newLoad, 2));
        ro.coll.set(CN.pct(s.collidedShare, 0), sim.stats.dropped ? sim.stats.dropped + ' given up' : '');
        ro.delay.set(sim.stats.delivered ? CN.fmt(s.delay, 1) + ' frame times' : '-');
        ro.fair.set(sim.stats.delivered ? CN.fmt(s.fairness, 2) : '-', '1.00 = everyone equal');
        if (MAC.hasTheory(c.protocol) && s.G > 0) ro.theory.set(CN.fmt(MAC.theory[c.protocol](s.G, 1 / c.L), 3), 'formula, infinite stations');
        else ro.theory.set('-', c.protocol === 'csmacd' ? 'no simple formula' : c.protocol === 'csmapp' ? 'depends on p' : '');
      }

      function onConfig() {
        pSlider.setDisabled(proto.get() !== 'csmapp');
        CN.setNote(infoBox, 'info', INFO[proto.get()]);
        sim = MAC.createSim(currentCfg());
        sim.run(VIEW);
        acc = 0;
        draw();
        scheduleCurves();
        CN.clear(compareBox);
      }

      btnPlay.addEventListener('click', () => {
        playing = !playing;
        btnPlay.textContent = playing ? 'Pause' : 'Play';
        if (playing) loop.start(); else loop.stop();
      });
      btnStep.addEventListener('click', () => {
        playing = false; loop.stop(); btnPlay.textContent = 'Play';
        sim.run(sim.cfg.L); draw();
      });
      btnReset.addEventListener('click', () => { onConfig(); });

      /* ---- compare table ---- */
      function runCompare() {
        compareStatus.textContent = 'Running...';
        setTimeout(() => {
          const t0 = performance.now();
          const res = MAC.compare(currentCfg(), sim.cfg.L * 200);
          const maxS = Math.max(0.01, ...res.map((r) => r.S));
          CN.clear(compareBox);
          compareBox.appendChild(h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
            h('thead', null, h('tr', null, h('th', null, 'Protocol'), h('th', null, 'Throughput S'), h('th', { class: 'num' }, 'Attempts that collided'), h('th', { class: 'num' }, 'Mean delay (frame times)'), h('th', { class: 'num' }, 'Fairness'))),
            h('tbody', null, res.map((r) => h('tr', { class: r.S === maxS ? 'ok' : '' },
              h('td', null, r.name + (r.S === maxS ? ' (best)' : '')),
              h('td', null, h('div', { style: 'display:flex;align-items:center;gap:8px' },
                h('div', { style: 'height:10px;border-radius:2px;background:var(--' + COLORS[r.id] + ');width:' + Math.max(2, (r.S / maxS) * 120) + 'px' }),
                h('span', { class: 'mono' }, CN.fmt(r.S, 3)))),
              h('td', { class: 'num' }, CN.pct(r.collidedShare, 0)), h('td', { class: 'num' }, r.delivered ? CN.fmt(r.delay, 1) : '-'), h('td', { class: 'num' }, CN.fmt(r.fairness, 2))))))));
          compareStatus.textContent = 'Done in ' + Math.round(performance.now() - t0) + ' ms.';
        }, 20);
      }

      /* ---- curves ---- */
      function scheduleCurves() { clearTimeout(curveTimer); curveTimer = setTimeout(runCurves, 500); }
      function runCurves() {
        clearTimeout(curveTimer);
        curveStatus.textContent = 'Running...';
        setTimeout(() => {
          const t0 = performance.now();
          const L = aSel.get(); const a = 1 / L; const p = pSlider.get();
          const Gs = [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
          const fine = []; for (let g = 0.02; g <= 8.001; g += 0.06) fine.push(g);
          const series = [];
          MAC.PROTOCOLS.forEach((pr) => {
            if (!checks[pr.id].get()) return;
            if (MAC.hasTheory(pr.id)) {
              series.push({ name: pr.name, color: COLORS[pr.id], type: 'line', marker: false, points: fine.map((g) => [g, MAC.theory[pr.id](g, a)]) });
              const sim1 = MAC.sweep(pr.id, Gs, { L, p, frames: 4000, seed: 5 });
              series.push({ name: pr.name + ' (simulated)', noLegend: true, color: COLORS[pr.id], type: 'scatter', points: Gs.map((g, i) => [g, sim1[i]]) });
            } else {
              const sim1 = MAC.sweep(pr.id, Gs, { L, p, frames: 4000, seed: 5 });
              series.push({ name: pr.name + (pr.id === 'csmapp' ? ' (p = ' + p.toFixed(2) + ')' : ''), color: COLORS[pr.id], type: 'line', dash: [5, 4], marker: true, points: Gs.map((g, i) => [g, sim1[i]]) });
            }
          });
          chart.set({ xLabel: 'Offered load G (attempts per frame time)', yLabel: 'Throughput S (frames per frame time)', yMin: 0, yMax: 1, xMin: 0, xMax: 8, xTipLabel: 'G = ', yFormat: (v) => String(Math.round(v * 100) / 100), series });
          CN.clear(curveNote);
          curveNote.appendChild(CN.note('info', 'Pure ALOHA tops out near 0.18 and Slotted ALOHA near 0.37, then both collapse as load grows. Carrier sensing keeps the channel useful at heavy load because stations defer instead of colliding; the shorter the wire (small a), the better it works. CSMA/CD recovers fastest from collisions because it stops sending as soon as it notices one.'));
          curveStatus.textContent = 'Done in ' + Math.round(performance.now() - t0) + ' ms.';
        }, 20);
      }

      page.appendChild(h('div', { class: 'workbench' }, controls, stage));
      page.appendChild(CN.section('Throughput curves', 'Theory against simulation', curvePanel));
      page.appendChild(CN.section('How it works', 'Short notes for revision', h('div', { class: 'stage', style: 'gap:10px' },
        CN.theory('ALOHA and Slotted ALOHA', '<ul><li>Pure ALOHA: transmit whenever a frame is ready. A frame is hit if any other frame starts within one frame time before or after it, so the vulnerable period is <b>2T</b>. S = G&middot;e<sup>&minus;2G</sup>, maximum 0.184 at G = 0.5.</li><li>Slotted ALOHA: start only at slot boundaries, so the vulnerable period is <b>T</b>. S = G&middot;e<sup>&minus;G</sup>, maximum 0.368 at G = 1.</li><li>After a collision each station waits a random time before retrying, so they do not collide again immediately.</li></ul>'),
        CN.theory('CSMA (carrier sense multiple access)', '<ul><li>Listen first, talk later. The weakness is propagation delay: a station cannot hear a frame that started less than <b>a</b> frame times ago, so two stations can still start together.</li><li><b>1-persistent</b>: send as soon as the channel is idle (probability 1). <b>Non-persistent</b>: if busy, wait a random time and listen again. <b>p-persistent</b>: when idle, send with probability p.</li><li>CSMA does not detect collisions, so a collided frame still occupies the channel for a full frame time.</li></ul>'),
        CN.theory('CSMA/CD and Ethernet (IEEE 802.3)', '<ul><li>CSMA with <b>collision detection</b>: the sender keeps listening while it transmits. If the signal on the wire differs from what it is sending, it stops and sends a short jam signal.</li><li>Back-off is <b>binary exponential</b>: after the n-th collision, wait a random number of slot times between 0 and 2<sup>n</sup> &minus; 1.</li><li>For detection to work, the frame must last at least twice the propagation delay, which is why Ethernet has a minimum frame size.</li><li>Rough efficiency at heavy load: 1 / (1 + 5a).</li></ul>'))));

      onConfig();
      loop.start();
      return { destroy() { loop.stop(); clearTimeout(curveTimer); } };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
