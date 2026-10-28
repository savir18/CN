/* ==========================================================================
   Tab: Packet journey  (Units 1 and 2: layered architecture, switching)
   Part 1 - logic (no DOM):
     * crc32, internetChecksum   the two error checks real headers use
     * makeFrame / journey       one message wrapped in TCP, IP and Ethernet and
                                 carried across two routers (TTL, MACs, checksums)
     * switching delays          circuit vs packet switching, and statistical
                                 multiplexing (binomial tail)
   Part 2 - the interface.
   ========================================================================== */
(function (root) {
  'use strict';
  const CN = (root.CN = root.CN || {});
  const J = (CN.journey = {});

  /* ----- checks used by real headers ---------------------------------------- */
  const CRC_TABLE = (function () {
    const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t;
  })();
  J.crc32 = function (bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  /* 16-bit ones-complement sum of the bytes (zero padded), returned as the complement */
  J.internetChecksum = function (bytes) {
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 2) { sum += (bytes[i] << 8) | (i + 1 < bytes.length ? bytes[i + 1] : 0); while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16); }
    return (~sum) & 0xffff;
  };
  J.hex = (v, digits) => v.toString(16).toUpperCase().padStart(digits, '0');

  const ipBytes = (s) => s.split('.').map(Number);
  const macBytes = (s) => s.split(':').map((x) => parseInt(x, 16));
  const be16 = (v) => [(v >> 8) & 255, v & 255];
  const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

  J.NODES = [
    { id: 'A', name: 'Host A', ip: '192.168.1.10', mac: '00:1A:2B:00:00:0A' },
    { id: 'R1', name: 'Router R1', macIn: '02:00:00:01:00:01', macOut: '02:00:00:01:00:02' },
    { id: 'R2', name: 'Router R2', macIn: '02:00:00:02:00:01', macOut: '02:00:00:02:00:02' },
    { id: 'B', name: 'Host B', ip: '10.0.2.20', mac: '00:1A:2B:00:00:0B' },
  ];
  J.MSS = 1460;
  J.textBytes = (text) => Array.from(unescape(encodeURIComponent(text)), (c) => c.charCodeAt(0)).slice(0, J.MSS);

  J.makeIp = function (o) {
    const hdr = [0x45, 0x00].concat(be16(o.totalLen), be16(o.id), [0x40, 0x00], [o.ttl, 6], [0, 0], ipBytes(o.src), ipBytes(o.dst));
    const cks = J.internetChecksum(hdr); hdr[10] = cks >> 8; hdr[11] = cks & 255;
    return { bytes: hdr, checksum: cks, ttl: o.ttl, src: o.src, dst: o.dst, totalLen: o.totalLen, id: o.id };
  };
  J.ipChecksumOk = (bytes) => J.internetChecksum(bytes) === 0;
  J.makeTcp = function (o) {
    const h0 = [].concat(be16(o.srcPort), be16(o.dstPort), be32(o.seq), be32(0), [0x50, 0x18], be16(65535), [0, 0], [0, 0]);
    const pseudo = [].concat(ipBytes(o.src), ipBytes(o.dst), [0, 6], be16(20 + o.payload.length));
    const cks = J.internetChecksum(pseudo.concat(h0, o.payload));
    h0[16] = cks >> 8; h0[17] = cks & 255;
    return { bytes: h0, checksum: cks, srcPort: o.srcPort, dstPort: o.dstPort, seq: o.seq, flags: 'PSH, ACK', window: 65535 };
  };
  J.makeFrame = function (o) {
    const body = o.ip.bytes.concat(o.tcpBytes, o.payload);
    const head = macBytes(o.dstMac).concat(macBytes(o.srcMac), [0x08, 0x00]);
    const fcs = J.crc32(head.concat(body));
    return { dstMac: o.dstMac, srcMac: o.srcMac, type: '0x0800 (IPv4)', fcs, bytes: head.concat(body, be32(fcs)), headBytes: 14, bodyLen: body.length };
  };
  J.frameFcsOk = (frame) => { const b = frame.bytes; return J.crc32(b.slice(0, b.length - 4)) === frame.fcs; };

  /* The trip: A -> R1 -> R2 -> B. Returns every step with the frame that is on the wire. */
  J.journey = function (cfg) {
    const A = J.NODES[0]; const B = J.NODES[3]; const R1 = J.NODES[1]; const R2 = J.NODES[2];
    const payload = J.textBytes(cfg.text); const startTtl = cfg.ttl;
    const tcp = J.makeTcp({ srcPort: 49152, dstPort: 80, seq: 1000, src: A.ip, dst: B.ip, payload });
    const totalLen = 20 + 20 + payload.length;
    const ipAt = (ttl) => J.makeIp({ totalLen, id: 0x1c46, ttl, src: A.ip, dst: B.ip });
    const steps = [];
    steps.push({ id: 'app', title: 'Host A: application data', node: 0, layers: ['app'], tcp, payload });
    steps.push({ id: 'tcp', title: 'Host A: transport layer adds a TCP header', node: 0, layers: ['tcp', 'app'], tcp, payload });
    const ip0 = ipAt(startTtl);
    steps.push({ id: 'ip', title: 'Host A: network layer adds an IP header', node: 0, layers: ['ip', 'tcp', 'app'], tcp, payload, ip: ip0 });
    const f0 = J.makeFrame({ ip: ip0, tcpBytes: tcp.bytes, payload, dstMac: R1.macIn, srcMac: A.mac });
    steps.push({ id: 'eth0', title: 'Link A to R1: data link layer adds an Ethernet header and trailer', node: 0, link: 0, layers: ['eth', 'ip', 'tcp', 'app'], tcp, payload, ip: ip0, frame: f0 });
    const routers = [[R1, R2.macIn, 1, 1], [R2, B.mac, 2, 2]]; let ttl = startTtl; let prev = { ip: ip0, frame: f0 }; let dropped = false;
    routers.forEach(([r, nextMac, node, link], i) => {
      if (dropped) return;
      ttl -= 1;
      if (ttl <= 0) {
        dropped = true;
        steps.push({ id: 'drop', title: r.name + ': TTL reached 0, packet discarded', node, layers: ['ip'], tcp, payload, ip: prev.ip, frame: prev.frame, dropped: true, router: r.id });
        return;
      }
      const ip = ipAt(ttl); const f = J.makeFrame({ ip, tcpBytes: tcp.bytes, payload, dstMac: nextMac, srcMac: r.macOut });
      steps.push({ id: 'fwd' + (i + 1), title: r.name + ': strip the frame, route, rebuild the frame', node, link, layers: ['eth', 'ip', 'tcp', 'app'], tcp, payload, ip, frame: f, before: prev, router: r.id });
      prev = { ip, frame: f };
    });
    if (!dropped) steps.push({ id: 'rx', title: 'Host B: remove headers layer by layer', node: 3, layers: ['eth', 'ip', 'tcp', 'app'], tcp, payload, ip: prev.ip, frame: prev.frame, receive: true });
    return { steps, dropped, payloadLen: payload.length };
  };

  /* ----- switching ------------------------------------------------------------ */
  /* Circuit: set-up, then bits flow at the full rate. Packet: store and forward. Times in seconds. */
  J.circuitDelay = (o) => o.setup + (o.msgBytes * 8) / o.rate + o.links * o.prop;
  J.packetDelay = function (o) {
    const pkts = Math.ceil(o.msgBytes / o.pktPayload);
    const lastPayload = o.msgBytes - (pkts - 1) * o.pktPayload;
    const full = ((o.pktPayload + o.header) * 8) / o.rate; const last = ((lastPayload + o.header) * 8) / o.rate;
    // links run in parallel on different packets; a smaller last packet still queues behind the one before it
    if (pkts === 1) return o.links * last + o.links * o.prop;
    return (pkts + o.links - 2) * full + last + o.links * o.prop;
  };
  /* P(more than m of n users are active at once), each active with probability p */
  J.overloadProbability = function (n, p, m) {
    if (m >= n) return 0; if (p <= 0) return 0; if (p >= 1) return 1;
    let pmf = Math.pow(1 - p, n); let cdf = pmf; const ratio = p / (1 - p);
    for (let k = 0; k < m; k++) { pmf = pmf * ((n - k) / (k + 1)) * ratio; cdf += pmf; }
    return Math.max(0, 1 - cdf);
  };

  if (typeof document === 'undefined') return;

  /* ======================================================================
     USER INTERFACE
     ====================================================================== */
  const h = CN.h;
  const LAYER = {
    app: { name: 'Application', unit: 'Layer 7', cls: 'lyr-app' },
    tcp: { name: 'Transport (TCP)', unit: 'Layer 4', cls: 'lyr-tcp' },
    ip: { name: 'Network (IP)', unit: 'Layer 3', cls: 'lyr-ip' },
    eth: { name: 'Data link (Ethernet)', unit: 'Layer 2', cls: 'lyr-eth' },
  };
  const hexRun = (bytes) => bytes.map((b) => J.hex(b, 2)).join(' ');

  function topology(stepNode, link, dropped) {
    const xs = [70, 230, 390, 550]; const W = 620; const H = 110;
    const svg = h('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'netsvg journey-net', role: 'img', 'aria-label': 'Host A, two routers and Host B in a line' });
    for (let i = 0; i < 3; i++) svg.appendChild(h('line', { x1: xs[i], y1: 55, x2: xs[i + 1], y2: 55, class: 'nedge' + (link === i ? ' tree' : '') }));
    J.NODES.forEach((n, i) => {
      const host = i === 0 || i === 3;
      svg.appendChild(h('rect', { x: xs[i] - 26, y: 33, width: 52, height: 44, rx: host ? 6 : 22, class: 'nnode' + (i === stepNode ? ' pick' : '') }));
      svg.appendChild(h('text', { x: xs[i], y: 60, 'text-anchor': 'middle', class: 'nlabel' + (i === stepNode ? ' on' : '') }, n.id));
      svg.appendChild(h('text', { x: xs[i], y: 98, 'text-anchor': 'middle', class: 'nbadge' }, host ? n.ip : 'router'));
    });
    if (link !== undefined && link !== null && !dropped) svg.appendChild(h('text', { x: (xs[link] + xs[link + 1]) / 2, y: 40, 'text-anchor': 'middle', class: 'nbadge' }, 'frame on the wire'));
    if (dropped) svg.appendChild(h('text', { x: xs[stepNode], y: 18, 'text-anchor': 'middle', class: 'ncost' }, 'dropped'));
    return svg;
  }

  function fieldRow(name, val, changed, hint) {
    return h('tr', { class: changed ? 'chg' : '' }, h('td', null, name), h('td', { class: 'mono' }, val), h('td', { class: 'hint' }, hint || ''));
  }

  CN.registerTab({
    id: 'journey',
    group: { layer: '1–7', name: 'Whole stack' },
    title: 'Packet journey',
    mount(page) {
      page.appendChild(CN.pageHead({
        title: 'The journey of a packet',
        lead: 'Every layer wraps the data from the layer above in its own header. Follow one web request from Host A to Host B across two routers, then compare circuit switching with packet switching.',
        units: [{ unit: 1, name: 'Introduction' }, { unit: 2, name: 'Physical layer and switching' }],
        topics: ['layered architecture and encapsulation', 'headers, MAC addresses, TTL', 'circuit and packet switching, statistical multiplexing'],
      }));

      let mode = 'journey';
      const modeSeg = CN.segmented({ label: 'Mode', options: [{ value: 'journey', label: 'Follow a packet' }, { value: 'switching', label: 'Circuit or packet?' }], value: 'journey', onChange: (v) => { mode = v; show(); } });

      /* ---------- journey mode ---------- */
      let stepIdx = 0; let trip = null;
      const text = CN.textField({ label: 'Message from Host A', value: 'GET /index.html HTTP/1.1', mono: true, hint: 'Up to ' + J.MSS + ' bytes fit in one segment.', onInput: () => { stepIdx = 0; recompute(); } });
      const ttl = CN.slider({ label: 'Starting TTL', min: 1, max: 16, value: 64 > 16 ? 8 : 64, onInput: () => { stepIdx = 0; recompute(); }, hint: 'Try 2: the packet dies at R2. This is how traceroute works.' });
      const jControls = h('div', null, text.el, ttl.el);
      const jHost = h('div', { class: 'stage' });

      function recompute() { trip = J.journey({ text: text.get(), ttl: ttl.get() }); stepIdx = Math.min(stepIdx, trip.steps.length - 1); renderJourney(); }

      function renderJourney() {
        CN.clear(jHost);
        const st = trip.steps[stepIdx]; const total = trip.steps.length - 1;
        const nav = h('div', { class: 'row', style: 'margin-bottom:10px' },
          CN.button('Back', { onClick: () => { if (stepIdx > 0) { stepIdx--; renderJourney(); } } }),
          CN.button(stepIdx >= total ? 'Done' : 'Next step', { kind: 'primary', onClick: () => { if (stepIdx < total) { stepIdx++; renderJourney(); } } }),
          CN.button('Restart', { onClick: () => { stepIdx = 0; renderJourney(); } }),
          h('span', { class: 'field-hint' }, 'Step ' + (stepIdx + 1) + ' of ' + (total + 1)));
        jHost.appendChild(CN.panel('Where the packet is', st.title, topology(st.node, st.link, st.dropped), nav));
        jHost.appendChild(CN.note(st.dropped ? 'bad' : 'info', explain(st)));

        // the stack of headers as one bar with proportional widths
        const parts = [];
        if (st.layers.includes('eth')) parts.push({ k: 'eth', label: 'Ethernet', n: 14 });
        if (st.layers.includes('ip')) parts.push({ k: 'ip', label: 'IP', n: 20 });
        if (st.layers.includes('tcp')) parts.push({ k: 'tcp', label: 'TCP', n: 20 });
        parts.push({ k: 'app', label: 'Data', n: st.payload.length });
        if (st.layers.includes('eth')) parts.push({ k: 'eth', label: 'FCS', n: 4 });
        const sum = parts.reduce((a, p) => a + p.n, 0);
        const bar = h('div', { class: 'encap' }, parts.map((p) => h('div', { class: 'seg-box ' + LAYER[p.k].cls, style: 'flex:' + Math.max(p.n, sum * 0.07) + ' 0 0' }, h('b', null, p.label), h('span', null, p.n + ' B'))));
        jHost.appendChild(CN.panel('The packet as sent', sum + ' bytes on the wire, ' + st.payload.length + ' of them are your message (' + (sum ? Math.round(st.payload.length / sum * 100) : 0) + '%).', bar));

        // field tables
        const tbls = [];
        const before = st.before;
        if (st.layers.includes('eth') && st.frame) {
          const f = st.frame; const pf = before && before.frame;
          tbls.push(CN.panel(LAYER.eth.unit + ': ' + LAYER.eth.name, 'Only valid for one link. A router throws it away and builds a new one.', h('table', { class: 'tbl fields' }, h('tbody', null,
            fieldRow('Destination MAC', f.dstMac, pf && pf.dstMac !== f.dstMac, 'next device on this link'),
            fieldRow('Source MAC', f.srcMac, pf && pf.srcMac !== f.srcMac, 'sender on this link'),
            fieldRow('Type', f.type, false),
            fieldRow('FCS (CRC-32)', '0x' + J.hex(f.fcs, 8), pf && pf.fcs !== f.fcs, J.frameFcsOk(f) ? 'check passes' : 'check fails')))));
        }
        if (st.layers.includes('ip') && st.ip) {
          const ip = st.ip; const pi = before && before.ip;
          tbls.push(CN.panel(LAYER.ip.unit + ': ' + LAYER.ip.name, 'Source and destination stay the same end to end. TTL and checksum change at every router.', h('table', { class: 'tbl fields' }, h('tbody', null,
            fieldRow('Source IP', ip.src, false), fieldRow('Destination IP', ip.dst, false),
            fieldRow('TTL', String(ip.ttl), pi && pi.ttl !== ip.ttl, 'one less at every router'),
            fieldRow('Header checksum', '0x' + J.hex(ip.checksum, 4), pi && pi.checksum !== ip.checksum, J.ipChecksumOk(ip.bytes) ? 'sums to all ones: OK' : 'bad'),
            fieldRow('Total length', ip.totalLen + ' B', false)))));
        }
        if (st.layers.includes('tcp')) {
          const t = st.tcp;
          tbls.push(CN.panel(LAYER.tcp.unit + ': ' + LAYER.tcp.name, 'Ports pick the program. Only the two end hosts look at this header.', h('table', { class: 'tbl fields' }, h('tbody', null,
            fieldRow('Source port', String(t.srcPort), false, 'random client port'), fieldRow('Destination port', String(t.dstPort), false, 'web server (HTTP)'),
            fieldRow('Sequence number', String(t.seq), false), fieldRow('Flags', t.flags, false), fieldRow('Checksum', '0x' + J.hex(t.checksum, 4), false, 'covers header, data and addresses')))));
        }
        tbls.push(CN.panel(LAYER.app.unit + ': ' + LAYER.app.name, 'The data the program handed down.', h('div', { class: 'mono wrapbox' }, text.get() || '(empty)')));
        jHost.appendChild(h('div', { class: 'two-col' }, tbls));
        if (st.frame) jHost.appendChild(h('details', { class: 'hexview' }, h('summary', null, 'See the first bytes in hex'), h('pre', { class: 'mono' }, hexRun(st.frame.bytes.slice(0, 64)) + (st.frame.bytes.length > 64 ? ' …' : ''))));
      }
      function explain(st) {
        switch (st.id) {
          case 'app': return 'A browser writes an HTTP request. It is just text: the application layer neither knows nor cares how it will travel.';
          case 'tcp': return 'TCP puts the data in a segment and adds source and destination ports (and sequence numbers for reliability). The ports tell the receiving host which program gets the data.';
          case 'ip': return 'IP adds the addresses of the two end hosts and a TTL. This is the packet. The addresses do not change on the way; they are what routers use to choose a path.';
          case 'eth0': return 'The link layer wraps the packet in a frame for this one link only. The destination MAC is R1’s port, not Host B: MAC addresses only mean something on one link. The FCS lets the receiver detect corruption.';
          case 'fwd1': case 'fwd2': return st.router + ' checks the frame check sequence, throws away the Ethernet header, reads the destination IP and picks the next hop. It then lowers the TTL by one, recomputes the IP header checksum, and wraps the packet in a new frame with new MAC addresses. Highlighted rows changed.';
          case 'drop': return st.router + ' lowered the TTL to 0 and must discard the packet. It would send an ICMP Time Exceeded message back to A. Loops cannot circulate forever because of this, and traceroute uses it on purpose.';
          case 'rx': return 'Host B checks the FCS, then strips each header in reverse order: Ethernet, IP (the address is its own), TCP (port 80 goes to the web server). The server finally sees the same text that A sent.';
          default: return '';
        }
      }

      /* ---------- switching mode ---------- */
      const sMsg = CN.slider({ label: 'Message size', min: 1, max: 1000, value: 100, format: (v) => v + ' KB', onInput: () => renderSwitching() });
      const sRate = CN.slider({ label: 'Link rate', min: 1, max: 100, value: 10, format: (v) => v + ' Mbps', onInput: () => renderSwitching() });
      const sLinks = CN.slider({ label: 'Links on the path', min: 1, max: 10, value: 4, onInput: () => renderSwitching() });
      const sSetup = CN.slider({ label: 'Circuit set-up time', min: 0, max: 500, value: 100, step: 10, format: (v) => v + ' ms', onInput: () => renderSwitching(), hint: 'Signalling to reserve the circuit before any data flows.' });
      const sProp = CN.slider({ label: 'Propagation per link', min: 0, max: 20, value: 2, format: (v) => v + ' ms', onInput: () => renderSwitching() });
      const sPkt = CN.slider({ label: 'Packet payload', min: 100, max: 1500, value: 1000, step: 50, format: (v) => v + ' B', onInput: () => renderSwitching(), hint: 'Each packet also carries a 40 byte header.' });
      const uRate = CN.slider({ label: 'Rate of an active user', min: 50, max: 500, value: 100, step: 10, format: (v) => v + ' kbps', onInput: () => renderSwitching() });
      const uAct = CN.slider({ label: 'Fraction of time active', min: 5, max: 60, value: 10, format: (v) => v + '%', onInput: () => renderSwitching() });
      const uN = CN.slider({ label: 'Users sharing the link', min: 2, max: 80, value: 35, onInput: () => renderSwitching() });
      const sControls = h('div', null, h('h3', null, 'Moving one message'), sMsg.el, sRate.el, sLinks.el, sSetup.el, sProp.el, sPkt.el, h('h3', null, 'Sharing a link'), uRate.el, uAct.el, uN.el);
      const sHost = h('div', { class: 'stage' });
      const c1Host = h('div'); const c2Host = h('div');
      const chart1 = new CN.Chart(c1Host, { height: 240, label: 'Packet-switched delay against packet size' });
      const chart2 = new CN.Chart(c2Host, { height: 240, label: 'Probability the link is overloaded' });
      const rCirc = CN.readout('Circuit switching', '-'); const rPkt = CN.readout('Packet switching', '-'); const rUsers = CN.readout('Users supported', '-');
      sHost.appendChild(h('div', { class: 'readouts' }, rCirc.el, rPkt.el, rUsers.el));
      const sNote = h('div'); sHost.appendChild(sNote);
      sHost.appendChild(CN.panel('Delay for one message', 'Small packets let the links work in parallel, but every packet pays for its header.', c1Host));
      sHost.appendChild(CN.panel('Why sharing works', 'With bursty users, the chance that too many are active together is tiny.', c2Host));

      function renderSwitching() {
        const base = { msgBytes: sMsg.get() * 1000, rate: sRate.get() * 1e6, links: sLinks.get(), prop: sProp.get() / 1000, setup: sSetup.get() / 1000, header: 40 };
        const circ = J.circuitDelay(base);
        const pkt = J.packetDelay(Object.assign({ pktPayload: sPkt.get() }, base));
        const fmtMs = (s) => (s * 1000 >= 100 ? Math.round(s * 1000) : (s * 1000).toFixed(1)) + ' ms';
        rCirc.set(fmtMs(circ), 'set-up + transmit + propagate');
        rPkt.set(fmtMs(pkt), 'store and forward, ' + Math.ceil(base.msgBytes / sPkt.get()) + ' packets');
        const link = 1000; // kbps, the sharing example uses a 1 Mbps link
        const m = Math.floor(link / uRate.get()); const p = uAct.get() / 100; const n = uN.get();
        const over = J.overloadProbability(n, p, m);
        rUsers.set('Circuit ' + m + ' vs packet ' + n, 'on a 1 Mbps link; chance of overload ' + (over < 0.0001 ? '< 0.01%' : (over * 100).toFixed(2) + '%'));
        CN.clear(sNote);
        sNote.appendChild(CN.note(pkt < circ ? 'good' : 'warn', pkt < circ
          ? 'Packet switching finishes first here: no set-up, and the packets overlap on different links. Circuit switching wins when the set-up is cheap, the message is large and a steady, guaranteed rate matters (a phone call).'
          : 'Circuit switching finishes first here. Try more links or a smaller set-up time and notice the gap close: packet switching also pays for header bytes and a wait at every router.'));
        const pts = []; for (let s = 100; s <= 1500; s += 50) pts.push([s, J.packetDelay(Object.assign({ pktPayload: s }, base)) * 1000]);
        const circMs = circ * 1000; let yMax = Math.max(circMs, ...pts.map((q) => q[1])) * 1.1;
        chart1.set({ xLabel: 'Packet payload (bytes)', yLabel: 'Delay (ms)', yMin: 0, yMax, xMin: 100, xMax: 1500, hlines: [{ y: circMs, label: 'circuit switching', color: 's3' }],
          series: [{ name: 'Packet switching', color: 's1', type: 'line', marker: false, points: pts }] });
        const q = []; for (let k = 2; k <= 80; k++) q.push([k, J.overloadProbability(k, p, m) * 100]);
        chart2.set({ xLabel: 'Users sharing the link', yLabel: 'P(more than ' + m + ' active) %', yMin: 0, yMax: Math.max(5, Math.ceil(Math.max(...q.map((z) => z[1])) * 1.1)), xMin: 2, xMax: 80, hlines: [{ y: 1, label: '1% overload', color: 'warn' }], xFormat: (x) => String(Math.round(x)),
          series: [{ name: 'Overload chance', color: 's2', type: 'line', marker: false, noLegend: true, points: q }] });
      }

      const controls = h('div', { class: 'controls' }, h('h3', null, 'View'), modeSeg.el, jControls, sControls);
      page.appendChild(h('div', { class: 'workbench' }, controls, h('div', null, jHost, sHost)));
      function show() { jControls.style.display = mode === 'journey' ? '' : 'none'; jHost.style.display = mode === 'journey' ? '' : 'none'; sControls.style.display = mode === 'switching' ? '' : 'none'; sHost.style.display = mode === 'switching' ? '' : 'none'; if (mode === 'journey') recompute(); else renderSwitching(); }
      ttl.set(8); show();

      page.appendChild(CN.section('How it works', 'Short notes for revision', h('div', { class: 'stage', style: 'gap:10px' },
        CN.theory('Encapsulation', '<ul><li>Each layer treats what it receives from above as opaque data and adds its own <b>header</b> (the link layer also adds a trailer). On arrival, each layer strips its own header and hands the rest up.</li><li>Application data &rarr; TCP segment (ports) &rarr; IP packet (addresses) &rarr; Ethernet frame (MAC addresses and FCS) &rarr; bits.</li><li>Overhead is the price of layering: here the headers add 58 bytes (14 + 20 + 20 + 4).</li></ul>'),
        CN.theory('What changes at a router', '<ul><li>IP addresses stay the same from end to end. MAC addresses change on every link, because they only identify devices on that link.</li><li>The router lowers the TTL, recomputes the header checksum and builds a new frame. A TTL of 0 means the packet is discarded, so routing loops cannot last forever.</li></ul>'),
        CN.theory('Circuit and packet switching', '<ul><li><b>Circuit</b>: reserve a path first (set-up delay), then get a fixed rate with no queueing. Idle time is wasted. Used by the old telephone network.</li><li><b>Packet</b>: split the message, send each packet independently, and store and forward it at every router. No set-up and resources are shared (<b>statistical multiplexing</b>), but delay varies and packets can be lost.</li><li>Delay for one packet over N links: N &times; (L / R). For P packets: (N + P &minus; 1) &times; (L / R), plus propagation. A 1 Mbps link and 100 kbps users who are active 10% of the time: circuits serve 10, packets serve about 35 with an overload chance below 0.05%.</li></ul>'))));
      return { destroy() {} };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
