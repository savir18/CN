/* ==========================================================================
   Tab: Error detection and correction  (Unit 3, Data Link Layer)
   Part 1 - plain logic: Hamming code, CRC, Internet checksum, Monte Carlo lab.
            This part has no DOM code so the same file is unit-tested in node.
   Part 2 - the user interface.
   ========================================================================== */
(function (root) {
  'use strict';
  const CN = (root.CN = root.CN || {});
  const ED = (CN.errorDetection = {});

  const toBits = (s) => s.split('').map(Number);
  const isBitString = (s) => /^[01]+$/.test(s);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const isPow2 = (x) => x > 0 && (x & (x - 1)) === 0;
  ED.isBitString = isBitString;

  /* ======================================================================
     HAMMING CODE
     Parity bits live at positions 1, 2, 4, 8 ... Parity bit p checks every
     position whose binary number contains p. Positions are numbered from 1.
     ====================================================================== */

  // smallest r with 2^r >= m + r + 1
  ED.parityBitCount = function (m) {
    let r = 0;
    while ((1 << r) < m + r + 1) r++;
    return r;
  };

  ED.hammingEncode = function (data, opts) {
    opts = opts || {};
    const target = opts.parity === 'odd' ? 1 : 0; // parity every check must reach
    const m = data.length;
    const r = ED.parityBitCount(m);
    const n = m + r;
    const cw = new Array(n).fill(0); // cw[pos-1] is the bit at position pos
    const roles = new Array(n);
    let di = 0;
    for (let pos = 1; pos <= n; pos++) {
      if (isPow2(pos)) roles[pos - 1] = { type: 'p', label: 'p' + pos };
      else { cw[pos - 1] = Number(data[di]); di++; roles[pos - 1] = { type: 'd', label: 'd' + di }; }
    }
    const steps = [];
    for (let k = 0; k < r; k++) {
      const p = 1 << k;
      const covered = [];
      for (let pos = 1; pos <= n; pos++) if ((pos & p) && pos !== p) covered.push(pos);
      const ones = covered.reduce((s, pos) => s + cw[pos - 1], 0);
      const value = ones % 2 === target ? 0 : 1; // make (ones + value) reach the target parity
      cw[p - 1] = value;
      steps.push({ parityPos: p, covered, bits: covered.map((pos) => cw[pos - 1]), ones, value });
    }
    let overall = null;
    if (opts.extended) overall = sum(cw) % 2 === target ? 0 : 1;
    return { m, r, n, cw, roles, steps, overall, target, extended: !!opts.extended };
  };

  ED.extractData = function (cw) {
    const out = [];
    for (let pos = 1; pos <= cw.length; pos++) if (!isPow2(pos)) out.push(cw[pos - 1]);
    return out.join('');
  };

  /* Receiver side. overall is the extra parity bit (or null). Returns every check so the UI can show the work. */
  ED.hammingDecode = function (cw, overall, opts) {
    opts = opts || {};
    const target = opts.parity === 'odd' ? 1 : 0;
    const n = cw.length;
    let r = 0;
    while ((1 << r) <= n) r++;
    const checks = [];
    let syndrome = 0;
    for (let k = 0; k < r; k++) {
      const p = 1 << k;
      const covered = [];
      for (let pos = 1; pos <= n; pos++) if (pos & p) covered.push(pos);
      const bits = covered.map((pos) => cw[pos - 1]);
      const ones = sum(bits);
      const ok = ones % 2 === target;
      if (!ok) syndrome |= p; // failed checks add up to the position of the bad bit
      checks.push({ parityPos: p, covered, bits, ones, ok });
    }
    const extended = !!opts.extended && overall !== null && overall !== undefined;
    let overallOk = true;
    if (extended) overallOk = (sum(cw) + overall) % 2 === target;

    const fixed = cw.slice();
    let fixedOverall = overall;
    let status; let errorPos = null;
    if (!extended) {
      if (syndrome === 0) status = 'no-error';
      else if (syndrome <= n) { status = 'corrected'; errorPos = syndrome; fixed[syndrome - 1] ^= 1; }
      else status = 'invalid-syndrome';
    } else if (syndrome === 0 && overallOk) status = 'no-error';
    else if (syndrome === 0) { status = 'overall-bit-error'; errorPos = 0; fixedOverall ^= 1; }
    else if (!overallOk) {
      if (syndrome <= n) { status = 'corrected'; errorPos = syndrome; fixed[syndrome - 1] ^= 1; }
      else status = 'invalid-syndrome';
    } else status = 'double-error';

    return { n, r, checks, syndrome, overallOk, extended, status, errorPos, fixed, fixedOverall, data: ED.extractData(fixed) };
  };

  /* ======================================================================
     CRC (cyclic redundancy check) - division with XOR instead of subtraction
     ====================================================================== */
  ED.crcPresets = [
    { id: 'crc3', name: 'CRC-3 (x^3 + x + 1)', gen: '1011' },
    { id: 'crc4', name: 'CRC-4 ITU (x^4 + x + 1)', gen: '10011' },
    { id: 'crc5', name: 'CRC-5 USB (x^5 + x^2 + 1)', gen: '100101' },
    { id: 'crc8', name: 'CRC-8 (x^8 + x^2 + x + 1)', gen: '100000111' },
    { id: 'crc16', name: 'CRC-16 CCITT (x^16 + x^12 + x^5 + 1)', gen: '10001000000100001' },
  ];

  ED.polyToString = function (gen) {
    const terms = [];
    for (let i = 0; i < gen.length; i++) {
      if (gen[i] !== '1') continue;
      const e = gen.length - 1 - i;
      terms.push(e === 0 ? '1' : e === 1 ? 'x' : 'x^' + e);
    }
    return terms.join(' + ');
  };

  /* Long division of a bit string by the generator. Only the first (len - r) positions can start a step. */
  ED.crcDivide = function (bitsStr, gen) {
    const r = gen.length - 1;
    const g = toBits(gen);
    const arr = toBits(bitsStr);
    const steps = [];
    for (let i = 0; i + r < arr.length; i++) {
      if (arr[i] === 1) {
        for (let j = 0; j <= r; j++) arr[i + j] ^= g[j];
        steps.push({ shift: i, after: arr.slice() });
      }
    }
    return { remainder: arr.slice(arr.length - r).join(''), steps, r };
  };

  ED.crcEncode = function (data, gen) {
    const r = gen.length - 1;
    const padded = data + '0'.repeat(r);
    const div = ED.crcDivide(padded, gen);
    return { data, gen, r, padded, remainder: div.remainder, frame: data + div.remainder, steps: div.steps };
  };

  ED.crcCheck = function (frame, gen) {
    const div = ED.crcDivide(frame, gen);
    return { remainder: div.remainder, ok: /^0*$/.test(div.remainder), steps: div.steps };
  };

  /* Which kinds of error does this generator promise to catch? (computed, not just quoted) */
  ED.crcGuarantees = function (gen, frameLen) {
    const r = gen.length - 1;
    const terms = gen.split('').filter((c) => c === '1').length;
    const singleBit = gen[gen.length - 1] === '1' && terms >= 2;
    // a 2-bit error x^k + 1 slips through only if the generator divides it
    let twoBit = true;
    let firstBad = null;
    for (let k = 1; k < frameLen && twoBit; k++) {
      const probe = '1' + '0'.repeat(k - 1) + '1';
      const padded = probe.length > r ? probe : '0'.repeat(r + 1 - probe.length) + probe;
      if (/^0*$/.test(ED.crcDivide(padded, gen).remainder)) { twoBit = false; firstBad = k; }
    }
    return {
      r, terms,
      singleBit,
      twoBit, firstBad,
      oddErrors: terms % 2 === 0, // (x + 1) divides g exactly when g has an even number of terms
      burstUpTo: r,
      missLong: Math.pow(2, -r),
      missBurstR1: Math.pow(2, -(r - 1)),
    };
  };

  /* An error pattern that IS a multiple of the generator is invisible to the CRC. Returns bit positions to flip. */
  ED.undetectableError = function (gen, frameLen, rng) {
    const r = gen.length - 1;
    const maxShift = frameLen - gen.length;
    if (maxShift < 0) return [];
    const shift = rng ? rng.int(0, maxShift) : 0;
    const flips = [];
    for (let j = 0; j < gen.length; j++) if (gen[j] === '1') flips.push(shift + j);
    return flips;
  };

  /* ======================================================================
     INTERNET CHECKSUM (ones' complement sum of w-bit words)
     ====================================================================== */
  ED.textToWords = function (text, w) {
    let bytes;
    if (typeof TextEncoder !== 'undefined') bytes = Array.from(new TextEncoder().encode(text));
    else bytes = text.split('').map((c) => c.charCodeAt(0) & 255);
    let bits = bytes.map((b) => b.toString(2).padStart(8, '0')).join('');
    while (bits.length % w !== 0) bits += '0';
    const words = [];
    for (let i = 0; i < bits.length; i += w) words.push(parseInt(bits.slice(i, i + w), 2));
    return { words, bytes };
  };

  ED.onesComplementSum = function (words, w) {
    const mask = Math.pow(2, w) - 1;
    let acc = 0;
    const steps = [];
    words.forEach((word) => {
      const raw = acc + word;
      let wrapped = false;
      let next = raw;
      if (raw > mask) { next = (raw & mask) + 1; wrapped = true; } // end-around carry
      steps.push({ word, before: acc, raw, wrapped, after: next });
      acc = next;
    });
    return { sum: acc, steps, mask };
  };

  ED.checksumGenerate = function (words, w) {
    const s = ED.onesComplementSum(words, w);
    return { sum: s.sum, checksum: (~s.sum) & s.mask, steps: s.steps, mask: s.mask };
  };

  ED.checksumVerify = function (words, checksum, w) {
    const s = ED.onesComplementSum(words.concat([checksum]), w);
    return { sum: s.sum, ok: s.sum === s.mask, steps: s.steps, mask: s.mask };
  };

  /* ======================================================================
     MONTE CARLO LAB - how often does each scheme notice k random bit errors?
     ====================================================================== */
  function crcRegister(bits, r, polyLow) {
    // the shift-register form of long division: very fast, gives the same remainder
    const mask = (1 << r) - 1;
    let reg = 0;
    for (let i = 0; i < bits.length; i++) {
      const fb = ((reg >>> (r - 1)) & 1) ^ bits[i];
      reg = (reg << 1) & mask;
      if (fb) reg ^= polyLow;
    }
    return reg;
  }
  const numToBits = (num, width, out) => { for (let i = width - 1; i >= 0; i--) out.push((num >>> i) & 1); };

  function crcScheme(name, gen) {
    const r = gen.length - 1;
    const polyLow = parseInt(gen.slice(1), 2);
    return {
      name,
      encode(data) { const crc = crcRegister(data, r, polyLow); const f = data.slice(); numToBits(crc, r, f); return f; },
      detects(frame) { return crcRegister(frame, r, polyLow) !== 0; },
    };
  }
  function checksumScheme(name, w) {
    const mask = Math.pow(2, w) - 1;
    function total(bits, count) {
      let acc = 0;
      for (let i = 0; i < count; i += w) {
        let word = 0;
        for (let j = 0; j < w; j++) word = (word << 1) | bits[i + j];
        acc += word;
        if (acc > mask) acc = (acc & mask) + 1;
      }
      return acc;
    }
    return {
      name,
      encode(data) { const c = (~total(data, data.length)) & mask; const f = data.slice(); numToBits(c, w, f); return f; },
      detects(frame) { return total(frame, frame.length) !== mask; },
    };
  }
  const paritySchemeObj = {
    name: 'Parity bit',
    encode(data) { const f = data.slice(); f.push(sum(data) % 2); return f; },
    detects(frame) { return sum(frame) % 2 !== 0; },
  };

  ED.labSchemes = [
    paritySchemeObj,
    checksumScheme('Checksum-8', 8),
    crcScheme('CRC-8', '100000111'),
    crcScheme('CRC-16', '10001000000100001'),
  ];

  /* model: 'random' flips k distinct bits anywhere; 'burst' flips a window of length k (first and last bits always flipped). */
  ED.monteCarlo = function (o) {
    const rng = CN.makeRng(o.seed || 1);
    const D = o.dataBits || 64;
    const result = { ks: [], series: {} };
    ED.labSchemes.forEach((s) => { result.series[s.name] = []; });
    for (let k = 1; k <= o.kMax; k++) {
      result.ks.push(k);
      const caught = ED.labSchemes.map(() => 0);
      for (let t = 0; t < o.trials; t++) {
        const data = new Array(D);
        for (let i = 0; i < D; i++) data[i] = rng() < 0.5 ? 1 : 0;
        ED.labSchemes.forEach((s, si) => {
          const frame = s.encode(data);
          const N = frame.length;
          if (o.model === 'burst') {
            const start = rng.int(0, N - k);
            frame[start] ^= 1;
            if (k > 1) {
              frame[start + k - 1] ^= 1;
              for (let i = start + 1; i < start + k - 1; i++) if (rng() < 0.5) frame[i] ^= 1;
            }
          } else {
            const used = new Set();
            while (used.size < k) used.add(rng.int(0, N - 1));
            used.forEach((p) => { frame[p] ^= 1; });
          }
          if (s.detects(frame)) caught[si]++;
        });
      }
      ED.labSchemes.forEach((s, si) => result.series[s.name].push((100 * caught[si]) / o.trials));
    }
    return result;
  };

  if (typeof document === 'undefined') return; // node tests stop here

  /* ======================================================================
     USER INTERFACE
     ====================================================================== */
  const h = CN.h;

  /* A row of clickable bit cells. cells: [{label, tag, value, kind, flipped, found, hot, fixed}] */
  function bitRow(cells, onToggle) {
    return h('div', { class: 'bits' }, cells.map((c, i) => {
      const cls = 'bit' + (c.kind === 'parity' ? ' parity' : '') + (c.flipped ? ' flipped' : '') + (c.found ? ' found' : '') + (c.hot ? ' hot' : '') + (onToggle && !c.fixed ? '' : ' fixed') + (c.small ? ' small' : '');
      const btn = h('button', {
        type: 'button', class: cls, 'aria-pressed': String(!!c.flipped),
        'aria-label': 'Bit ' + (c.name || c.label || i + 1) + ' is ' + c.value + (onToggle && !c.fixed ? '. Press to flip it.' : ''),
      }, String(c.value));
      if (onToggle && !c.fixed) btn.addEventListener('click', () => onToggle(i, c));
      return h('div', { class: 'bit-wrap' },
        h('span', { class: 'bit-pos' }, c.label !== undefined ? String(c.label) : ''),
        btn,
        h('span', { class: 'bit-tag' }, c.tag || ''));
    }));
  }

  function randomBits(n, rng) { let s = ''; for (let i = 0; i < n; i++) s += rng() < 0.5 ? '1' : '0'; return s; }
  const uiRng = CN.makeRng(CN.randomSeed());

  /* ---------------------------------------------------------------- Hamming */
  function buildHamming() {
    const flips = new Set(); // positions flipped in transit; 0 = the overall parity bit
    let lastKey = '';
    const dataField = CN.textField({ label: 'Data bits', value: '1011001', mono: true, hint: 'Between 1 and 26 bits, only 0 and 1.', onInput: refresh });
    const parity = CN.segmented({ label: 'Parity type', options: [{ value: 'even', label: 'Even parity' }, { value: 'odd', label: 'Odd parity' }], value: 'even', onChange: refresh });
    const ext = CN.check({ label: 'Extended Hamming (adds one overall parity bit)', onChange: refresh });

    const sentBox = h('div'); const stepsBox = h('div'); const chanBox = h('div'); const recvBox = h('div'); const verdict = h('div');
    const ro = { m: CN.readout('Data bits (m)'), r: CN.readout('Parity bits (r)'), n: CN.readout('Codeword (n)'), rate: CN.readout('Code rate m/n') };

    const controls = h('div', { class: 'controls' },
      h('h3', null, 'Send'),
      dataField.el, parity.el, ext.el,
      h('div', { class: 'row tight' },
        CN.button('Random data', { onClick: () => { dataField.set(randomBits(CN.makeRng(CN.randomSeed()).int(4, 16), uiRng)); flips.clear(); refresh(); } })),
      h('h3', null, 'Break it'),
      h('div', { class: 'field-hint' }, 'Click any bit in the channel panel to flip it, or use these.'),
      h('div', { class: 'row tight' },
        CN.button('Flip 1 random bit', { onClick: () => injectRandom(1) }),
        CN.button('Flip 2 random bits', { onClick: () => injectRandom(2) }),
        CN.button('Clear errors', { onClick: () => { flips.clear(); refresh(); } })));

    function injectRandom(k) {
      const enc = currentEncoding();
      if (!enc) return;
      flips.clear();
      const pool = [];
      for (let p = 1; p <= enc.n; p++) pool.push(p);
      if (enc.extended) pool.push(0);
      while (flips.size < Math.min(k, pool.length)) flips.add(pool[uiRng.int(0, pool.length - 1)]);
      refresh();
    }

    function currentEncoding() {
      const d = dataField.get().trim();
      const valid = d.length >= 1 && d.length <= 26 && isBitString(d);
      dataField.invalid(!valid && d.length > 0);
      if (!valid) return null;
      return ED.hammingEncode(d, { parity: parity.get(), extended: ext.get() });
    }

    function refresh() {
      const enc = currentEncoding();
      if (!enc) {
        CN.clear(sentBox); CN.clear(stepsBox); CN.clear(chanBox); CN.clear(recvBox); CN.clear(verdict);
        verdict.appendChild(CN.note('warn', 'Enter between 1 and 26 data bits made of 0 and 1.'));
        return;
      }
      const key = enc.n + (enc.extended ? 'x' : '');
      if (key !== lastKey) { flips.clear(); lastKey = key; }
      const typeWord = parity.get() === 'odd' ? 'odd' : 'even';
      const data = dataField.get().trim();
      ro.m.set(String(enc.m)); ro.r.set(String(enc.r)); ro.n.set(String(enc.n + (enc.extended ? 1 : 0)));
      ro.rate.set(CN.fmt(enc.m / (enc.n + (enc.extended ? 1 : 0)), 2));

      // --- sender
      const sentCells = enc.cw.map((v, i) => ({ label: i + 1, tag: enc.roles[i].label, value: v, kind: enc.roles[i].type === 'p' ? 'parity' : '', fixed: true }));
      if (enc.extended) sentCells.push({ label: 'all', tag: 'p0', value: enc.overall, kind: 'parity', fixed: true });
      CN.clear(sentBox); sentBox.appendChild(bitRow(sentCells, null));

      CN.clear(stepsBox);
      stepsBox.appendChild(h('ol', { class: 'steps' }, enc.steps.map((s) => h('li', null,
        h('b', null, 'p' + s.parityPos), ' checks positions ', h('span', { class: 'calc' }, s.covered.join(', ')),
        ' holding ', h('span', { class: 'calc' }, s.bits.join(' ') || 'nothing'), ': ', s.ones + ' ones, so set p' + s.parityPos + ' = ' + s.value + ' to make the group ' + typeWord + '.'))
        .concat(enc.extended ? [h('li', null, h('b', null, 'p0'), ' covers the whole codeword: ', sum(enc.cw) + ' ones, so p0 = ' + enc.overall + '.')] : [])));

      // --- channel (clickable)
      const recv = enc.cw.map((v, i) => (flips.has(i + 1) ? v ^ 1 : v));
      const recvOverall = enc.extended ? (flips.has(0) ? enc.overall ^ 1 : enc.overall) : null;
      const chanCells = recv.map((v, i) => ({ label: i + 1, tag: enc.roles[i].label, value: v, kind: enc.roles[i].type === 'p' ? 'parity' : '', flipped: flips.has(i + 1) }));
      if (enc.extended) chanCells.push({ label: 'all', tag: 'p0', value: recvOverall, kind: 'parity', flipped: flips.has(0) });
      CN.clear(chanBox);
      chanBox.appendChild(bitRow(chanCells, (i) => {
        const pos = i < enc.n ? i + 1 : 0;
        if (flips.has(pos)) flips.delete(pos); else flips.add(pos);
        refresh();
      }));
      chanBox.appendChild(h('div', { class: 'field-hint', style: 'margin-top:8px' },
        flips.size ? flips.size + ' bit' + (flips.size > 1 ? 's' : '') + ' flipped (red outline).' : 'No bits flipped yet.'));

      // --- receiver
      const dec = ED.hammingDecode(recv, recvOverall, { parity: parity.get(), extended: enc.extended });
      CN.clear(recvBox);
      recvBox.appendChild(h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Check'), h('th', null, 'Positions'), h('th', null, 'Bits'), h('th', { class: 'num' }, 'Ones'), h('th', null, 'Result'))),
        h('tbody', null,
          dec.checks.map((c) => h('tr', { class: c.ok ? 'ok' : 'fail' },
            h('td', null, 'p' + c.parityPos), h('td', { class: 'mono' }, c.covered.join(', ')), h('td', { class: 'mono' }, c.bits.join(' ')),
            h('td', { class: 'num' }, String(c.ones)), h('td', null, c.ok ? 'passes (' + typeWord + ')' : 'FAILS'))),
          dec.extended ? h('tr', { class: dec.overallOk ? 'ok' : 'fail' },
            h('td', null, 'p0'), h('td', { class: 'mono' }, 'all'), h('td', { class: 'mono' }, '-'),
            h('td', { class: 'num' }, String(sum(recv) + recvOverall)), h('td', null, dec.overallOk ? 'passes' : 'FAILS')) : null))));
      const synBits = dec.checks.map((c) => (c.ok ? '0' : '1')).reverse().join('');
      recvBox.appendChild(h('p', { style: 'margin-top:10px' },
        'Failed checks, read as a binary number (highest check first): ', h('span', { class: 'calc' }, synBits),
        ' = ', h('b', null, 'position ' + dec.syndrome), dec.syndrome === 0 ? ' (nothing points at a bad bit).' : ' (this is where the receiver thinks the error is).'));

      // --- verdict
      CN.clear(verdict);
      const sameData = dec.data === data;
      const flipCount = flips.size;
      let kind; let text;
      if (dec.status === 'no-error' && flipCount === 0) { kind = 'good'; text = 'All checks pass. The codeword arrived unchanged, so the data is ' + dec.data + '.'; }
      else if (dec.status === 'no-error') { kind = 'bad'; text = flipCount + ' bits were flipped but every check still passes. The error pattern was itself a valid codeword, so it went completely unnoticed.'; }
      else if (dec.status === 'overall-bit-error') { kind = sameData ? 'good' : 'bad'; text = 'Only the overall parity bit p0 failed, so the error was in p0 itself. The data bits are fine: ' + dec.data + '.'; }
      else if (dec.status === 'double-error') { kind = 'warn'; text = 'Extended Hamming sees the checks fail but the overall parity still passes. That pattern means two bits are wrong: the error is detected but cannot be corrected, so the receiver would ask for a retransmission.'; }
      else if (dec.status === 'invalid-syndrome') { kind = 'warn'; text = 'The failed checks point at position ' + dec.syndrome + ', which does not exist in a ' + enc.n + '-bit codeword. More than one bit must be wrong. Detected, not correctable.'; }
      else if (sameData) { kind = 'good'; text = 'Position ' + dec.errorPos + ' was flipped back. The data is recovered correctly: ' + dec.data + '.'; }
      else {
        kind = 'bad';
        text = 'The receiver flipped position ' + dec.errorPos + ' and believes the data is ' + dec.data + ', but the original was ' + data + '. With ' + flipCount + ' errors a plain Hamming code "corrects" the wrong bit. ' + (enc.extended ? '' : 'Tick Extended Hamming to at least detect two-bit errors.');
      }
      verdict.appendChild(CN.note(kind, text));
      // mark the bit the receiver blames in the channel row
      if (dec.errorPos && dec.errorPos > 0) {
        const cells = chanBox.querySelectorAll('.bit');
        const cell = cells[dec.errorPos - 1];
        if (cell) cell.classList.add('hot');
      }
    }

    const stage = h('div', { class: 'stage' },
      CN.panel('Sender: build the codeword', 'Blue cells are parity bits; the others are your data bits in order.', sentBox, h('div', { style: 'margin-top:12px' }, stepsBox)),
      h('div', { class: 'readouts' }, ro.m.el, ro.r.el, ro.n.el, ro.rate.el),
      CN.panel('Channel: flip bits', 'Each click flips one bit, like noise on the wire. Position numbers are above, names below.', chanBox),
      CN.panel('Receiver: run the parity checks', null, recvBox),
      verdict);
    refresh();
    return h('div', { class: 'workbench' }, controls, stage);
  }

  /* ---------------------------------------------------------------- CRC */
  function renderDivision(container, startBits, steps, r, gen, caption) {
    CN.clear(container);
    const total = startBits.length;
    const cells = (arr, win, dimBefore) => arr.map((b, i) => {
      const cls = (win && i >= win[0] && i <= win[1] ? 'win ' : '') + (dimBefore !== undefined && i < dimBefore ? 'zero' : '');
      return h('span', { class: cls.trim() }, String(b));
    });
    const grid = h('div', { class: 'divgrid', style: 'max-height:420px;overflow-y:auto' });
    grid.appendChild(h('div', { class: 'divrow' }, cells(toBits(startBits)), h('span', { class: 'cap' }, caption)));
    if (!steps.length) grid.appendChild(h('div', { class: 'divrow' }, h('span', { class: 'cap', style: 'margin-left:0' }, 'The leading bits are all 0, so no XOR step is needed.')));
    steps.forEach((st) => {
      const pad = new Array(st.shift).fill(' ');
      const genCells = pad.concat(toBits(gen).map(String)).map((c) => h('span', null, c));
      grid.appendChild(h('div', { class: 'divrow line-gen' }, genCells, h('span', { class: 'cap' }, 'XOR the generator at shift ' + st.shift)));
      grid.appendChild(h('div', { class: 'divrow line' }, cells(st.after, [st.shift, st.shift + r], st.shift + 1)));
    });
    container.appendChild(grid);
    return total;
  }

  function buildCrc() {
    const flips = new Set();
    let lastLen = -1;
    const dataField = CN.textField({ label: 'Data bits', value: '1101011011', mono: true, hint: 'Between 1 and 32 bits.', onInput: refresh });
    const preset = CN.select({ label: 'Generator polynomial', options: ED.crcPresets.map((p) => ({ value: p.id, label: p.name })).concat([{ value: 'custom', label: 'Custom bit pattern' }]), value: 'crc3', onChange: refresh });
    const custom = CN.textField({ label: 'Custom generator', value: '1101', mono: true, hint: 'Must start and end with 1, and have at least 2 bits.', onInput: refresh });
    custom.el.style.display = 'none';
    const burstLen = CN.slider({ label: 'Burst length', min: 2, max: 12, value: 4, format: (v) => v + ' bits' });

    const polyBox = h('div'); const guarBox = h('div'); const encBox = h('div'); const divBox = h('div');
    const chanBox = h('div'); const recvBox = h('div'); const verdict = h('div'); const recvDiv = h('div');

    const controls = h('div', { class: 'controls' },
      h('h3', null, 'Send'), dataField.el, preset.el, custom.el,
      CN.button('Random data', { onClick: () => { dataField.set(randomBits(uiRng.int(6, 20), uiRng)); flips.clear(); refresh(); } }),
      h('h3', null, 'Break it'),
      h('div', { class: 'field-hint' }, 'Click bits in the channel panel, or use these.'),
      h('div', { class: 'row tight' },
        CN.button('Flip 1 random bit', { onClick: () => injectRandom(1) }),
        CN.button('Flip 3 random bits', { onClick: () => injectRandom(3) })),
      burstLen.el,
      h('div', { class: 'row tight' },
        CN.button('Inject burst', { onClick: injectBurst }),
        CN.button('Craft a hidden error', { title: 'Flip exactly the bits of a multiple of the generator', onClick: injectHidden })),
      CN.button('Clear errors', { onClick: () => { flips.clear(); refresh(); } }));

    function gen() {
      if (preset.get() === 'custom') {
        const g = custom.get().trim();
        const ok = /^1[01]*1$/.test(g) && g.length >= 2 && g.length <= 17;
        custom.invalid(!ok);
        return ok ? g : null;
      }
      return ED.crcPresets.find((p) => p.id === preset.get()).gen;
    }
    function currentEnc() {
      custom.el.style.display = preset.get() === 'custom' ? '' : 'none';
      const d = dataField.get().trim();
      const g = gen();
      const valid = d.length >= 1 && d.length <= 32 && isBitString(d);
      dataField.invalid(!valid && d.length > 0);
      if (!valid || !g) return null;
      return ED.crcEncode(d, g);
    }
    function injectRandom(k) {
      const e = currentEnc(); if (!e) return;
      flips.clear();
      while (flips.size < Math.min(k, e.frame.length)) flips.add(uiRng.int(0, e.frame.length - 1));
      refresh();
    }
    function injectBurst() {
      const e = currentEnc(); if (!e) return;
      flips.clear();
      const k = Math.min(burstLen.get(), e.frame.length);
      const start = uiRng.int(0, e.frame.length - k);
      flips.add(start); flips.add(start + k - 1);
      for (let i = start + 1; i < start + k - 1; i++) if (uiRng() < 0.5) flips.add(i);
      refresh();
    }
    function injectHidden() {
      const e = currentEnc(); if (!e) return;
      flips.clear();
      ED.undetectableError(e.gen, e.frame.length, uiRng).forEach((p) => flips.add(p));
      refresh();
    }

    function refresh() {
      const enc = currentEnc();
      if (!enc) {
        [polyBox, guarBox, encBox, divBox, chanBox, recvBox, recvDiv].forEach(CN.clear);
        CN.clear(verdict);
        verdict.appendChild(CN.note('warn', 'Enter 1 to 32 data bits and a valid generator (starts and ends with 1).'));
        return;
      }
      if (enc.frame.length !== lastLen) { flips.clear(); lastLen = enc.frame.length; }

      CN.clear(polyBox);
      polyBox.appendChild(h('p', { style: 'margin:0' }, 'G(x) = ', h('b', { class: 'mono' }, ED.polyToString(enc.gen)),
        '   (bits ', h('span', { class: 'calc' }, enc.gen), ', degree r = ' + enc.r + ', so ' + enc.r + ' check bits are added)'));

      const gu = ED.crcGuarantees(enc.gen, enc.frame.length);
      CN.clear(guarBox);
      const row = (ok, what, why) => h('tr', { class: ok ? 'ok' : 'fail' }, h('td', null, what), h('td', null, ok ? 'Always caught' : 'Can slip through'), h('td', null, why));
      guarBox.appendChild(h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Error type'), h('th', null, 'This generator'), h('th', null, 'Why'))),
        h('tbody', null,
          row(gu.singleBit, 'Any single-bit error', 'x^i is never a multiple of G(x) when G has a constant term of 1.'),
          row(gu.twoBit, 'Any two-bit error (frame of ' + enc.frame.length + ' bits)', gu.twoBit ? 'G(x) does not divide x^k + 1 for any gap k in this frame.' : 'G(x) divides x^' + gu.firstBad + ' + 1, so two flipped bits ' + gu.firstBad + ' apart are invisible.'),
          row(gu.oddErrors, 'Any odd number of bit errors', gu.oddErrors ? 'G has an even number of terms, so (x + 1) divides it.' : 'G has an odd number of terms, so (x + 1) is not a factor.'),
          row(true, 'Any burst up to ' + gu.burstUpTo + ' bits', 'A burst shorter than the CRC length cannot be a multiple of G(x).'),
          h('tr', null, h('td', null, 'Longer bursts'), h('td', null, 'Missed about ' + CN.fmt(gu.missLong * 100, gu.r >= 10 ? 4 : 2) + '%'), h('td', null, 'One chance in 2^' + gu.r + ' that a random long error is a multiple of G(x).'))))));

      CN.clear(encBox);
      encBox.appendChild(h('ol', { class: 'steps' },
        h('li', null, 'Append ' + enc.r + ' zeros to the data: ', h('span', { class: 'calc' }, enc.padded)),
        h('li', null, 'Divide by ', h('span', { class: 'calc' }, enc.gen), ' using XOR (no borrows). The remainder is the CRC: ', h('b', { class: 'mono' }, enc.remainder)),
        h('li', null, 'Send data + CRC: ', h('span', { class: 'calc' }, enc.data + ' ' + enc.remainder))));
      renderDivision(divBox, enc.padded, enc.steps, enc.r, enc.gen, 'dividend = data + ' + enc.r + ' zeros');

      // channel
      const recvBits = toBits(enc.frame).map((b, i) => (flips.has(i) ? b ^ 1 : b));
      const cells = recvBits.map((v, i) => ({ label: i + 1, tag: i < enc.data.length ? '' : 'crc', value: v, kind: i < enc.data.length ? '' : 'parity', flipped: flips.has(i), small: enc.frame.length > 24 }));
      CN.clear(chanBox);
      chanBox.appendChild(bitRow(cells, (i) => { if (flips.has(i)) flips.delete(i); else flips.add(i); refresh(); }));
      chanBox.appendChild(h('div', { class: 'field-hint', style: 'margin-top:8px' }, flips.size ? flips.size + ' bit' + (flips.size > 1 ? 's' : '') + ' flipped (red outline).' : 'No bits flipped yet.'));

      // receiver
      const frameStr = recvBits.join('');
      const chk = ED.crcCheck(frameStr, enc.gen);
      CN.clear(recvBox);
      recvBox.appendChild(h('p', { style: 'margin:0' }, 'Receiver divides the ' + frameStr.length + '-bit frame by G(x). Remainder = ', h('b', { class: 'mono' }, chk.remainder), chk.ok ? ' (all zeros: accept)' : ' (not zero: reject)', '.'));
      CN.clear(recvDiv);
      const det = h('details', { class: 'chart-table' }, h('summary', null, 'Show the receiver\'s long division'));
      det.addEventListener('toggle', () => {
        if (!det.open) return;
        const holder = h('div'); renderDivision(holder, frameStr, chk.steps, enc.r, enc.gen, 'received frame');
        while (det.childNodes.length > 1) det.removeChild(det.lastChild);
        det.appendChild(holder);
      });
      recvDiv.appendChild(det);

      CN.clear(verdict);
      const changed = frameStr !== enc.frame;
      if (!changed) verdict.appendChild(CN.note('good', 'Frame arrived unchanged, remainder is zero, accepted.'));
      else if (!chk.ok) verdict.appendChild(CN.note('good', 'Error detected: ' + flips.size + ' bit' + (flips.size > 1 ? 's' : '') + ' changed and the remainder is not zero. The frame is discarded and the sender will be asked to resend.'));
      else verdict.appendChild(CN.note('bad', 'Undetected error: ' + flips.size + ' bits changed but the remainder is still zero. The flipped pattern is exactly a multiple of G(x), so the receiver accepts corrupted data.'));
    }

    const stage = h('div', { class: 'stage' },
      CN.panel('Generator', null, polyBox, h('div', { style: 'margin-top:12px' }, guarBox)),
      CN.panel('Sender: compute the CRC', 'Binary long division with XOR. Highlighted cells show where the generator is applied.', encBox, h('div', { style: 'margin-top:10px' }, divBox)),
      CN.panel('Channel: flip bits', 'Blue cells are the CRC bits appended by the sender.', chanBox),
      CN.panel('Receiver: divide again', null, recvBox, recvDiv),
      verdict);
    refresh();
    return h('div', { class: 'workbench' }, controls, stage);
  }

  /* ---------------------------------------------------------------- Checksum */
  function buildChecksum() {
    const flips = new Set(); // "wordIndex:bit"
    let swapped = null; // [i, j] if the user swapped two words
    let lastWords = -1;
    const text = CN.textField({ label: 'Message', value: 'HELLO LAB', hint: 'Up to 24 characters. Each character becomes one byte (ASCII).', onInput: () => { flips.clear(); swapped = null; refresh(); } });
    const wsel = CN.segmented({ label: 'Word size', options: [{ value: 8, label: '8-bit words' }, { value: 16, label: '16-bit words' }], value: 16, onChange: () => { flips.clear(); swapped = null; refresh(); } });

    const sendBox = h('div'); const chanBox = h('div'); const recvBox = h('div'); const verdict = h('div');

    const controls = h('div', { class: 'controls' },
      h('h3', null, 'Send'), text.el,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Word size'), wsel.el),
      h('h3', null, 'Break it'),
      h('div', { class: 'field-hint' }, 'Click bits in the channel panel, or use these.'),
      h('div', { class: 'row tight' },
        CN.button('Flip 1 random bit', { onClick: () => { const m = model(); if (!m) return; flips.clear(); swapped = null; flips.add(uiRng.int(0, m.words.length - 1) + ':' + uiRng.int(0, m.w - 1)); refresh(); } }),
        CN.button('Swap two words', { title: 'Reorders the message without changing the sum', onClick: swapWords })),
      CN.button('Clear errors', { onClick: () => { flips.clear(); swapped = null; refresh(); } }));

    function model() {
      const t = text.get();
      if (!t.length || t.length > 24) { text.invalid(t.length > 24); return null; }
      text.invalid(false);
      const w = wsel.get();
      const conv = ED.textToWords(t, w);
      return { w, words: conv.words, bytes: conv.bytes, gen: ED.checksumGenerate(conv.words, w) };
    }

    function swapWords() {
      const m = model(); if (!m || m.words.length < 2) return;
      flips.clear();
      // choose two different word values so the swap actually changes the message
      for (let tries = 0; tries < 30; tries++) {
        const i = uiRng.int(0, m.words.length - 1); const j = uiRng.int(0, m.words.length - 1);
        if (i !== j && m.words[i] !== m.words[j]) { swapped = [Math.min(i, j), Math.max(i, j)]; refresh(); return; }
      }
      swapped = null;
      refresh();
      CN.clear(verdict);
      verdict.appendChild(CN.note('warn', 'All words are identical, so swapping changes nothing. Type a different message.'));
    }

    const hex = (v, w) => '0x' + v.toString(16).toUpperCase().padStart(w / 4, '0');
    const bin = (v, w) => v.toString(2).padStart(w, '0');

    function refresh() {
      const m = model();
      if (!m) {
        [sendBox, chanBox, recvBox, verdict].forEach(CN.clear);
        verdict.appendChild(CN.note('warn', 'Enter a message of 1 to 24 characters.'));
        return;
      }
      if (m.words.length !== lastWords) { flips.clear(); swapped = null; lastWords = m.words.length; }
      const { w, words, gen } = m;
      const charsPer = w / 8;

      // sender table
      CN.clear(sendBox);
      sendBox.appendChild(h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Word'), h('th', null, 'Text'), h('th', null, 'Binary'), h('th', null, 'Hex'), h('th', null, 'Running sum'))),
        h('tbody', null,
          gen.steps.map((st, i) => {
            const chars = m.bytes.slice(i * charsPer, (i + 1) * charsPer).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('') || '(pad)';
            return h('tr', null, h('td', null, String(i + 1)), h('td', { class: 'mono' }, chars), h('td', { class: 'mono' }, bin(st.word, w)), h('td', { class: 'mono' }, hex(st.word, w)),
              h('td', { class: 'mono' }, hex(st.after, w) + (st.wrapped ? '  (carry wrapped around)' : '')));
          }),
          h('tr', null, h('td', { colspan: 2 }, h('b', null, 'Sum')), h('td', { class: 'mono' }, bin(gen.sum, w)), h('td', { class: 'mono' }, hex(gen.sum, w)), h('td', null, '')),
          h('tr', null, h('td', { colspan: 2 }, h('b', null, 'Checksum = complement of sum')), h('td', { class: 'mono' }, bin(gen.checksum, w)), h('td', { class: 'mono' }, h('b', null, hex(gen.checksum, w))), h('td', null, 'flip every bit of the sum'))))));

      // channel: words as received (with flips or swap), checksum is the last row
      const sentList = words.concat([gen.checksum]);
      let recvList = sentList.slice();
      if (swapped) { const t = recvList[swapped[0]]; recvList[swapped[0]] = recvList[swapped[1]]; recvList[swapped[1]] = t; }
      recvList = recvList.map((v, i) => {
        let out = v;
        for (let b = 0; b < w; b++) if (flips.has(i + ':' + b)) out ^= 1 << (w - 1 - b);
        return out;
      });
      CN.clear(chanBox);
      recvList.forEach((v, i) => {
        const isCheck = i === recvList.length - 1;
        const cells = toBits(bin(v, w)).map((bit, b) => ({ label: b === 0 ? (isCheck ? 'sum' : 'w' + (i + 1)) : '', value: bit, kind: isCheck ? 'parity' : '', flipped: flips.has(i + ':' + b), small: true, name: (isCheck ? 'checksum' : 'word ' + (i + 1)) + ' bit ' + (b + 1) }));
        const swappedHere = swapped && (swapped.includes(i));
        chanBox.appendChild(h('div', { style: 'margin-bottom:8px' }, bitRow(cells, (b) => {
          const key = i + ':' + b; if (flips.has(key)) flips.delete(key); else flips.add(key); refresh();
        }), swappedHere ? h('div', { class: 'field-hint' }, 'This word was swapped with another one.') : null));
      });

      // receiver
      const ver = ED.checksumVerify(recvList.slice(0, -1), recvList[recvList.length - 1], w);
      CN.clear(recvBox);
      recvBox.appendChild(h('p', { style: 'margin:0 0 8px' }, 'Receiver adds every word including the checksum, wrapping carries around.'));
      recvBox.appendChild(h('div', { class: 'readouts' },
        (() => { const r = CN.readout('Total'); r.set(hex(ver.sum, w) + ' = ' + bin(ver.sum, w)); return r.el; })(),
        (() => { const r = CN.readout('Needed for "no error"'); r.set(hex(ver.mask, w) + ' (all ones)'); return r.el; })()));

      CN.clear(verdict);
      const changed = recvList.some((v, i) => v !== sentList[i]);
      if (!changed) verdict.appendChild(CN.note('good', 'The total is all ones, so the receiver accepts the message.'));
      else if (!ver.ok) verdict.appendChild(CN.note('good', 'Error detected: the total is not all ones, so the receiver rejects the message.'));
      else verdict.appendChild(CN.note('bad', 'Undetected error: the message changed but the total is still all ones. ' + (swapped ? 'Addition does not care about order, so reordered words give the same sum. This is a known weakness of checksums; a CRC would notice.' : 'The changes cancelled each other out in the sum.')));
    }

    const stage = h('div', { class: 'stage' },
      CN.panel('Sender: compute the checksum', 'Add all words with end-around carry, then flip every bit of the result.', sendBox),
      CN.panel('Channel: flip bits', 'The last row (blue) is the checksum sent along with the message.', chanBox),
      CN.panel('Receiver: add everything again', null, recvBox),
      verdict);
    refresh();
    return h('div', { class: 'workbench' }, controls, stage);
  }

  /* ---------------------------------------------------------------- Detection lab */
  function buildLab() {
    const model = CN.segmented({ label: 'Error model', options: [{ value: 'random', label: 'Random bit errors' }, { value: 'burst', label: 'Burst errors' }], value: 'random', onChange: run });
    const dsel = CN.select({ label: 'Data length', options: [{ value: 32, label: '32 bits' }, { value: 64, label: '64 bits' }, { value: 128, label: '128 bits' }], value: 64, onChange: run });
    const tsel = CN.select({ label: 'Trials per point', options: [{ value: 1000, label: '1,000 (fast)' }, { value: 4000, label: '4,000' }, { value: 15000, label: '15,000 (slow, smooth)' }], value: 4000, onChange: run });
    const seed = CN.textField({ label: 'Seed', value: '2024', mono: true, hint: 'Same seed, same result.' });
    const chartHost = h('div');
    const chart = new CN.Chart(chartHost, { height: 340, label: 'Detection rate chart' });
    const status = h('div', { class: 'field-hint' });
    const insight = h('div');

    const controls = h('div', { class: 'controls' },
      h('h3', null, 'Experiment'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Error model'), model.el),
      dsel.el, tsel.el, seed.el,
      CN.button('Run again', { kind: 'primary', onClick: run }),
      status);

    function run() {
      status.textContent = 'Running...';
      // let the browser paint "Running..." first
      setTimeout(() => {
        const t0 = performance.now();
        const res = ED.monteCarlo({ seed: parseInt(seed.get(), 10) || 1, dataBits: Number(dsel.get()), model: model.get(), kMax: 16, trials: Number(tsel.get()) });
        const burst = model.get() === 'burst';
        chart.set({
          xLabel: burst ? 'Burst length (bits)' : 'Number of flipped bits', yLabel: 'Errors detected (%)', yMin: 0, yMax: 100, xMin: 1, xMax: 16,
          xTicks: [1, 2, 4, 6, 8, 10, 12, 14, 16], xTipLabel: burst ? 'burst of ' : '', yUnit: '%',
          yFormat: (v) => String(Math.round(v * 10) / 10),
          series: ED.labSchemes.map((s, i) => ({ name: s.name, color: 's' + (i + 1), type: 'line', marker: false, points: res.ks.map((k, j) => [k, res.series[s.name][j]]) })),
        });
        status.textContent = 'Done in ' + Math.round(performance.now() - t0) + ' ms.';
        CN.clear(insight);
        insight.appendChild(CN.note('info', burst
          ? 'A burst of length k means the first and last bit are wrong and the bits between may be. CRC-8 catches every burst up to 8 bits and CRC-16 up to 16; the 8-bit checksum behaves similarly up to its word size; a lone parity bit only sees bursts that happen to flip an odd number of bits.'
          : 'Parity catches an odd number of flips and none of the even ones. The checksum and CRC catch almost everything, but notice the checksum is a little weaker than a CRC of the same size, which is why Ethernet uses a CRC and IP headers only use a checksum.'));
      }, 20);
    }

    const stage = h('div', { class: 'stage' },
      CN.panel('How often is an error caught?', 'Each point is a fresh batch of random messages with k bits corrupted on the wire. Click legend names to hide a line.', chartHost),
      insight);
    const root = h('div', { class: 'workbench' }, controls, stage);
    setTimeout(run, 30);
    return root;
  }

  /* ---------------------------------------------------------------- Tab page */
  CN.registerTab({
    id: 'errors',
    group: { layer: 2, name: 'Data Link' },
    title: 'Error detection',
    mount(page) {
      page.appendChild(CN.pageHead({
        title: 'Error detection and correction',
        lead: 'Encode a message, break a bit on the way, and watch the receiver notice or even repair it. Three schemes from the syllabus, plus a lab that tests how well each one really works.',
        units: [{ unit: 3, name: 'Data Link Layer', co: 3, level: 'Analyze' }],
        topics: ['Hamming code', 'CRC', 'Checksum'],
      }));
      const modes = [
        { id: 'hamming', label: 'Hamming code', build: buildHamming },
        { id: 'crc', label: 'CRC', build: buildCrc },
        { id: 'checksum', label: 'Checksum', build: buildChecksum },
        { id: 'lab', label: 'Detection lab', build: buildLab },
      ];
      const built = {};
      const holder = h('div', { style: 'margin-top:6px' });
      const seg = CN.segmented({ label: 'Scheme', options: modes.map((m) => ({ value: m.id, label: m.label })), value: 'hamming', onChange: show });
      function show(id) {
        modes.forEach((m) => { if (built[m.id]) built[m.id].style.display = 'none'; });
        if (!built[id]) { built[id] = modes.find((m) => m.id === id).build(); holder.appendChild(built[id]); }
        built[id].style.display = '';
        if (id === 'lab') window.dispatchEvent(new Event('resize'));
      }
      page.appendChild(h('div', { class: 'row' }, seg.el));
      page.appendChild(holder);
      show('hamming');

      page.appendChild(CN.section('How it works', 'Short notes for revision', h('div', { class: 'stage', style: 'gap:10px' },
        CN.theory('Hamming code', '<ul><li>Add <b>r</b> parity bits to <b>m</b> data bits where 2<sup>r</sup> &ge; m + r + 1. Seven data bits need r = 4, giving an 11-bit codeword.</li><li>Parity bits sit at positions 1, 2, 4, 8 and so on. Parity bit p checks every position whose binary form contains p, for example p2 checks 2, 3, 6, 7, 10, 11.</li><li>The receiver repeats each check. Write the failed checks as a binary number; that number is the position of the bad bit, so the receiver flips it back.</li><li>Plain Hamming corrects one error. Two errors give a wrong "correction". Adding one overall parity bit (SEC-DED) lets the receiver detect two errors.</li></ul>'),
        CN.theory('CRC', '<ul><li>Treat the data as a polynomial, append r zeros (multiply by x<sup>r</sup>) and divide by the generator G(x) of degree r. Division uses XOR, so there are no borrows.</li><li>The remainder (r bits) is sent after the data. The frame is now exactly divisible by G(x).</li><li>The receiver divides again: remainder 0 means accept, anything else means reject.</li><li>A good generator catches all single and double errors, all odd-length error patterns when (x + 1) is a factor, and every burst of length up to r. It misses a long random error with probability 2<sup>-r</sup>.</li></ul>'),
        CN.theory('Internet checksum', '<ul><li>Cut the message into w-bit words and add them in ones&#39; complement arithmetic: a carry out of the top bit is added back at the bottom.</li><li>The checksum is the complement of that sum. The receiver adds all words plus the checksum; the answer must be all ones.</li><li>Cheap to compute, but weaker than a CRC: reordering words or two errors that cancel each other give the same sum.</li></ul>'))));
      return { destroy() {} };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
