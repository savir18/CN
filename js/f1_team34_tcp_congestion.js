/* ==========================================================================
   Tab: TCP congestion control  (Unit 6, Transport Layer)
   Part 1 - models (no DOM):
     * TCP.windowTrace()        the textbook round-by-round cwnd model for Tahoe
                                and Reno: slow start, congestion avoidance, loss.
     * TCP.simulateBottleneck() a closed-loop model: several TCP flows share one
                                link with a buffer (drop-tail or RED). cwnd,
                                queue length, delay and loss all feed back into
                                each other, so the saw-tooth appears by itself.
   Part 2 - the interface.
   ========================================================================== */
(function (root) {
  'use strict';
  const CN = (root.CN = root.CN || {});
  const TCP = (CN.tcpCongestion = {});

  /* ======================================================================
     MODEL 1: cwnd per round-trip time
     events: { round: 'dup' | 'timeout' }   (loss detected for the window sent in that round)
     ====================================================================== */
  TCP.windowTrace = function (cfg) {
    const o = Object.assign({ variant: 'reno', rounds: 24, ssthresh: 16, events: {}, maxCwnd: 1000 }, cfg);
    let cwnd = 1; let ssthresh = o.ssthresh;
    const rows = [];
    for (let r = 0; r <= o.rounds; r++) {
      const phase = cwnd < ssthresh ? 'slow start' : 'congestion avoidance';
      const ev = o.events[r] || null;
      rows.push({ round: r, cwnd, ssthresh, phase, event: ev });
      if (r === o.rounds) break;
      if (ev === 'timeout') { ssthresh = Math.max(Math.floor(cwnd / 2), 2); cwnd = 1; }
      else if (ev === 'dup') {
        ssthresh = Math.max(Math.floor(cwnd / 2), 2);
        cwnd = o.variant === 'tahoe' ? 1 : ssthresh; // Reno: fast recovery, carry on linearly from half
      } else if (cwnd < ssthresh) cwnd = Math.min(cwnd * 2, ssthresh); // slow start doubles every RTT
      else cwnd += 1; // congestion avoidance adds one segment per RTT
      cwnd = Math.min(cwnd, o.maxCwnd);
    }
    const segments = rows.reduce((s, x) => s + x.cwnd, 0);
    return { rows, segments };
  };

  /* Turn "random loss per round" into a concrete event list (scripted events win) */
  TCP.makeEvents = function (scripted, rounds, pLoss, seed) {
    const ev = Object.assign({}, scripted);
    if (pLoss > 0) {
      const rng = CN.makeRng(seed || 1);
      for (let r = 1; r < rounds; r++) {
        const roll = rng(); const kind = rng();
        if (ev[r] === undefined && roll < pLoss) ev[r] = kind < 0.8 ? 'dup' : 'timeout';
      }
    }
    return ev;
  };

  /* ======================================================================
     MODEL 2: flows sharing a bottleneck link
     capacity in packets per second, buffer in packets, rtt in seconds.
     ====================================================================== */
  TCP.simulateBottleneck = function (cfg) {
    const o = Object.assign({ capacity: 1000, buffer: 100, queue: 'droptail', variant: 'reno', flows: [{ rtt: 0.1, start: 0 }], duration: 60, seed: 1, dt: 0.001, sampleEvery: 50, red: { minFrac: 0.25, maxFrac: 0.75, maxp: 0.1, wq: 0.002 } }, cfg);
    const C = o.capacity; const B = o.buffer; const dt = o.dt;
    const rng = CN.makeRng(o.seed);
    const steps = Math.round(o.duration / dt);
    const warm = Math.floor(steps * 0.2); // ignore the start-up transient in the averages
    const half = Math.floor(steps * 0.5);
    const minth = o.red.minFrac * B; const maxth = o.red.maxFrac * B;

    const fl = o.flows.map((f) => ({ R: f.rtt, start: f.start, w: 1, ssthresh: 1e9, pendingAt: null, cooldown: -1, served: 0, servedHalf: 0, wSum: 0, wN: 0, losses: 0, x: 0 }));
    let q = 0; let avg = 0;
    const samples = { t: [], q: [], avg: [], w: fl.map(() => []) };
    let servedTot = 0; let dropTot = 0; let sentTot = 0; let qSum = 0; let qSq = 0; let nWin = 0;

    for (let step = 0; step < steps; step++) {
      const t = step * dt;
      // 1. how fast does each active flow send? rate = window / round-trip time (which includes queueing delay)
      let sumX = 0;
      fl.forEach((f) => {
        if (t >= f.start) { f.x = f.w / (f.R + q / C); sumX += f.x; } else f.x = 0;
      });
      const A = sumX * dt;

      // 2. queue management decides what is dropped before it can join the queue
      let early = 0;
      if (o.queue === 'red') {
        const wq = 1 - Math.pow(1 - o.red.wq, Math.max(A, 0.001)); // one EWMA update per arriving packet
        avg += wq * (q - avg);
        let pb = 0;
        if (avg >= maxth) pb = Math.min(1, o.red.maxp + (1 - o.red.maxp) * (avg - maxth) / maxth);
        else if (avg > minth) pb = o.red.maxp * (avg - minth) / (maxth - minth);
        early = A * pb;
      }
      let qn = q + A - early;
      const served = Math.min(qn, C * dt);
      qn -= served;
      let overflow = 0;
      if (qn > B) { overflow = qn - B; qn = B; }
      q = qn;
      const drops = early + overflow;

      // 3. every dropped packet may trigger a loss reaction one round trip later
      fl.forEach((f) => {
        if (f.x <= 0) return;
        const share = sumX > 0 ? f.x / sumX : 0;
        const d = drops * share;
        if (d > 0 && f.pendingAt === null && t >= f.cooldown && rng() < 1 - Math.exp(-d)) f.pendingAt = t + f.R + q / C;
        if (f.pendingAt !== null && t >= f.pendingAt) {
          f.ssthresh = Math.max(f.w / 2, 2);
          f.w = o.variant === 'tahoe' ? 1 : f.ssthresh;
          f.pendingAt = null; f.cooldown = t + f.R + q / C; f.losses++;
        }
        // 4. window growth: one segment per ACK in slow start, 1/w per ACK in congestion avoidance
        const acks = f.x * dt;
        f.w += f.w < f.ssthresh ? acks : acks / f.w;
        if (f.w > 100000) f.w = 100000;
      });

      // bookkeeping
      if (step >= warm) {
        servedTot += served; dropTot += drops; sentTot += A; nWin++;
        const dly = q / C; qSum += dly; qSq += dly * dly;
        fl.forEach((f) => { f.wSum += f.w; f.wN++; });
      }
      if (sumX > 0) fl.forEach((f) => { const s = served * (f.x / sumX); f.served += s; if (step >= half) f.servedHalf += s; });
      if (step % o.sampleEvery === 0) {
        samples.t.push(t); samples.q.push(q); samples.avg.push(avg);
        fl.forEach((f, i) => samples.w[i].push(f.w));
      }
    }

    const winTime = nWin * dt;
    const meanDelay = nWin ? qSum / nWin : 0;
    const jitter = nWin ? Math.sqrt(Math.max(0, qSq / nWin - meanDelay * meanDelay)) : 0;
    const halfTime = (steps - half) * dt;
    const thr = fl.map((f) => f.servedHalf / halfTime);
    const s1 = thr.reduce((a, b) => a + b, 0); const s2 = thr.reduce((a, b) => a + b * b, 0);
    return {
      cfg: o, samples,
      stats: {
        utilization: winTime ? servedTot / (C * winTime) : 0,
        delayMs: meanDelay * 1000, jitterMs: jitter * 1000,
        lossRate: sentTot ? dropTot / sentTot : 0,
        throughput: thr, // packets per second per flow over the second half of the run
        share: thr.map((x) => (s1 ? x / s1 : 0)),
        fairness: s2 ? (s1 * s1) / (fl.length * s2) : 1,
        meanW: fl.map((f) => (f.wN ? f.wSum / f.wN : 0)),
        losses: fl.map((f) => f.losses),
        bdp: C * o.flows[0].rtt,
      },
    };
  };

  if (typeof document === 'undefined') return;

  /* ======================================================================
     USER INTERFACE
     ====================================================================== */
  const h = CN.h;
  const FLOW_COLORS = ['s1', 's2', 's3', 's4'];
  const EVENT_NAMES = { dup: 'triple duplicate ACK', timeout: 'timeout' };

  /* ---------------------------------------------------------------- Part A: window lab */
  function buildWindowLab() {
    const ssth = CN.slider({ label: 'Initial threshold (ssthresh)', min: 4, max: 32, value: 16, onInput: refresh, hint: 'Slow start ends when cwnd reaches this value.' });
    const rounds = CN.slider({ label: 'Round-trip times to show', min: 12, max: 40, value: 26, onInput: refresh });
    const rand = CN.slider({ label: 'Random loss per round trip', min: 0, max: 25, value: 0, format: (v) => v + '%', onInput: refresh, hint: 'On top of the losses you add below. 80% are duplicate-ACK losses, 20% timeouts.' });
    const seed = CN.textField({ label: 'Random seed', value: '3', mono: true, onInput: refresh });
    const showTh = CN.check({ label: 'Draw ssthresh as dashed lines', checked: false, onChange: refresh });

    let scripted = { 9: 'dup', 17: 'timeout' };
    const evRound = h('input', { type: 'number', min: 1, max: 39, value: 12, 'aria-label': 'Round number for the loss' });
    const evType = h('select', { 'aria-label': 'Kind of loss' }, h('option', { value: 'dup' }, 'Triple duplicate ACK'), h('option', { value: 'timeout' }, 'Timeout'));
    const evList = h('div', { class: 'chips' });
    const addBtn = CN.button('Add loss', { onClick: () => { const r = parseInt(evRound.value, 10); if (r >= 1 && r < rounds.get()) { scripted[r] = evType.value; refresh(); } } });

    const chartHost = h('div');
    const chart = new CN.Chart(chartHost, { height: 330, label: 'Congestion window per round trip' });
    const tableBox = h('div');
    const noteBox = h('div');
    const ro = { tahoe: CN.readout('Tahoe: segments sent'), reno: CN.readout('Reno: segments sent'), gain: CN.readout('Reno ahead by') };

    const controls = h('div', { class: 'controls' },
      h('h3', null, 'Window'), ssth.el, rounds.el,
      h('h3', null, 'Losses'),
      h('div', { class: 'field-hint' }, 'A loss at round r means the window sent in round r is hit.'),
      h('div', { class: 'row tight' }, h('label', { class: 'field', style: 'width:84px' }, h('span', { class: 'field-label' }, 'Round'), evRound), h('label', { class: 'field grow' }, h('span', { class: 'field-label' }, 'Kind'), evType)),
      addBtn, evList, rand.el, seed.el, showTh.el,
      h('div', { class: 'row tight' },
        CN.button('Textbook example', { onClick: () => { scripted = { 9: 'dup', 17: 'timeout' }; ssth.set(16); rounds.set(26); refresh(); } }),
        CN.button('Clear losses', { onClick: () => { scripted = {}; refresh(); } })));

    function refresh() {
      const R = rounds.get();
      Object.keys(scripted).forEach((k) => { if (Number(k) >= R) delete scripted[k]; });
      CN.clear(evList);
      Object.keys(scripted).map(Number).sort((a, b) => a - b).forEach((r) => {
        const chip = h('span', { class: 'chip' }, 'round ' + r + ': ' + EVENT_NAMES[scripted[r]] + ' ');
        const x = h('button', { type: 'button', class: 'btn small', style: 'padding:0 6px;margin-left:4px', 'aria-label': 'Remove loss at round ' + r, onclick: () => { delete scripted[r]; refresh(); } }, '×');
        chip.appendChild(x); evList.appendChild(chip);
      });
      const events = TCP.makeEvents(scripted, R, rand.get() / 100, parseInt(seed.get(), 10) || 1);
      const tahoe = TCP.windowTrace({ variant: 'tahoe', rounds: R, ssthresh: ssth.get(), events });
      const reno = TCP.windowTrace({ variant: 'reno', rounds: R, ssthresh: ssth.get(), events });

      const series = [
        { name: 'Tahoe cwnd', color: 's1', type: 'line', marker: true, points: tahoe.rows.map((x) => [x.round, x.cwnd]) },
        { name: 'Reno cwnd', color: 's2', type: 'line', marker: true, points: reno.rows.map((x) => [x.round, x.cwnd]) },
      ];
      if (showTh.get()) {
        series.push({ name: 'Tahoe ssthresh', color: 's1', type: 'step', dash: [4, 4], width: 1.5, marker: false, points: tahoe.rows.map((x) => [x.round, x.ssthresh]) });
        series.push({ name: 'Reno ssthresh', color: 's2', type: 'step', dash: [4, 4], width: 1.5, marker: false, points: reno.rows.map((x) => [x.round, x.ssthresh]) });
      }
      chart.set({
        xLabel: 'Transmission round (round-trip times)', yLabel: 'cwnd (segments)', yMin: 0, xMin: 0, xMax: R, xTicks: R <= 26 ? undefined : undefined, xTipLabel: 'round ',
        vlines: Object.keys(events).map(Number).map((r) => ({ x: r, label: events[r] === 'timeout' ? 'timeout' : '3 dup ACKs', color: events[r] === 'timeout' ? 'bad' : 'warn' })),
        series,
      });

      ro.tahoe.set(String(tahoe.segments)); ro.reno.set(String(reno.segments));
      ro.gain.set(tahoe.segments ? '+' + Math.round((reno.segments / tahoe.segments - 1) * 100) + '%' : '-', 'more data in the same time');

      CN.clear(tableBox);
      tableBox.appendChild(h('div', { class: 'scroll-x', style: 'max-height:320px;overflow-y:auto' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Round'), h('th', null, 'Loss'), h('th', { class: 'num' }, 'Tahoe cwnd'), h('th', { class: 'num' }, 'ssthresh'), h('th', null, 'Tahoe phase'), h('th', { class: 'num' }, 'Reno cwnd'), h('th', { class: 'num' }, 'ssthresh'), h('th', null, 'Reno phase'))),
        h('tbody', null, tahoe.rows.map((t, i) => {
          const r = reno.rows[i];
          return h('tr', { class: t.event ? 'fail' : '' }, h('td', null, String(t.round)), h('td', null, t.event ? EVENT_NAMES[t.event] : ''),
            h('td', { class: 'num' }, String(t.cwnd)), h('td', { class: 'num' }, String(t.ssthresh)), h('td', null, t.phase),
            h('td', { class: 'num' }, String(r.cwnd)), h('td', { class: 'num' }, String(r.ssthresh)), h('td', null, r.phase));
        })))));

      CN.clear(noteBox);
      const firstLoss = Object.keys(events).map(Number).sort((a, b) => a - b)[0];
      noteBox.appendChild(CN.note('info', firstLoss === undefined
        ? 'No loss yet: cwnd doubles every round trip (slow start) until it reaches ssthresh, then grows by one segment per round trip (congestion avoidance). Add a loss to see how Tahoe and Reno differ.'
        : 'At round ' + firstLoss + ' the ' + EVENT_NAMES[events[firstLoss]] + (events[firstLoss] === 'timeout' ? ' sends both variants back to cwnd = 1 with ssthresh halved.' : ' makes Tahoe restart from cwnd = 1 (slow start again), while Reno keeps going from half the old window (fast recovery) and skips the slow climb.') + ' Both set ssthresh to half of the window at the time of loss.'));
    }

    const stage = h('div', { class: 'stage' },
      CN.panel('Congestion window', 'Click legend names to hide a line. Vertical markers are loss events.', chartHost),
      noteBox,
      h('div', { class: 'readouts' }, ro.tahoe.el, ro.reno.el, ro.gain.el),
      CN.panel('Round by round', 'Rows with a red edge are rounds where a loss is detected.', tableBox));
    refresh();
    return h('div', { class: 'workbench' }, controls, stage);
  }

  /* ---------------------------------------------------------------- Part B: bottleneck link */
  function buildBottleneck() {
    const queue = CN.segmented({ label: 'Queue discipline', options: [{ value: 'droptail', label: 'Drop-tail' }, { value: 'red', label: 'RED' }], value: 'droptail', onChange: refresh });
    const variant = CN.segmented({ label: 'TCP version', options: [{ value: 'reno', label: 'Reno' }, { value: 'tahoe', label: 'Tahoe' }], value: 'reno', onChange: refresh });
    const nFlows = CN.slider({ label: 'Flows sharing the link', min: 1, max: 4, value: 2, onInput: refresh });
    const cap = CN.slider({ label: 'Link capacity', min: 200, max: 2000, step: 100, value: 1000, format: (v) => v + ' pkt/s (' + (v * 0.012).toFixed(1) + ' Mbps)', onInput: refresh, hint: 'Packets of 1500 bytes.' });
    const buf = CN.slider({ label: 'Buffer size', min: 10, max: 300, step: 10, value: 100, format: (v) => v + ' packets', onInput: refresh });
    const rtt = CN.slider({ label: 'Round-trip time (no queueing)', min: 20, max: 200, step: 10, value: 100, format: (v) => v + ' ms', onInput: refresh });
    const longRtt = CN.check({ label: 'Give the last flow twice that round-trip time', checked: false, onChange: refresh });
    const gap = CN.slider({ label: 'Delay before later flows start', min: 0, max: 20, value: 0, format: (v) => v + ' s', onInput: refresh });
    const dur = CN.slider({ label: 'Run length', min: 20, max: 120, step: 10, value: 60, format: (v) => v + ' s', onInput: refresh });
    const minth = CN.slider({ label: 'RED: start dropping at', min: 5, max: 60, step: 5, value: 25, format: (v) => v + '% of buffer', onInput: refresh });
    const maxth = CN.slider({ label: 'RED: drop hard at', min: 40, max: 95, step: 5, value: 75, format: (v) => v + '% of buffer', onInput: refresh });
    const maxp = CN.slider({ label: 'RED: top early-drop chance', min: 0.02, max: 0.3, step: 0.01, value: 0.1, format: (v) => (v * 100).toFixed(0) + '%', onInput: refresh });
    const seed = CN.textField({ label: 'Random seed', value: '5', mono: true, onInput: refresh });

    const redBox = h('div', { class: 'controls', style: 'padding:0;border:0;background:none;gap:14px;box-shadow:none' }, minth.el, maxth.el, maxp.el);
    const controls = h('div', { class: 'controls' },
      h('h3', null, 'Router queue'), queue.el, buf.el, redBox,
      h('h3', null, 'Link and senders'), variant.el, cap.el, rtt.el, nFlows.el, longRtt.el, gap.el, dur.el, seed.el);

    const cwndHost = h('div'); const queueHost = h('div');
    const cwndChart = new CN.Chart(cwndHost, { height: 290, label: 'Congestion windows over time' });
    const queueChart = new CN.Chart(queueHost, { height: 250, label: 'Queue length over time' });
    const ro = { util: CN.readout('Link utilisation'), delay: CN.readout('Mean queueing delay'), jit: CN.readout('Delay variation (jitter)'), loss: CN.readout('Packets dropped'), fair: CN.readout('Fairness between flows'), bdp: CN.readout('Bandwidth-delay product') };
    const flowTable = h('div'); const noteBox = h('div'); const compareBox = h('div'); const compareStatus = h('span', { class: 'field-hint' });

    function buildCfg(over) {
      const n = nFlows.get();
      const flows = [];
      for (let i = 0; i < n; i++) flows.push({ rtt: (rtt.get() / 1000) * (longRtt.get() && i === n - 1 && n > 1 ? 2 : 1), start: i * gap.get() });
      return Object.assign({ capacity: cap.get(), buffer: buf.get(), queue: queue.get(), variant: variant.get(), flows, duration: dur.get(), seed: parseInt(seed.get(), 10) || 1, red: { minFrac: minth.get() / 100, maxFrac: Math.max(maxth.get(), minth.get() + 5) / 100, maxp: maxp.get(), wq: 0.002 } }, over);
    }

    function refresh() {
      redBox.style.display = queue.get() === 'red' ? '' : 'none';
      const cfg = buildCfg();
      const res = TCP.simulateBottleneck(cfg);
      const st = res.stats; const t = res.samples.t;
      const names = cfg.flows.map((f, i) => 'Flow ' + (i + 1) + ' (' + Math.round(f.rtt * 1000) + ' ms)');
      cwndChart.set({
        xLabel: 'Time (s)', yLabel: 'cwnd (packets)', yMin: 0, xMin: 0, xMax: cfg.duration, xTipLabel: 't = ', yUnit: ' pkts',
        hlines: [{ y: st.bdp, label: 'link capacity x RTT of flow 1', color: 'ink-3' }],
        series: names.map((n, i) => ({ name: n, color: FLOW_COLORS[i], type: 'line', marker: false, points: t.map((x, k) => [x, res.samples.w[i][k]]) })),
      });
      const qSeries = [{ name: 'Queue length', color: 's1', type: 'line', marker: false, fill: true, points: t.map((x, k) => [x, res.samples.q[k]]) }];
      const hl = [{ y: cfg.buffer, label: 'buffer full: packets dropped here', color: 'bad' }];
      if (cfg.queue === 'red') {
        qSeries.push({ name: 'RED average queue', color: 's2', type: 'line', marker: false, points: t.map((x, k) => [x, res.samples.avg[k]]) });
        hl.push({ y: cfg.red.minFrac * cfg.buffer, label: 'RED starts dropping', color: 'warn' });
        hl.push({ y: cfg.red.maxFrac * cfg.buffer, label: 'RED drops hard', color: 'warn' });
      }
      queueChart.set({ xLabel: 'Time (s)', yLabel: 'Queue (packets)', yMin: 0, yMax: cfg.buffer * 1.08, xMin: 0, xMax: cfg.duration, xTipLabel: 't = ', yUnit: ' pkts', hlines: hl, series: qSeries });

      ro.util.set(CN.pct(st.utilization, 0), 'of ' + cfg.capacity + ' pkt/s');
      ro.delay.set(CN.fmt(st.delayMs, 0) + ' ms', 'added by waiting in the queue');
      ro.jit.set(CN.fmt(st.jitterMs, 0) + ' ms', 'spread of that delay');
      ro.loss.set(CN.pct(st.lossRate, 2), 'of packets sent');
      ro.fair.set(CN.fmt(st.fairness, 2), cfg.flows.length > 1 ? '1.00 = perfectly equal' : 'one flow');
      ro.bdp.set(Math.round(st.bdp) + ' pkts', 'what fits "in the pipe"');

      CN.clear(flowTable);
      flowTable.appendChild(h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Flow'), h('th', { class: 'num' }, 'RTT'), h('th', { class: 'num' }, 'Throughput'), h('th', { class: 'num' }, 'Share'), h('th', { class: 'num' }, 'Average cwnd'), h('th', { class: 'num' }, 'Loss events'))),
        h('tbody', null, cfg.flows.map((f, i) => h('tr', null, h('td', null, 'Flow ' + (i + 1)), h('td', { class: 'num' }, Math.round(f.rtt * 1000) + ' ms'),
          h('td', { class: 'num' }, Math.round(st.throughput[i]) + ' pkt/s'), h('td', { class: 'num' }, CN.pct(st.share[i], 0)), h('td', { class: 'num' }, CN.fmt(st.meanW[i], 0)), h('td', { class: 'num' }, String(st.losses[i]))))))));

      CN.clear(noteBox);
      const msgs = [];
      if (cfg.queue === 'droptail') msgs.push('Drop-tail only drops when the buffer is completely full, so the queue sits high most of the time. That keeps the link busy but adds waiting time to every packet, and all flows tend to be hit together and slow down together.');
      else msgs.push('RED starts dropping a few packets early, before the buffer is full, and picks flows at random. Senders slow down sooner and at different moments, so the average queue stays lower (less delay) and the flows are less synchronised.');
      if (cfg.flows.length > 1 && longRtt.get()) msgs.push('The flow with the longer round-trip time grows its window more slowly and ends with a smaller share: AIMD is fair only between flows with similar RTTs.');
      if (cfg.buffer < st.bdp * 0.5) msgs.push('The buffer is much smaller than the bandwidth-delay product, so the queue empties after each loss and the link goes partly idle (utilisation drops).');
      if (cfg.variant === 'tahoe') msgs.push('Tahoe restarts from cwnd = 1 after every loss, so it wastes more capacity than Reno.');
      noteBox.appendChild(CN.note('info', msgs.join(' ')));
      CN.clear(compareBox);
    }

    function runCompare() {
      compareStatus.textContent = 'Running...';
      setTimeout(() => {
        const rows = [['Drop-tail', 'droptail'], ['RED', 'red']].map(([label, q]) => ({ label, st: TCP.simulateBottleneck(buildCfg({ queue: q })).stats }));
        CN.clear(compareBox);
        compareBox.appendChild(h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', null, 'Queue'), h('th', { class: 'num' }, 'Utilisation'), h('th', { class: 'num' }, 'Mean delay'), h('th', { class: 'num' }, 'Jitter'), h('th', { class: 'num' }, 'Packets dropped'), h('th', { class: 'num' }, 'Fairness'))),
          h('tbody', null, rows.map((r) => h('tr', null, h('td', null, r.label), h('td', { class: 'num' }, CN.pct(r.st.utilization, 0)), h('td', { class: 'num' }, CN.fmt(r.st.delayMs, 0) + ' ms'), h('td', { class: 'num' }, CN.fmt(r.st.jitterMs, 0) + ' ms'), h('td', { class: 'num' }, CN.pct(r.st.lossRate, 2)), h('td', { class: 'num' }, CN.fmt(r.st.fairness, 2))))))));
        compareStatus.textContent = 'Done.';
      }, 20);
    }

    const stage = h('div', { class: 'stage' },
      CN.panel('Congestion windows', 'Each flow slowly raises its window until the router drops a packet, then cuts it back: the saw-tooth.', cwndHost),
      CN.panel('Router queue', 'The queue fills as the windows grow. Every packet in the queue waits, which is where delay and jitter come from.', queueHost),
      noteBox,
      h('div', { class: 'readouts' }, ro.util.el, ro.delay.el, ro.jit.el, ro.loss.el, ro.fair.el, ro.bdp.el),
      CN.panel('Per flow', 'Throughput is measured over the second half of the run.', flowTable),
      CN.panel('Drop-tail against RED', 'Runs both with the current settings so you can compare the trade-off.', h('div', { class: 'row', style: 'margin-bottom:10px' }, CN.button('Compare', { onClick: runCompare }), compareStatus), compareBox));
    refresh();
    return h('div', { class: 'workbench' }, controls, stage);
  }

  /* ---------------------------------------------------------------- Tab page */
  CN.registerTab({
    id: 'tcp',
    group: { layer: 4, name: 'Transport' },
    title: 'TCP congestion',
    mount(page) {
      page.appendChild(CN.pageHead({
        title: 'TCP congestion control',
        lead: 'See how TCP finds the right sending speed by itself: it speeds up until packets are lost, backs off, and repeats. First the textbook window rules, then real flows fighting over a router queue.',
        units: [{ unit: 6, name: 'Transport Layer', co: 5, level: 'Understand' }],
        topics: ['Congestion control: effects of congestion', 'Traffic management: TCP', 'Congestion avoidance mechanisms'],
      }));
      const modes = [{ id: 'lab', label: 'Window lab: Tahoe and Reno', build: buildWindowLab }, { id: 'link', label: 'Shared link: drop-tail and RED', build: buildBottleneck }];
      const built = {}; const holder = h('div', { style: 'margin-top:6px' });
      const seg = CN.segmented({ label: 'Mode', options: modes.map((m) => ({ value: m.id, label: m.label })), value: 'lab', onChange: show });
      function show(id) {
        modes.forEach((m) => { if (built[m.id]) built[m.id].style.display = 'none'; });
        if (!built[id]) { built[id] = modes.find((m) => m.id === id).build(); holder.appendChild(built[id]); }
        built[id].style.display = '';
      }
      page.appendChild(h('div', { class: 'row' }, seg.el));
      page.appendChild(holder);
      show('lab');
      page.appendChild(CN.section('How it works', 'Short notes for revision', h('div', { class: 'stage', style: 'gap:10px' },
        CN.theory('Why congestion control exists', '<ul><li>When too many packets arrive at a router, its queue fills. Packets wait longer (delay), then the buffer overflows (loss), and the senders retransmit, which adds even more load.</li><li>TCP has no help from the network, so each sender infers congestion from <b>loss</b> and adjusts its congestion window <b>cwnd</b>. The sender may have at most min(cwnd, receiver window) bytes unacknowledged.</li></ul>'),
        CN.theory('Slow start, congestion avoidance, Tahoe and Reno', '<ul><li><b>Slow start</b>: cwnd starts at 1 MSS and grows by 1 MSS per ACK, so it doubles every RTT, until it reaches <b>ssthresh</b>.</li><li><b>Congestion avoidance</b>: above ssthresh, cwnd grows by 1 MSS per RTT (additive increase).</li><li>On a loss, ssthresh = cwnd / 2 (multiplicative decrease). <b>Timeout</b>: cwnd = 1 and slow start again (both versions).</li><li><b>Triple duplicate ACK</b>: Tahoe sets cwnd = 1 and slow-starts; <b>Reno</b> does fast retransmit and fast recovery: cwnd = ssthresh and continue linearly.</li><li>Together this is <b>AIMD</b>, which converges toward equal shares between flows with the same RTT.</li></ul>'),
        CN.theory('Queue management: drop-tail and RED', '<ul><li><b>Drop-tail</b> accepts packets until the buffer is full, then drops new arrivals. Simple, but queues stay long and flows can lose packets at the same moment and back off together (global synchronisation).</li><li><b>RED</b> (random early detection) tracks the <i>average</i> queue. Between a minimum and maximum threshold it drops arriving packets with a probability that rises from 0 to maxp, so senders get early, spread-out warnings.</li><li>Rule of thumb: a buffer of about one bandwidth-delay product keeps a single TCP flow close to 100% utilisation.</li></ul>'))));
      return { destroy() {} };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
