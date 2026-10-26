/* ==========================================================================
   Tab: Overview - landing page. Registered first so it is the default route.
   Shows a small looping ladder diagram, links to every lab, and a syllabus
   coverage map that says honestly which topics have a live simulation.
   ========================================================================== */
(function (root) {
  'use strict';
  const CN = (root.CN = root.CN || {});
  if (typeof document === 'undefined') {
    // Nothing to test without a page, but keep the data importable.
  }

  const COVERAGE = [
    { unit: 1, name: 'Networking principles and layered architecture', rows: [
      ['OSI and TCP/IP layers, encapsulation', null, 'The left menu is arranged by layer, and each lab says which layer it belongs to.'],
    ] },
    { unit: 2, name: 'Circuit and packet switching', rows: [
      ['Circuit switching, packet switching', null, 'Queueing delay and loss in the Queuing and QoS lab show why packet switching needs buffers.'],
    ] },
    { unit: 3, name: 'Data link layer', rows: [
      ['Hamming code', 'errors', 'Encode, flip bits, watch the syndrome point at the wrong bit. Includes SEC-DED.'],
      ['CRC and checksum', 'errors', 'Step-by-step division, standard polynomials, internet checksum, Monte Carlo detection test.'],
      ['Stop-and-Wait', 'flow', 'Event-driven simulation with a space-time diagram.'],
      ['Sliding window: Go-Back-N, Selective Repeat', 'flow', 'Loss, timeout and window-size sweeps against the textbook efficiency formulas.'],
      ['ALOHA, Slotted ALOHA, CSMA, CSMA/CD', 'access', 'Throughput against offered load, live station-level simulation.'],
      ['IEEE 802.3 (Ethernet), IEEE 802.11 (Wi-Fi)', null, 'Covered through CSMA/CD (802.3). 802.11 uses CSMA/CA, which is not simulated.'],
    ] },
    { unit: 4, name: 'Network layer', rows: [
      ['IP addressing, subnetting, forwarding', null, 'Not covered by a lab. A subnet calculator would be a natural extension.'],
    ] },
    { unit: 5, name: 'Routing protocols', rows: [
      ['Distance vector, link state', null, 'Not covered by a lab. A routing visualiser would be a natural extension.'],
    ] },
    { unit: 6, name: 'Transport layer', rows: [
      ['TCP and UDP basics', null, 'Window behaviour is covered; segment format and handshakes are theory only.'],
      ['Congestion control and its effects', 'tcp', 'Slow start, congestion avoidance, Tahoe, Reno; delay and loss as load grows.'],
      ['Traffic management: TCP', 'tcp', 'Several flows sharing one bottleneck, fairness and round-trip-time bias.'],
      ['Congestion avoidance mechanisms', 'tcp', 'Drop-tail compared with RED.'],
      ['Queuing mechanisms and QoS parameters', 'qos', 'FIFO, priority, WFQ; delay, jitter, loss, throughput for a voice call.'],
    ] },
    { unit: 7, name: 'Application layer', rows: [
      ['DNS, HTTP, FTP', null, 'Theory only; no lab.'],
    ] },
  ];

  CN.coverage = COVERAGE;
  if (typeof document === 'undefined') return;
  const h = CN.h;

  /* Looping ladder diagram: Go-Back-N recovering from one lost frame. */
  function buildHero(loopHolder) {
    const W = 400; const H = 270; const xs = 70; const xr = 330; const slope = 52;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = h('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Animated diagram: a sender transmits three frames, the second is lost, the sender times out and sends it again.' });
    const line = (x1, y1, x2, y2, cls, extra) => h('line', Object.assign({ x1, y1, x2, y2, class: cls, 'stroke-linecap': 'round' }, extra));
    svg.appendChild(line(xs, 34, xs, H - 10, 'hero-axis', { stroke: 'var(--ink)', 'stroke-width': 2 }));
    svg.appendChild(line(xr, 34, xr, H - 10, 'hero-axis', { stroke: 'var(--ink)', 'stroke-width': 2 }));
    svg.appendChild(h('text', { x: xs, y: 20, 'text-anchor': 'middle', 'font-weight': 700 }, 'Sender'));
    svg.appendChild(h('text', { x: xr, y: 20, 'text-anchor': 'middle', 'font-weight': 700 }, 'Receiver'));

    // [fromSender, startY, startTime, label, lost, colour]
    const items = [
      [true, 50, 0.0, 'Frame 0', false, 'var(--s1)'],
      [true, 66, 0.4, 'Frame 1', true, 'var(--s2)'],
      [true, 82, 0.8, 'Frame 2', false, 'var(--s1)'],
      [false, 102, 1.6, 'ACK 0', false, 'var(--s3)'],
      [true, 170, 4.2, 'Frame 1 again', false, 'var(--s2)'],
      [true, 186, 4.6, 'Frame 2 again', false, 'var(--s1)'],
      [false, 226, 6.0, 'ACK 2', false, 'var(--s3)'],
    ].map((it) => {
      const [fromS, y0, t0, label, lost, color] = it;
      const x1 = fromS ? xs : xr; const x2 = fromS ? xr : xs;
      const el = line(x1, y0, x1, y0, 'hero-pkt', { stroke: color, 'stroke-width': 3 });
      const txt = h('text', { x: (xs + xr) / 2, y: y0 + slope / 2 - 6, 'text-anchor': 'middle', opacity: 0, transform: 'rotate(' + (fromS ? 7 : -7) + ' ' + (xs + xr) / 2 + ' ' + (y0 + slope / 2 - 10) + ')' }, label);
      const cross = h('text', { x: x1 + (x2 - x1) * 0.55, y: y0 + slope * 0.55 + 6, 'text-anchor': 'middle', opacity: 0, 'font-weight': 800, style: 'fill:var(--bad);font-size:16px' }, '✕');
      svg.appendChild(el); svg.appendChild(txt); if (lost) svg.appendChild(cross);
      return { el, txt, cross, x1, x2, y0, t0, lost, dur: 0.9 };
    });
    const timeout = h('text', { x: xs - 6, y: 150, 'text-anchor': 'end', opacity: 0, style: 'fill:var(--bad);font-weight:700' }, 'timeout');
    svg.appendChild(timeout);

    const CYCLE = 9.5;
    function draw(p) {
      items.forEach((it) => {
        const f = CN.clamp((p - it.t0) / it.dur, 0, 1);
        const full = it.lost ? 0.55 : 1;
        const g = f * full;
        it.el.setAttribute('x2', it.x1 + (it.x2 - it.x1) * g);
        it.el.setAttribute('y2', it.y0 + slope * g);
        it.txt.setAttribute('opacity', f > 0.3 ? 1 : 0);
        it.cross.setAttribute('opacity', it.lost && f >= 1 ? 1 : 0);
      });
      timeout.setAttribute('opacity', p > 3.4 && p < 4.4 ? 1 : 0);
    }
    const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    draw(reduce ? CYCLE : 0);
    let clock = 0;
    const loop = CN.makeLoop((dt) => { clock = (clock + dt) % CYCLE; draw(clock); });
    if (!reduce) loop.start();
    loopHolder.push(loop);
    return h('figure', { class: 'hero-art' }, svg,
      h('figcaption', null, 'Go-Back-N recovering from a lost frame. You can run this yourself in the Flow control lab.'));
  }

  CN.registerTab({
    id: 'overview',
    title: 'Overview',
    mount(page) {
      const loops = [];
      const byId = {}; CN.tabs.forEach((t) => { byId[t.id] = t; });

      page.appendChild(h('div', { class: 'hero' },
        h('div', null,
          h('h1', null, 'Watch network protocols work, then break them.'),
          h('p', { class: 'lead' }, 'Protocol Lab turns the Computer Networks syllabus into experiments you can run in the browser: flip bits and watch codes catch them, lose frames and watch windows recover, crowd a wire and watch collisions, flood a router and watch TCP back off.'),
          h('div', { class: 'row' },
            h('a', { class: 'btn primary', href: '#errors' }, 'Start with error detection'),
            h('a', { class: 'btn', href: '#tcp' }, 'Jump to TCP congestion'))),
        buildHero(loops)));

      const cards = [
        ['errors', 'Error detection and correction', 'Hamming, CRC and checksum on bits you can flip yourself.'],
        ['flow', 'Flow control', 'Stop-and-Wait, Go-Back-N and Selective Repeat on a lossy link.'],
        ['access', 'Multiple access', 'ALOHA, slotted ALOHA, CSMA and CSMA/CD with live stations.'],
        ['tcp', 'TCP congestion control', 'Tahoe and Reno windows; drop-tail and RED on a shared link.'],
        ['qos', 'Queuing and QoS', 'FIFO, priority and WFQ: what a phone call experiences.'],
      ];
      page.appendChild(CN.section('The five labs', 'Every control has a plain explanation; every lab ends with short revision notes',
        h('div', { class: 'module-grid' }, cards.map((c) => {
          const t = byId[c[0]];
          return h('a', { class: 'module', href: '#' + c[0] },
            h('h3', null, c[1]), h('p', null, c[2]),
            h('div', { class: 'chips' }, h('span', { class: 'chip' }, t && t.group ? 'Layer ' + t.group.layer + ': ' + t.group.name : '')));
        }))));

      const tbody = h('tbody');
      COVERAGE.forEach((u) => {
        u.rows.forEach((r, i) => {
          const tag = r[1] ? h('a', { class: 'cov-tag live', href: '#' + r[1] }, 'Live: ' + (byId[r[1]] ? byId[r[1]].title : r[1])) : h('span', { class: 'cov-tag theory' }, 'Theory only');
          tbody.appendChild(h('tr', { class: i === 0 ? 'cov-unit' : '' },
            h('td', null, i === 0 ? 'Unit ' + u.unit + ': ' + u.name : ''), h('td', null, r[0]), h('td', null, tag), h('td', null, r[2])));
        });
      });
      page.appendChild(CN.section('Syllabus coverage', 'Which topics have a live simulation, and which do not',
        h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', null, 'Unit'), h('th', null, 'Topic'), h('th', null, 'In this project'), h('th', null, 'What you can do'))), tbody)),
        CN.note('info', 'Units 4, 5 and 7 (network layer, routing, application layer) have no lab yet. That is deliberate scope, not an oversight, and the table above keeps it visible.')));

      page.appendChild(CN.section('How to read the labs', null, h('div', { class: 'stage', style: 'gap:10px' },
        CN.theory('Controls on the left, results on the right', '<ul><li>Move a slider or press a button and the result updates straight away.</li><li>Charts show values when you hover; click a legend name to hide a line. Charts have a table view for reading exact numbers.</li><li>Experiments with randomness use a seed. The same seed always gives the same run, so you can repeat an experiment exactly.</li></ul>'),
        CN.theory('Colours and accessibility', '<ul><li>Colours are never the only signal: good and bad results always come with words such as OK, Problem or Poor.</li><li>The theme button at the bottom of the left menu switches light and dark.</li></ul>'))));

      return { destroy() { loops.forEach((l) => l.stop()); } };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
