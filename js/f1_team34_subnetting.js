/* ==========================================================================
   Tab: Subnetting and IP addressing  (Unit 4, Network Layer)
   Part 1 - IPv4 maths (no DOM): parsing, masks, network/broadcast/host range,
            equal splits, VLSM, same-subnet test, route summarisation.
   Part 2 - the interface.
   ========================================================================== */
(function (root) {
  'use strict';
  const CN = (root.CN = root.CN || {});
  const S = (CN.subnetting = {});
  const U = (x) => x >>> 0; // keep everything as unsigned 32-bit numbers

  /* ----- parsing and printing ------------------------------------------------ */
  S.parseIp = function (str) {
    const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(String(str));
    if (!m) return null;
    const o = m.slice(1).map(Number);
    if (o.some((x) => x > 255)) return null;
    return U((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]);
  };
  S.ipToStr = (n) => [24, 16, 8, 0].map((s) => (U(n) >>> s) & 255).join('.');
  S.ipToBin = (n) => [24, 16, 8, 0].map((s) => (((U(n) >>> s) & 255).toString(2)).padStart(8, '0')).join('.');
  S.maskFromPrefix = (p) => (p <= 0 ? 0 : U(0xffffffff << (32 - p)));
  S.prefixFromMask = function (maskNum) {
    const bin = U(maskNum).toString(2).padStart(32, '0');
    if (!/^1*0*$/.test(bin)) return null; // a real mask is ones then zeros
    return bin.indexOf('0') === -1 ? 32 : bin.indexOf('0');
  };
  /* "192.168.1.10/24" or "192.168.1.10 255.255.255.0" -> {ip, prefix} or null */
  S.parseCidr = function (str) {
    str = String(str).trim();
    let m = /^([\d.]+)\s*\/\s*(\d{1,2})$/.exec(str);
    if (m) { const ip = S.parseIp(m[1]); const p = Number(m[2]); return ip === null || p > 32 ? null : { ip, prefix: p }; }
    m = /^([\d.]+)\s+([\d.]+)$/.exec(str);
    if (m) { const ip = S.parseIp(m[1]); const mk = S.parseIp(m[2]); if (ip === null || mk === null) return null; const p = S.prefixFromMask(mk); return p === null ? null : { ip, prefix: p }; }
    const ip = S.parseIp(str);
    return ip === null ? null : { ip, prefix: null };
  };

  /* ----- one address in one network ------------------------------------------ */
  S.classOf = function (ip) {
    const a = U(ip) >>> 24;
    if (a < 128) return 'A'; if (a < 192) return 'B'; if (a < 224) return 'C'; if (a < 240) return 'D (multicast)'; return 'E (reserved)';
  };
  S.kindOf = function (ip) {
    const a = U(ip) >>> 24; const b = (U(ip) >>> 16) & 255;
    if (a === 10) return 'private (10.0.0.0/8)';
    if (a === 172 && b >= 16 && b <= 31) return 'private (172.16.0.0/12)';
    if (a === 192 && b === 168) return 'private (192.168.0.0/16)';
    if (a === 127) return 'loopback';
    if (a === 169 && b === 254) return 'link-local';
    if (a >= 224 && a <= 239) return 'multicast';
    if (a >= 240) return 'reserved';
    if (a === 0) return 'this network';
    return 'public';
  };
  S.analyze = function (ip, prefix) {
    ip = U(ip);
    const mask = S.maskFromPrefix(prefix);
    const network = U(ip & mask);
    const broadcast = U(network | ~mask);
    const size = Math.pow(2, 32 - prefix);
    let hosts; let first; let last;
    if (prefix === 32) { hosts = 1; first = last = network; }
    else if (prefix === 31) { hosts = 2; first = network; last = broadcast; } // point-to-point link, RFC 3021
    else { hosts = size - 2; first = network + 1; last = broadcast - 1; }
    return {
      ip, prefix, mask, wildcard: U(~mask), network, broadcast, first: U(first), last: U(last), size, hosts,
      cls: S.classOf(ip), kind: S.kindOf(ip),
      isNetworkAddr: ip === network && prefix < 31, isBroadcastAddr: ip === broadcast && prefix < 31,
    };
  };
  S.sameSubnet = function (a, b, prefix) {
    const m = S.maskFromPrefix(prefix);
    return { same: U(a & m) === U(b & m), netA: U(a & m), netB: U(b & m) };
  };

  /* ----- dividing a network -------------------------------------------------- */
  const log2ceil = (n) => (n <= 1 ? 0 : Math.ceil(Math.log2(n)));
  S.splitEqual = function (network, prefix, count) {
    const extra = log2ceil(count); const np = prefix + extra;
    if (np > 32) return { error: 'Not enough address bits to make that many subnets.' };
    const base = U(network & S.maskFromPrefix(prefix));
    const step = Math.pow(2, 32 - np); const total = Math.pow(2, extra);
    const subs = [];
    for (let i = 0; i < Math.min(total, 256); i++) subs.push(S.analyze(U(base + i * step), np));
    return { newPrefix: np, borrowed: extra, total, subnets: subs };
  };
  /* VLSM: give each requirement the smallest block that fits, biggest first, packed from the start. */
  S.vlsm = function (network, prefix, needs) {
    const base = U(network & S.maskFromPrefix(prefix));
    const space = Math.pow(2, 32 - prefix);
    const order = needs.map((n, i) => ({ need: n, i })).sort((a, b) => b.need - a.need || a.i - b.i);
    let cursor = 0; const rows = [];
    for (const { need, i } of order) {
      const bits = log2ceil(need + 2); const size = Math.pow(2, bits); const p = 32 - bits;
      if (p > 30 && need > 2) return { error: 'A subnet cannot hold ' + need + ' hosts.' };
      if (cursor + size > space) return { error: 'Out of space: ' + S.ipToStr(base) + '/' + prefix + ' has ' + space + ' addresses, the requirements need more.' };
      const a = S.analyze(U(base + cursor), p);
      rows.push({ index: i, need, size, prefix: p, info: a, wasted: a.hosts - need });
      cursor += size;
    }
    rows.sort((a, b) => a.info.network - b.info.network);
    return { rows, used: cursor, space, free: space - cursor };
  };

  /* ----- route summarisation -------------------------------------------------- */
  S.aggregate = function (list) {
    if (!list.length) return null;
    let lo = Infinity; let hi = -1;
    list.forEach((x) => { const a = S.analyze(x.ip, x.prefix); lo = Math.min(lo, a.network); hi = Math.max(hi, a.broadcast); });
    let p = 32;
    while (p > 0 && U(lo & S.maskFromPrefix(p)) !== U(hi & S.maskFromPrefix(p))) p--;
    const sum = S.analyze(lo, p);
    const covered = list.reduce((s, x) => s + Math.pow(2, 32 - x.prefix), 0);
    return { summary: sum, covered, extra: sum.size - covered };
  };

  if (typeof document === 'undefined') return;

  /* ======================================================================
     USER INTERFACE
     ====================================================================== */
  const h = CN.h;
  const str = S.ipToStr;
  const NET = 'net'; const HOST = 'host';

  /* 32 bits in four groups, network bits shaded differently from host bits */
  function bitRow(value, prefix, label, opts) {
    opts = opts || {};
    const bin = U(value).toString(2).padStart(32, '0');
    const groups = [];
    for (let g = 0; g < 4; g++) {
      const cells = [];
      for (let k = 0; k < 8; k++) {
        const i = g * 8 + k;
        cells.push(h('span', { class: 'ipbit ' + (i < prefix ? NET : HOST) + (opts.mark && opts.mark(i) ? ' hot' : '') }, bin[i]));
      }
      groups.push(h('span', { class: 'ipoct' }, cells));
    }
    return h('div', { class: 'iprow' }, h('span', { class: 'iplabel' }, label), h('span', { class: 'ipbits' }, groups),
      opts.dotted ? h('span', { class: 'ipdot' }, opts.dotted) : null);
  }
  const bitKey = () => h('div', { class: 'key' },
    h('span', null, h('i', { class: 'ipk net' }), 'network bits'), h('span', null, h('i', { class: 'ipk host' }), 'host bits'));

  /* ---------------------------------------------------------------- calculator */
  function buildCalc() {
    const ip = CN.textField({ label: 'IP address', value: '192.168.10.37', mono: true, onInput: refresh, hint: 'Four numbers 0 to 255 separated by dots.' });
    const pre = CN.slider({ label: 'Prefix length', min: 0, max: 32, value: 26, format: (v) => '/' + v + '  (' + str(S.maskFromPrefix(v)) + ')', onInput: refresh, hint: 'How many leading bits name the network.' });
    const presets = h('div', { class: 'row tight' }, [['Home /24', '192.168.1.77', 24], ['Office /26', '192.168.10.37', 26], ['Class B /16', '172.20.45.9', 16], ['Link /30', '10.0.0.6', 30]].map(([l, a, p]) =>
      CN.button(l, { small: true, onClick: () => { ip.set(a); pre.set(p); refresh(); } })));
    const out = h('div', { class: 'stage' });
    const controls = h('div', { class: 'controls' }, h('h3', null, 'Address'), ip.el, pre.el, h('h3', null, 'Examples'), presets);

    function refresh() {
      CN.clear(out);
      const addr = S.parseIp(ip.get());
      if (addr === null) { ip.invalid(true); out.appendChild(CN.note('warn', 'Enter a valid IPv4 address such as 192.168.10.37.')); return; }
      ip.invalid(false);
      const p = pre.get(); const a = S.analyze(addr, p);
      const row = (k, v, hint) => h('tr', null, h('td', null, k), h('td', { class: 'mono' }, v), h('td', { class: 'mutedcell' }, hint || ''));
      out.appendChild(CN.panel('How the network address is found', 'The mask has ones for network bits and zeros for host bits. AND keeps the network bits and clears the host bits.',
        bitRow(a.ip, p, 'IP address', { dotted: str(a.ip) }),
        bitRow(a.mask, p, 'Subnet mask', { dotted: str(a.mask) }),
        h('div', { class: 'iprule' }, 'AND'),
        bitRow(a.network, p, 'Network address', { dotted: str(a.network) }),
        bitKey()));
      out.appendChild(CN.panel('Everything about this subnet', null, h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('tbody', null,
        row('Network address', str(a.network) + '/' + p, 'Identifies the subnet; cannot be given to a host'),
        row('Broadcast address', str(a.broadcast), 'Host bits all 1: reaches every host in the subnet'),
        row('First usable host', str(a.first)),
        row('Last usable host', str(a.last)),
        row('Usable hosts', a.hosts.toLocaleString('en-US'), p >= 31 ? (p === 31 ? 'A /31 is used for point-to-point links (RFC 3021)' : 'A /32 is a single host route') : '2^' + (32 - p) + ' - 2 (network and broadcast are reserved)'),
        row('Subnet mask', str(a.mask), 'Wildcard mask: ' + str(a.wildcard)),
        row('Address class', a.cls, 'The old classful rule from the first octet'),
        row('Address type', a.kind))))));
      const notes = [];
      if (a.isNetworkAddr) notes.push('This address is the network address itself, so it cannot be assigned to a host.');
      if (a.isBroadcastAddr) notes.push('This address is the broadcast address, so it cannot be assigned to a host.');
      if (!notes.length) notes.push('This address can be given to a host: it sits between ' + str(a.first) + ' and ' + str(a.last) + '.');
      out.appendChild(CN.note(a.isNetworkAddr || a.isBroadcastAddr ? 'warn' : 'good', notes.join(' ')));
    }
    refresh();
    return h('div', { class: 'workbench' }, controls, out);
  }

  /* ---------------------------------------------------------------- divide */
  function buildDivide() {
    const base = CN.textField({ label: 'Network to divide', value: '192.168.10.0', mono: true, onInput: refresh });
    const pre = CN.slider({ label: 'Prefix length', min: 8, max: 30, value: 24, format: (v) => '/' + v, onInput: refresh });
    const mode = CN.segmented({ label: 'Method', options: [{ value: 'equal', label: 'Equal subnets' }, { value: 'vlsm', label: 'VLSM (by hosts)' }], value: 'equal', onChange: refresh });
    const count = CN.slider({ label: 'Number of subnets', min: 2, max: 64, value: 4, onInput: refresh, hint: 'Rounded up to a power of two, because subnetting borrows whole bits.' });
    const needs = CN.textField({ label: 'Hosts needed per subnet', value: '100, 50, 20, 2', mono: true, onInput: refresh, hint: 'Comma separated, one number per subnet.' });
    const out = h('div', { class: 'stage' });
    const countBox = h('div', null, count.el); const needsBox = h('div', null, needs.el);
    const controls = h('div', { class: 'controls' }, h('h3', null, 'Starting network'), base.el, pre.el, h('h3', null, 'Method'), mode.el, countBox, needsBox);

    function allocBar(blocks, space, baseNum) {
      const segs = blocks.map((b, i) => h('div', { class: 'allocseg c' + (i % 6), style: 'flex:' + b.size, title: str(b.info.network) + '/' + b.prefix }, b.size / space > 0.07 ? '/' + b.prefix : ''));
      const used = blocks.reduce((s, b) => s + b.size, 0);
      if (space - used > 0) segs.push(h('div', { class: 'allocseg free', style: 'flex:' + (space - used), title: 'unused' }, (space - used) / space > 0.1 ? 'unused' : ''));
      return h('div', { class: 'allocbar', role: 'img', 'aria-label': 'How the address space is divided' }, segs);
    }

    function refresh() {
      countBox.style.display = mode.get() === 'equal' ? '' : 'none';
      needsBox.style.display = mode.get() === 'vlsm' ? '' : 'none';
      CN.clear(out);
      const b = S.parseIp(base.get());
      if (b === null) { base.invalid(true); out.appendChild(CN.note('warn', 'Enter a valid network address such as 192.168.10.0.')); return; }
      base.invalid(false);
      const p = pre.get(); const whole = S.analyze(b, p);
      const tbl = (head, rows) => h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, head.map((x, i) => h('th', { class: i > 1 ? 'num' : '' }, x)))), h('tbody', null, rows)));
      if (whole.network !== b) out.appendChild(CN.note('info', 'The address you typed is not the start of a /' + p + ' block, so it was rounded down to ' + str(whole.network) + '/' + p + '.'));
      if (mode.get() === 'equal') {
        const r = S.splitEqual(b, p, count.get());
        if (r.error) { out.appendChild(CN.note('bad', r.error)); return; }
        out.appendChild(CN.note('info', 'Need ' + count.get() + ' subnets: borrow ' + r.borrowed + ' host bit' + (r.borrowed === 1 ? '' : 's') + ' (2^' + r.borrowed + ' = ' + r.total + '). The prefix grows from /' + p + ' to /' + r.newPrefix + ' and each subnet has ' + r.subnets[0].hosts.toLocaleString('en-US') + ' usable hosts.' + (r.total > 256 ? ' Showing the first 256.' : '')));
        out.appendChild(CN.panel('Address space', 'Each coloured block is one subnet.', allocBar(r.subnets.map((s) => ({ size: s.size, prefix: s.prefix, info: s })), whole.size, whole.network)));
        out.appendChild(CN.panel('Subnets', null, tbl(['#', 'Network', 'First host', 'Last host', 'Broadcast'], r.subnets.map((s, i) => h('tr', null, h('td', null, String(i + 1)), h('td', { class: 'mono' }, str(s.network) + '/' + s.prefix), h('td', { class: 'num mono' }, str(s.first)), h('td', { class: 'num mono' }, str(s.last)), h('td', { class: 'num mono' }, str(s.broadcast)))))));
      } else {
        const list = needs.get().split(',').map((x) => x.trim()).filter(Boolean).map(Number);
        if (!list.length || list.some((x) => !Number.isInteger(x) || x < 1 || x > 16777214)) { needs.invalid(true); out.appendChild(CN.note('warn', 'Type whole numbers separated by commas, for example 100, 50, 20, 2.')); return; }
        needs.invalid(false);
        const r = S.vlsm(b, p, list);
        if (r.error) { out.appendChild(CN.note('bad', r.error)); return; }
        out.appendChild(CN.note('info', 'VLSM gives each department the smallest block that fits, largest first so every block starts on a correct boundary. Used ' + r.used + ' of ' + r.space + ' addresses (' + CN.pct(r.used / r.space, 0) + '). A fixed equal split would have wasted far more.'));
        out.appendChild(CN.panel('Address space', 'Blocks are packed from the start; grey is still free.', allocBar(r.rows, r.space, whole.network)));
        out.appendChild(CN.panel('Allocation', null, tbl(['Needs', 'Network', 'Mask', 'Usable range', 'Spare hosts'], r.rows.map((x) => h('tr', null,
          h('td', null, x.need + ' hosts'), h('td', { class: 'mono' }, str(x.info.network) + '/' + x.prefix), h('td', { class: 'num mono' }, str(x.info.mask)),
          h('td', { class: 'num mono' }, str(x.info.first) + ' to ' + str(x.info.last)), h('td', { class: 'num' }, String(x.wasted)))))));
      }
    }
    refresh();
    return h('div', { class: 'workbench' }, controls, out);
  }

  /* ---------------------------------------------------------------- same subnet? */
  function buildSame() {
    const a = CN.textField({ label: 'Host A', value: '192.168.10.70', mono: true, onInput: refresh });
    const b = CN.textField({ label: 'Host B', value: '192.168.10.130', mono: true, onInput: refresh });
    const pre = CN.slider({ label: 'Subnet mask (both hosts)', min: 8, max: 30, value: 26, format: (v) => '/' + v + '  (' + str(S.maskFromPrefix(v)) + ')', onInput: refresh });
    const out = h('div', { class: 'stage' });
    const controls = h('div', { class: 'controls' }, h('h3', null, 'Two hosts'), a.el, b.el, pre.el);
    function refresh() {
      CN.clear(out);
      const x = S.parseIp(a.get()); const y = S.parseIp(b.get());
      a.invalid(x === null); b.invalid(y === null);
      if (x === null || y === null) { out.appendChild(CN.note('warn', 'Both addresses must be valid IPv4 addresses.')); return; }
      const p = pre.get(); const r = S.sameSubnet(x, y, p); const ai = S.analyze(x, p);
      out.appendChild(CN.panel('Each host ANDs its address with the mask', 'Same network address means the hosts are on the same subnet.',
        bitRow(x, p, 'Host A', { dotted: str(x) }), bitRow(y, p, 'Host B', { dotted: str(y) }), bitRow(ai.mask, p, 'Mask', { dotted: str(ai.mask) }),
        h('div', { class: 'iprule' }, 'AND each host with the mask'),
        bitRow(r.netA, p, 'Network of A', { dotted: str(r.netA) }), bitRow(r.netB, p, 'Network of B', { dotted: str(r.netB) }), bitKey()));
      out.appendChild(CN.note(r.same ? 'good' : 'bad', r.same
        ? 'Same network (' + str(r.netA) + '/' + p + '). The hosts can reach each other directly using ARP and a switch, with no router.'
        : 'Different networks (' + str(r.netA) + ' and ' + str(r.netB) + '). Host A sees B as off-link, so it sends the packet to its default gateway and a router must forward it.'));
    }
    refresh();
    return h('div', { class: 'workbench' }, controls, out);
  }

  /* ---------------------------------------------------------------- summarise */
  function buildSummary() {
    const list = CN.textField({ label: 'Networks to summarise', value: '192.168.0.0/24\n192.168.1.0/24\n192.168.2.0/24\n192.168.3.0/24', mono: true, multiline: true, rows: 6, onInput: refresh, hint: 'One per line, written as address/prefix.' });
    const out = h('div', { class: 'stage' });
    const controls = h('div', { class: 'controls' }, h('h3', null, 'Routes'), list.el);
    function refresh() {
      CN.clear(out);
      const parsed = list.get().split('\n').map((s) => s.trim()).filter(Boolean).map(S.parseCidr);
      if (!parsed.length || parsed.some((x) => !x || x.prefix === null)) { list.invalid(true); out.appendChild(CN.note('warn', 'Write each network as address/prefix, for example 192.168.0.0/24.')); return; }
      list.invalid(false);
      const r = S.aggregate(parsed); const s = r.summary;
      out.appendChild(CN.panel('One route instead of many', 'The summary is the smallest block whose network bits all your networks share.',
        ...parsed.map((x, i) => bitRow(S.analyze(x.ip, x.prefix).network, x.prefix, 'Net ' + (i + 1), { dotted: str(S.analyze(x.ip, x.prefix).network) + '/' + x.prefix })),
        h('div', { class: 'iprule' }, 'common leading bits'),
        bitRow(s.network, s.prefix, 'Summary', { dotted: str(s.network) + '/' + s.prefix }), bitKey()));
      out.appendChild(CN.note(r.extra === 0 ? 'good' : 'warn', r.extra === 0
        ? 'Perfect summary: ' + str(s.network) + '/' + s.prefix + ' covers exactly these networks, so a router can advertise 1 route instead of ' + parsed.length + '.'
        : str(s.network) + '/' + s.prefix + ' covers these networks but also ' + r.extra.toLocaleString('en-US') + ' addresses you did not list. Advertising it would attract traffic for those addresses too.'));
    }
    refresh();
    return h('div', { class: 'workbench' }, controls, out);
  }

  CN.registerTab({
    id: 'subnet',
    group: { layer: 3, name: 'Network' },
    title: 'Subnetting',
    mount(page) {
      page.appendChild(CN.pageHead({
        title: 'IP addressing and subnetting',
        lead: 'Every IPv4 address is a network part plus a host part, and the mask says where the split is. Type an address and see the split, divide a network, test whether two hosts share a subnet, or summarise routes.',
        units: [{ unit: 4, name: 'Network Layer' }],
        topics: ['IP addressing', 'subnetting and VLSM', 'route summarisation'],
      }));
      const modes = [{ id: 'calc', label: 'Calculator', build: buildCalc }, { id: 'divide', label: 'Divide a network', build: buildDivide }, { id: 'same', label: 'Same subnet?', build: buildSame }, { id: 'sum', label: 'Summarise routes', build: buildSummary }];
      const built = {}; const holder = h('div', { style: 'margin-top:6px' });
      const seg = CN.segmented({ label: 'Mode', options: modes.map((m) => ({ value: m.id, label: m.label })), value: 'calc', onChange: show });
      function show(id) {
        modes.forEach((m) => { if (built[m.id]) built[m.id].style.display = 'none'; });
        if (!built[id]) { built[id] = modes.find((m) => m.id === id).build(); holder.appendChild(built[id]); }
        built[id].style.display = '';
      }
      page.appendChild(h('div', { class: 'row' }, seg.el)); page.appendChild(holder); show('calc');
      page.appendChild(CN.section('How it works', 'Short notes for revision', h('div', { class: 'stage', style: 'gap:10px' },
        CN.theory('Prefix, mask and the two special addresses', '<ul><li>An address is 32 bits. <b>/26</b> means the first 26 bits are the network part and the last 6 are the host part. The mask is those 26 ones followed by 6 zeros: 255.255.255.192.</li><li><b>Network address</b>: host bits all 0. <b>Broadcast address</b>: host bits all 1. Neither can be given to a host, so usable hosts = 2<sup>h</sup> - 2, where h is the number of host bits.</li><li>Network address = address AND mask.</li></ul>'),
        CN.theory('Subnetting and VLSM', '<ul><li>To make <i>n</i> equal subnets, borrow <i>b</i> bits from the host part where 2<sup>b</sup> is at least n. The prefix grows by b.</li><li><b>VLSM</b> (variable length subnet masks): different subnets get different sizes. Sort the requirements largest first, give each the smallest block that holds hosts + 2, and place blocks on their natural boundaries.</li></ul>'),
        CN.theory('Same subnet, gateways and summarisation', '<ul><li>Two hosts talk directly only if address AND mask gives the same result for both. Otherwise the sender uses its <b>default gateway</b>.</li><li><b>Route summarisation</b> (supernetting) replaces several contiguous routes by one shorter-prefix route, keeping routing tables small. It is exact only if the networks fill the summary block completely.</li></ul>'))));
      return { destroy() {} };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
