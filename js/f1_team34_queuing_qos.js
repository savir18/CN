/* ==========================================================================
   Tab: Queuing and QoS  (Unit 6, Transport Layer / traffic management)
   Part 1 - model (no DOM): a packet-by-packet simulation of one router output
     port that carries three kinds of traffic and serves them with FIFO,
     strict Priority, or Weighted Fair Queuing (self-clocked WFQ).
     Flows:  0 VoIP  (small packets every 20 ms, delay sensitive)
             1 Web   (random Poisson arrivals)
             2 Bulk  (bursty on/off transfers, big packets)
   Part 2 - the interface.
   ========================================================================== */
(function (root) {
  'use strict';
  const CN = (root.CN = root.CN || {});
  const Q = (CN.queuingQos = {});

  Q.FLOWS = [
    { id: 'voip', name: 'VoIP call', bytes: 200, rank: 0 },
    { id: 'web', name: 'Web traffic', bytes: 500, rank: 1 },
    { id: 'bulk', name: 'Bulk transfer', bytes: 1500, rank: 2 },
  ];
  Q.DISCIPLINES = { fifo: 'FIFO', priority: 'Priority queuing', wfq: 'Weighted fair queuing' };
  Q.VOIP_INTERVAL = 0.02; // seconds between voice packets
  // ITU-T G.114 style limits for a good voice call (queueing part only; propagation comes on top)
  Q.TARGET = { delayMs: 150, jitterMs: 30, loss: 0.01 };

  /* ----- traffic generation -------------------------------------------------- */
  Q.generate = function (cfg) {
    const o = Object.assign({ capacity: 1e6, dataLoad: 0.8, burst: 0.3, duration: 30, seed: 1 }, cfg);
    const rng = CN.makeRng(o.seed);
    const pk = [];
    const C = o.capacity;
    // VoIP: constant bit rate
    const phase = rng() * Q.VOIP_INTERVAL;
    for (let t = phase; t < o.duration; t += Q.VOIP_INTERVAL) pk.push({ t, f: 0, size: Q.FLOWS[0].bytes });
    // Web: Poisson arrivals carrying 30% of the data load
    const webBits = 0.3 * o.dataLoad * C; const webRate = webBits / (Q.FLOWS[1].bytes * 8);
    if (webRate > 0) for (let t = rng.exp(webRate); t < o.duration; t += rng.exp(webRate)) pk.push({ t, f: 1, size: Q.FLOWS[1].bytes });
    // Bulk: on/off source, 70% of the data load on average. Sends at twice the mean rate while ON.
    const bulkBits = 0.7 * o.dataLoad * C;
    if (bulkBits > 0) {
      const onMean = o.burst; const offMean = o.burst;
      const peak = bulkBits * (onMean + offMean) / onMean; // so the long-run mean matches
      const gap = (Q.FLOWS[2].bytes * 8) / peak;
      let t = rng.exp(1 / offMean);
      while (t < o.duration) {
        const end = t + rng.exp(1 / onMean);
        for (let x = t; x < end && x < o.duration; x += gap) pk.push({ t: x, f: 2, size: Q.FLOWS[2].bytes });
        t = end + rng.exp(1 / offMean);
      }
    }
    pk.sort((a, b) => a.t - b.t || a.f - b.f);
    return pk;
  };

  /* ----- one port, one discipline ------------------------------------------- */
  Q.run = function (arrivals, cfg) {
    const o = Object.assign({ discipline: 'fifo', capacity: 1e6, buffer: 50, voipWeight: 0.25, duration: 30, keepSeries: true }, cfg);
    const C = o.capacity;
    const nF = 3;
    const weights = [o.voipWeight, (1 - o.voipWeight) * 0.3, (1 - o.voipWeight) * 0.7];
    const queues = [[], [], []]; // per class (FIFO uses queue 0 as the single shared queue)
    const lastFinish = [0, 0, 0];
    let vNow = 0; let fifoCount = 0;
    const st = Q.FLOWS.map(() => ({ sent: 0, dropped: 0, delays: [], bits: 0, series: [] }));
    let t = 0; let i = 0; const n = arrivals.length; let busy = 0;

    function enqueue(p) {
      st[p.f].sent++;
      if (o.discipline === 'fifo') {
        if (queues[0].length >= o.buffer) { st[p.f].dropped++; return; }
        queues[0].push(p);
      } else {
        const q = queues[p.f];
        if (q.length >= o.buffer) { st[p.f].dropped++; return; }
        if (o.discipline === 'wfq') {
          p.tag = Math.max(vNow, lastFinish[p.f]) + (p.size * 8) / weights[p.f];
          lastFinish[p.f] = p.tag;
        }
        q.push(p);
      }
    }
    function pick() {
      if (o.discipline === 'fifo') return queues[0].length ? queues[0].shift() : null;
      if (o.discipline === 'priority') {
        for (let f = 0; f < nF; f++) if (queues[f].length) return queues[f].shift();
        return null;
      }
      let best = -1;
      for (let f = 0; f < nF; f++) if (queues[f].length && (best < 0 || queues[f][0].tag < queues[best][0].tag)) best = f;
      if (best < 0) return null;
      const p = queues[best].shift(); vNow = p.tag; return p;
    }
    const empty = () => !queues[0].length && !queues[1].length && !queues[2].length;

    while (i < n || !empty()) {
      if (empty() && i < n && arrivals[i].t > t) t = arrivals[i].t;
      while (i < n && arrivals[i].t <= t) enqueue(arrivals[i++]);
      const p = pick();
      if (!p) continue;
      const tx = (p.size * 8) / C;
      t += tx; busy += tx;
      const s = st[p.f];
      const d = t - p.t; // waiting time plus transmission time
      s.delays.push(d); s.bits += p.size * 8;
      if (o.keepSeries) s.series.push([p.t, d * 1000]);
    }

    const dur = o.duration;
    const flows = st.map((s, f) => {
      const d = s.delays; const sorted = d.slice().sort((a, b) => a - b);
      const mean = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
      let jit = 0; for (let k = 1; k < d.length; k++) jit += Math.abs(d[k] - d[k - 1]);
      jit = d.length > 1 ? jit / (d.length - 1) : 0;
      return {
        name: Q.FLOWS[f].name, sent: s.sent, dropped: s.dropped,
        loss: s.sent ? s.dropped / s.sent : 0,
        meanMs: mean * 1000, p95Ms: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] * 1000 : 0,
        maxMs: sorted.length ? sorted[sorted.length - 1] * 1000 : 0,
        jitterMs: jit * 1000, throughput: s.bits / dur,
        sorted: o.keepSeries ? sorted.map((x) => x * 1000) : null, series: s.series,
      };
    });
    return { flows, utilization: Math.min(1, busy / dur), cfg: o };
  };

  /* VoIP call quality verdict from the three QoS numbers */
  Q.voipVerdict = function (f, addMs) {
    const delay = f.meanMs + (addMs || 0);
    const fails = [];
    if (f.p95Ms + (addMs || 0) > Q.TARGET.delayMs) fails.push('delay');
    if (f.jitterMs > Q.TARGET.jitterMs) fails.push('jitter');
    if (f.loss > Q.TARGET.loss) fails.push('loss');
    return { ok: fails.length === 0, fails, delay };
  };

  /* Run all three disciplines on exactly the same traffic */
  Q.compare = function (cfg) {
    const arr = Q.generate(cfg);
    const out = {};
    Object.keys(Q.DISCIPLINES).forEach((d) => { out[d] = Q.run(arr, Object.assign({}, cfg, { discipline: d })); });
    return out;
  };

  /* Mean VoIP delay as the data load grows */
  Q.sweepLoad = function (cfg, loads) {
    const res = { fifo: [], priority: [], wfq: [] };
    loads.forEach((L) => {
      const c = Object.assign({}, cfg, { dataLoad: L, keepSeries: false });
      const arr = Q.generate(c);
      Object.keys(res).forEach((d) => { res[d].push([L, Q.run(arr, Object.assign({}, c, { discipline: d })).flows[0].meanMs]); });
    });
    return res;
  };

  if (typeof document === 'undefined') return;

  /* ======================================================================
     USER INTERFACE
     ====================================================================== */
  const h = CN.h;
  const DCOL = { fifo: 's1', priority: 's2', wfq: 's3' };
  const FCOL = ['s2', 's1', 's3'];

  CN.registerTab({
    id: 'qos',
    group: { layer: 4, name: 'Transport' },
    title: 'Queuing and QoS',
    mount(page) {
      page.appendChild(CN.pageHead({
        title: 'Queuing mechanisms and QoS',
        lead: 'A router can only send one packet at a time, so packets wait. The order it serves them in decides whether a phone call stays clear while a big download runs. Compare three queuing rules on exactly the same traffic.',
        units: [{ unit: 6, name: 'Transport Layer', co: 5, level: 'Understand' }],
        topics: ['Queuing mechanisms', 'QoS parameters: delay, jitter, loss, throughput'],
      }));

      const disc = CN.segmented({ label: 'Queuing rule', options: Object.keys(Q.DISCIPLINES).map((k) => ({ value: k, label: Q.DISCIPLINES[k] })), value: 'fifo', onChange: refresh });
      const cap = CN.slider({ label: 'Link speed', min: 0.5, max: 5, step: 0.5, value: 1, format: (v) => v + ' Mbps', onInput: refresh });
      const load = CN.slider({ label: 'Data traffic (web + bulk)', min: 20, max: 140, step: 5, value: 90, format: (v) => v + '% of link', onInput: refresh, hint: 'Above 100% the router is overloaded and must drop packets.' });
      const burst = CN.slider({ label: 'Bulk burst length', min: 0.1, max: 1, step: 0.1, value: 0.3, format: (v) => v.toFixed(1) + ' s', onInput: refresh, hint: 'The bulk transfer sends for this long, then pauses for the same time. Longer bursts build longer queues.' });
      const buf = CN.slider({ label: 'Buffer per queue', min: 10, max: 200, step: 10, value: 50, format: (v) => v + ' packets', onInput: refresh });
      const wv = CN.slider({ label: 'WFQ: share reserved for VoIP', min: 5, max: 50, step: 5, value: 25, format: (v) => v + '%', onInput: refresh, hint: 'Only used by weighted fair queuing.' });
      const propag = CN.slider({ label: 'Extra path delay', min: 0, max: 120, step: 10, value: 60, format: (v) => v + ' ms', onInput: refresh, hint: 'Propagation and coding delay on the rest of the path. Added to the queueing delay when judging the call.' });
      const dur = CN.slider({ label: 'Run length', min: 10, max: 60, step: 10, value: 30, format: (v) => v + ' s', onInput: refresh });
      const seed = CN.textField({ label: 'Random seed', value: '2', mono: true, onInput: refresh });

      const controls = h('div', { class: 'controls' },
        h('h3', null, 'Router'), disc.el, cap.el, buf.el, wv.el,
        h('h3', null, 'Traffic'), load.el, burst.el, dur.el, propag.el, seed.el);

      const delayHost = h('div'); const cdfHost = h('div'); const sweepHost = h('div');
      const delayChart = new CN.Chart(delayHost, { height: 280, label: 'VoIP packet delay over time' });
      const cdfChart = new CN.Chart(cdfHost, { height: 260, label: 'Share of VoIP packets delivered within a delay' });
      const sweepChart = new CN.Chart(sweepHost, { height: 260, label: 'VoIP delay as data load grows' });
      const tableBox = h('div'); const cmpBox = h('div'); const verdictBox = h('div'); const noteBox = h('div');
      const sweepStatus = h('span', { class: 'field-hint' });
      const ro = { util: CN.readout('Link busy'), d: CN.readout('VoIP mean delay'), j: CN.readout('VoIP jitter'), l: CN.readout('VoIP loss') };

      function cfgNow() {
        return { capacity: cap.get() * 1e6, dataLoad: load.get() / 100, burst: burst.get(), duration: dur.get(), seed: parseInt(seed.get(), 10) || 1, buffer: buf.get(), voipWeight: wv.get() / 100 };
      }
      const msFmt = (v) => CN.fmt(v, v < 10 ? 2 : 1) + ' ms';

      function refresh() {
        const cfg = cfgNow();
        const all = Q.compare(cfg);
        const cur = all[disc.get()];
        const v = cur.flows[0];

        // chart 1: VoIP packet delay in time for the chosen rule
        const ser = v.series; const stp = Math.max(1, Math.floor(ser.length / 900));
        delayChart.set({
          xLabel: 'Time (s)', yLabel: 'VoIP delay in router (ms)', yMin: 0, xMin: 0, xMax: cfg.duration, xTipLabel: 't = ', yUnit: ' ms',
          hlines: [{ y: Math.max(0, Q.TARGET.delayMs - propag.get()), label: 'budget left for queueing', color: 'bad' }],
          series: [{ name: Q.DISCIPLINES[disc.get()], color: DCOL[disc.get()], type: 'line', marker: false, points: ser.filter((_, k) => k % stp === 0) }],
        });
        // chart 2: how quickly VoIP packets get through, per rule
        const cdfSeries = Object.keys(all).map((k) => {
          const s = all[k].flows[0].sorted; const m = s.length; const pts = [];
          const step = Math.max(1, Math.floor(m / 200));
          for (let j = 0; j < m; j += step) pts.push([s[j], (j + 1) / m]);
          if (m) pts.push([s[m - 1], 1]);
          return { name: Q.DISCIPLINES[k], color: DCOL[k], type: 'line', marker: false, points: pts };
        });
        cdfChart.set({ xLabel: 'VoIP delay (ms)', yLabel: 'Fraction of packets within that delay', yMin: 0, yMax: 1, xMin: 0, xTipLabel: '', yUnit: '', yFormat: (y) => Math.round(y * 100) + '%', series: cdfSeries });

        ro.util.set(CN.pct(cur.utilization, 0), 'of the time transmitting');
        ro.d.set(msFmt(v.meanMs), 'plus ' + propag.get() + ' ms elsewhere');
        ro.j.set(msFmt(v.jitterMs), 'target under ' + Q.TARGET.jitterMs + ' ms');
        ro.l.set(CN.pct(v.loss, 2), 'target under ' + CN.pct(Q.TARGET.loss, 0));

        // per-flow table for the chosen rule
        CN.clear(tableBox);
        tableBox.appendChild(h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', null, 'Traffic'), h('th', { class: 'num' }, 'Throughput'), h('th', { class: 'num' }, 'Mean delay'), h('th', { class: 'num' }, '95th percentile'), h('th', { class: 'num' }, 'Jitter'), h('th', { class: 'num' }, 'Packets lost'))),
          h('tbody', null, cur.flows.map((f) => h('tr', null, h('td', null, f.name), h('td', { class: 'num' }, CN.fmt(f.throughput / 1000, 0) + ' kbps'), h('td', { class: 'num' }, msFmt(f.meanMs)), h('td', { class: 'num' }, msFmt(f.p95Ms)), h('td', { class: 'num' }, msFmt(f.jitterMs)), h('td', { class: 'num' }, CN.pct(f.loss, 2))))))));

        // comparison of the three rules (VoIP quality verdict)
        CN.clear(cmpBox);
        cmpBox.appendChild(h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', null, 'Rule'), h('th', { class: 'num' }, 'VoIP delay (95th)'), h('th', { class: 'num' }, 'VoIP jitter'), h('th', { class: 'num' }, 'VoIP loss'), h('th', { class: 'num' }, 'Bulk throughput'), h('th', { class: 'num' }, 'Web delay'), h('th', null, 'Call quality'))),
          h('tbody', null, Object.keys(all).map((k) => {
            const r = all[k]; const vv = Q.voipVerdict(r.flows[0], propag.get());
            return h('tr', { class: k === disc.get() ? 'sel' : '' }, h('td', null, Q.DISCIPLINES[k]), h('td', { class: 'num' }, msFmt(r.flows[0].p95Ms + propag.get())), h('td', { class: 'num' }, msFmt(r.flows[0].jitterMs)), h('td', { class: 'num' }, CN.pct(r.flows[0].loss, 2)), h('td', { class: 'num' }, CN.fmt(r.flows[2].throughput / 1000, 0) + ' kbps'), h('td', { class: 'num' }, msFmt(r.flows[1].meanMs)),
              h('td', null, vv.ok ? 'Good' : 'Poor: ' + vv.fails.join(', ')));
          })))));

        const vc = Q.voipVerdict(v, propag.get());
        CN.clear(verdictBox);
        verdictBox.appendChild(CN.note(vc.ok ? 'good' : 'bad', vc.ok
          ? 'With ' + Q.DISCIPLINES[disc.get()] + ' the call stays within the limits: 95% of voice packets arrive in under ' + Math.round(v.p95Ms + propag.get()) + ' ms, jitter is ' + msFmt(v.jitterMs) + ' and loss is ' + CN.pct(v.loss, 2) + '.'
          : 'With ' + Q.DISCIPLINES[disc.get()] + ' the call would sound poor. It breaks the limit for: ' + vc.fails.join(', ') + '. Voice packets are stuck behind data packets in the queue.'));

        CN.clear(noteBox);
        const msgs = {
          fifo: 'FIFO serves packets strictly in arrival order, so a 200-byte voice packet waits behind every large data packet that arrived before it. Delay and jitter for voice follow whatever the bulk transfer does.',
          priority: 'Priority queuing always sends a waiting voice packet first, so voice sees almost no queue (it only waits for the packet already on the wire). The cost: if high-priority traffic ever filled the link, lower classes would starve.',
          wfq: 'Weighted fair queuing guarantees each class its share of the link (voice gets the share you set) and lets idle shares be used by others. Voice is protected, and bulk traffic cannot be starved.',
        };
        noteBox.appendChild(CN.note('info', msgs[disc.get()]));
      }

      function runSweep() {
        sweepStatus.textContent = 'Running...';
        setTimeout(() => {
          const loads = []; for (let l = 0.2; l <= 1.4001; l += 0.1) loads.push(+l.toFixed(2));
          const cfg = Object.assign(cfgNow(), { duration: Math.min(dur.get(), 20) });
          const res = Q.sweepLoad(cfg, loads);
          sweepChart.set({
            xLabel: 'Data traffic (fraction of link speed)', yLabel: 'VoIP mean delay (ms)', yMin: 0, xTipLabel: 'load ', yUnit: ' ms', xFormat: (x) => Math.round(x * 100) + '%',
            series: Object.keys(res).map((k) => ({ name: Q.DISCIPLINES[k], color: DCOL[k], type: 'line', marker: true, points: res[k] })),
          });
          sweepStatus.textContent = 'Done.';
        }, 20);
      }

      const stage = h('div', { class: 'stage' },
        CN.panel('VoIP delay, packet by packet', 'Each point is one voice packet. Spikes are voice packets that had to wait behind data.', delayHost),
        verdictBox, noteBox,
        h('div', { class: 'readouts' }, ro.util.el, ro.d.el, ro.j.el, ro.l.el),
        CN.panel('QoS parameters for each kind of traffic', 'Delay, jitter, loss and throughput for the selected rule.', tableBox),
        CN.panel('The three rules on identical traffic', 'The highlighted row is the rule selected on the left. Call limits: 95% of packets under ' + Q.TARGET.delayMs + ' ms one way, jitter under ' + Q.TARGET.jitterMs + ' ms, loss under ' + CN.pct(Q.TARGET.loss, 0) + '.', cmpBox),
        CN.panel('How fast voice packets get through', 'A curve further up and to the left is better.', cdfHost),
        CN.panel('What happens as the link fills up', 'Runs the three rules at many load levels (takes a moment).', h('div', { class: 'row', style: 'margin-bottom:10px' }, CN.button('Run load sweep', { onClick: runSweep }), sweepStatus), sweepHost));

      page.appendChild(h('div', { class: 'workbench' }, controls, stage));
      refresh();

      page.appendChild(CN.section('How it works', 'Short notes for revision', h('div', { class: 'stage', style: 'gap:10px' },
        CN.theory('QoS parameters', '<ul><li><b>Delay</b>: time a packet takes from sender to receiver. Here only the time spent in the router (waiting + sending) is measured, then a fixed amount is added for the rest of the path.</li><li><b>Jitter</b>: variation in delay between consecutive packets. Voice and video need it small because they play packets out at a steady rate.</li><li><b>Loss</b>: share of packets dropped, mostly because a buffer overflowed.</li><li><b>Throughput</b>: bits per second actually delivered.</li></ul>'),
        CN.theory('FIFO, priority and weighted fair queuing', '<ul><li><b>FIFO</b>: one queue, first come first served. Simple, but no protection: one greedy flow delays everyone.</li><li><b>Priority queuing</b>: several queues; the highest non-empty queue is always served first. Great for voice, can starve low classes.</li><li><b>Weighted fair queuing (WFQ)</b>: every class gets a guaranteed share in proportion to its weight, and unused share is redistributed. This simulator uses the self-clocked approximation: each packet gets a finish tag = max(virtual time, last tag of its flow) + size / weight, and the smallest tag is sent first.</li></ul>'),
        CN.theory('Why queues build up', '<ul><li>Delay at a router grows sharply as load approaches the link speed. For random (Poisson) arrivals a single queue has mean delay 1 / (service rate - arrival rate), which blows up as the load nears 100%.</li><li>Bursty traffic builds queues even when the average load is below 100%, which is why the burst-length slider matters.</li><li>Queuing rules decide <i>who</i> waits; they cannot create bandwidth. At more than 100% load somebody must lose packets.</li></ul>'))));
      return { destroy() {} };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
