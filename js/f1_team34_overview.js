/* ==========================================================================
   Tab: Overview - landing page. Registered first so it is the default route.
   A looping ladder diagram, one card per lab with a tiny preview, and a
   short list of experiments to try first.
   ========================================================================== */
(function (root) {
  'use strict';
  const CN = (root.CN = root.CN || {});
  if (typeof document === 'undefined') return;
  const h = CN.h;

  /* ---------- hero: Go-Back-N recovering from one lost frame ---------- */
  function buildHero(loops) {
    const W = 440; const H = 330; const xs = 84; const xr = 356; const slope = 44;
    const svg = h('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Animated diagram: a sender transmits three frames, the second is lost, the sender times out and sends it again.' });
    const line = (x1, y1, x2, y2, o) => h('line', Object.assign({ x1, y1, x2, y2, 'stroke-linecap': 'round' }, o));
    svg.appendChild(line(xs, 36, xs, H - 14, { stroke: 'var(--ink)', 'stroke-width': 2 }));
    svg.appendChild(line(xr, 36, xr, H - 14, { stroke: 'var(--ink)', 'stroke-width': 2 }));
    svg.appendChild(h('text', { x: xs, y: 22, 'text-anchor': 'middle', 'font-weight': 700 }, 'Sender'));
    svg.appendChild(h('text', { x: xr, y: 22, 'text-anchor': 'middle', 'font-weight': 700 }, 'Receiver'));

    // [fromSender, y, start time, label, lost, colour]
    const defs = [
      [true, 52, 0.0, 'Frame 0', false, 'var(--s1)'],
      [true, 70, 0.35, 'Frame 1', true, 'var(--s2)'],
      [true, 88, 0.7, 'Frame 2', false, 'var(--s1)'],
      [false, 96, 1.6, 'ACK 0', false, 'var(--s3)'],
      [true, 190, 4.4, 'Frame 1 again', false, 'var(--s2)'],
      [true, 208, 4.75, 'Frame 2 again', false, 'var(--s1)'],
      [false, 252, 5.9, 'ACK 2', false, 'var(--s3)'],
    ];
    const items = defs.map(([fromS, y0, t0, label, lost, color]) => {
      const x1 = fromS ? xs : xr; const x2 = fromS ? xr : xs;
      const ln = line(x1, y0, x1, y0, { stroke: color, 'stroke-width': 3 });
      const dot = h('circle', { cx: x1, cy: y0, r: 4.5, fill: color, opacity: 0 });
      const tag = h('text', { x: fromS ? xs - 10 : xr + 10, y: y0 + 4, 'text-anchor': fromS ? 'end' : 'start', opacity: 0, style: 'fill:' + color + ';font-weight:700' }, label.replace(' again', "'").replace('Frame ', 'F').replace('ACK ', 'ACK '));
      const cross = h('text', { x: x1 + (x2 - x1) * 0.55, y: y0 + slope * 0.55 + 6, 'text-anchor': 'middle', opacity: 0, style: 'fill:var(--bad);font-size:18px;font-weight:800' }, '✕');
      svg.appendChild(ln); svg.appendChild(dot); svg.appendChild(tag); if (lost) svg.appendChild(cross);
      return { ln, dot, tag, cross, x1, x2, y0, t0, lost, dur: 0.95 };
    });
    const timeoutTxt = h('text', { x: xs - 10, y: 160, 'text-anchor': 'end', opacity: 0, style: 'fill:var(--bad);font-weight:700' }, 'timeout');
    const timeoutBar = line(xs - 8, 166, xs + 8, 166, { stroke: 'var(--bad)', 'stroke-width': 2.5, opacity: 0 });
    const done = h('text', { x: (xs + xr) / 2, y: 304, 'text-anchor': 'middle', opacity: 0, style: 'font-weight:700;fill:var(--good)' }, 'All frames delivered in order');
    svg.appendChild(timeoutTxt); svg.appendChild(timeoutBar); svg.appendChild(done);

    const CYCLE = 9.2;
    function draw(p) {
      items.forEach((it) => {
        const f = CN.clamp((p - it.t0) / it.dur, 0, 1);
        const g = f * (it.lost ? 0.55 : 1);
        const ex = it.x1 + (it.x2 - it.x1) * g; const ey = it.y0 + slope * g;
        it.ln.setAttribute('x2', ex); it.ln.setAttribute('y2', ey);
        it.dot.setAttribute('cx', ex); it.dot.setAttribute('cy', ey);
        it.dot.setAttribute('opacity', f > 0 && f < 1 ? 1 : 0);
        it.tag.setAttribute('opacity', f > 0 ? 1 : 0);
        it.cross.setAttribute('opacity', it.lost && f >= 1 ? 1 : 0);
      });
      const to = p > 3.0 && p < 4.5 ? 1 : 0;
      timeoutTxt.setAttribute('opacity', to); timeoutBar.setAttribute('opacity', to);
      done.setAttribute('opacity', p > 6.9 ? 1 : 0);
    }
    const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    draw(reduce ? CYCLE : 0);
    let clock = 0;
    const loop = CN.makeLoop((dt) => { clock = (clock + dt) % CYCLE; draw(clock); });
    if (!reduce) loop.start();
    loops.push(loop);
    return h('figure', { class: 'hero-art' }, svg,
      h('figcaption', null, 'Go-Back-N recovering from a lost frame. Run it yourself in the Flow control lab.'));
  }

  /* ---------- tiny previews for the lab cards ---------- */
  const T = { stroke: 'var(--ink-3)' };
  function thumb(kind) {
    const svg = h('svg', { viewBox: '0 0 200 64', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
    const add = (n) => svg.appendChild(n);
    if (kind === 'errors') {
      const bits = [1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
      bits.forEach((b, i) => {
        const bad = i === 5;
        add(h('rect', { x: 14 + i * 17.6, y: 20, width: 14, height: 24, rx: 2, fill: bad ? 'var(--bad)' : 'var(--surface)', stroke: bad ? 'var(--bad)' : 'var(--rule-strong)' }));
        add(h('text', { x: 21 + i * 17.6, y: 37, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, style: 'fill:' + (bad ? '#fff' : 'var(--ink-2)') }, bad ? 1 : b));
      });
    } else if (kind === 'flow') {
      for (let i = 0; i < 10; i++) {
        const inW = i >= 3 && i < 7;
        add(h('rect', { x: 12 + i * 17.6, y: 26, width: 14, height: 14, rx: 2, fill: i < 3 ? 'var(--s3)' : 'var(--surface)', stroke: inW ? 'var(--accent)' : 'var(--rule-strong)', 'stroke-width': inW ? 2 : 1 }));
      }
      add(h('rect', { x: 9, y: 22, width: 0, height: 0 }));
      add(h('path', { d: 'M 62 20 h 70 v 4', fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 }));
      add(h('path', { d: 'M 62 20 v 4', fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 }));
    } else if (kind === 'access') {
      const rows = [[[10, 30, 'g'], [90, 28, 'r']], [[84, 34, 'r'], [150, 26, 'g']], [[40, 30, 'g'], [118, 30, 'r']]];
      rows.forEach((r, i) => r.forEach(([x, w, c]) => add(h('rect', { x, y: 10 + i * 17, width: w, height: 12, rx: 2, fill: c === 'g' ? 'var(--s3)' : 'var(--bad)' }))));
    } else if (kind === 'tcp') {
      add(h('polyline', { points: '8,54 20,48 32,38 44,26 56,14 58,34 70,31 82,27 94,23 106,19 118,15 120,34 132,30 144,26 156,22 168,18 180,14', fill: 'none', stroke: 'var(--s2)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
    } else if (kind === 'journey') {
      [['var(--s2)', 0, 200], ['var(--s1)', 1, 172], ['var(--s3)', 2, 144], ['var(--s5, #7a5af8)', 3, 116]].forEach(([c, i, w]) => add(h('rect', { x: (200 - w) / 2, y: 8 + i * 13.5, width: w, height: 11, rx: 2, fill: c })));
    } else if (kind === 'subnet') {
      for (let i = 0; i < 16; i++) {
        const net = i < 10;
        add(h('rect', { x: 10 + (i % 8) * 23.5 + (i % 8 > 3 ? 4 : 0), y: i < 8 ? 12 : 36, width: 20, height: 18, rx: 2, fill: net ? 'var(--s1)' : 'var(--surface)', stroke: net ? 'var(--s1)' : 'var(--rule-strong)' }));
      }
    } else if (kind === 'routing') {
      const pts = [[24, 32], [74, 12], [74, 52], [130, 12], [130, 52], [180, 32]];
      [[0, 1], [0, 2], [1, 3], [2, 4], [1, 2], [3, 5], [4, 5], [3, 4]].forEach(([a, b], i) => add(h('line', { x1: pts[a][0], y1: pts[a][1], x2: pts[b][0], y2: pts[b][1], stroke: [0, 1, 3, 6].includes(i) ? 'var(--accent)' : 'var(--ink-3)', 'stroke-width': [0, 1, 3, 6].includes(i) ? 3 : 1.5, opacity: 0.8 })));
      pts.forEach(([x, y]) => add(h('circle', { cx: x, cy: y, r: 6, fill: 'var(--surface)', stroke: 'var(--ink-2)', 'stroke-width': 2 })));
    } else if (kind === 'qos') {
      [[14, 150, 'var(--s2)'], [26, 110, 'var(--s1)'], [38, 170, 'var(--s3)']].forEach(([y, w, c], i) => {
        add(h('rect', { x: 12, y, width: 176, height: 8, rx: 2, fill: 'var(--rule)' }));
        add(h('rect', { x: 12, y, width: w - 6 * i, height: 8, rx: 2, fill: c }));
      });
    }
    return h('div', { class: 'lab-thumb' }, svg);
  }

  const LABS = [
    ['journey', 'journey', 'Packet journey', 'Follow one web request through TCP, IP and Ethernet across two routers, then compare circuit and packet switching.'],
    ['errors', 'errors', 'Error detection and correction', 'Encode a message, flip bits, and watch Hamming, CRC and checksum catch (or miss) the damage.'],
    ['flow', 'flow', 'Flow control', 'Stop-and-Wait, Go-Back-N and Selective Repeat on a link that loses frames.'],
    ['access', 'access', 'Multiple access', 'Stations fight over one wire: ALOHA, slotted ALOHA, CSMA and CSMA/CD.'],
    ['subnet', 'subnet', 'Subnetting', 'Masks, network and broadcast addresses, VLSM planning and route summarisation, with the bits shown.'],
    ['routing', 'routing', 'Routing protocols', 'Dijkstra and distance vector on a network you can break, including count to infinity.'],
    ['tcp', 'tcp', 'TCP congestion control', 'Tahoe and Reno windows, and flows sharing a router with drop-tail or RED.'],
    ['qos', 'qos', 'Queuing and QoS', 'FIFO, priority and WFQ: what a phone call feels while a download runs.'],
  ];

  const TRY = [
    ['journey', 'Set the TTL to 2', 'and watch the packet die at the second router.'],
    ['errors', 'Flip two bits in a Hamming codeword', 'and see why one-bit repair fails on a double error.'],
    ['flow', 'Lose frame 2 under Go-Back-N', 'then switch to Selective Repeat and compare what gets resent.'],
    ['access', 'Raise the traffic until ALOHA collapses', 'then try CSMA/CD on the same load.'],
    ['subnet', 'Plan a /24 for 100, 50, 20 and 2 hosts', 'using VLSM, and see how little space is left.'],
    ['routing', 'Break link B\u2013C on the three-router line', 'with no fix, then with split horizon.'],
    ['tcp', 'Add a timeout at round 12', 'and compare how Tahoe and Reno recover.'],
    ['qos', 'Push data traffic to 100%', 'and watch FIFO ruin the call while priority protects it.'],
  ];

  CN.registerTab({
    id: 'overview',
    title: 'Overview',
    mount(page) {
      const loops = [];
      const byId = {}; CN.tabs.forEach((t) => { byId[t.id] = t; });

      page.appendChild(h('div', { class: 'hero' },
        h('div', null,
          h('h1', null, 'Watch network protocols work, then break them.'),
          h('p', { class: 'lead' }, 'Flip bits, drop frames, crowd a wire and flood a router. Each lab lets you change the conditions and shows exactly how the protocol reacts.'),
          h('div', { class: 'row' },
            h('a', { class: 'btn primary', href: '#journey' }, 'Follow a packet'),
            h('a', { class: 'btn', href: '#tcp' }, 'Jump to TCP congestion'))),
        buildHero(loops)));

      page.appendChild(CN.section('The labs', null,
        h('div', { class: 'lab-grid' }, LABS.map(([id, th, title, text]) => {
          const t = byId[id];
          return h('a', { class: 'lab-card', href: '#' + id }, thumb(th), h('h3', null, title), h('p', null, text),
            h('span', { class: 'layer' }, t && t.group ? 'Layer ' + t.group.layer + ': ' + t.group.name : ''));
        }))));

      page.appendChild(CN.section('Try these first', 'Each takes under a minute',
        h('ol', { class: 'try-list' }, TRY.map(([id, a, b]) => h('li', null, h('a', { href: '#' + id }, a), ' ' + b)))));

      return { destroy() { loops.forEach((l) => l.stop()); } };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
