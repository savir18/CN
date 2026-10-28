/* ==========================================================================
   Protocol Lab - logic tests.  Run with:  node tests/f1_team34_tests.js
   Only the plain-logic parts of each tab are tested here (no browser needed).
   A tiny home-made test runner keeps the project free of dependencies.
   ========================================================================== */
'use strict';
const path = require('path');
const assert = require('assert');
const jsDir = path.join(__dirname, '..', 'js');

require(path.join(jsDir, 'f1_team34_core.js'));
const CN = globalThis.CN;

let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; failures.push(name); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' +/- ' + tol + ', got ' + a);

/* ---------------------------------------------------------------------- */
console.log('\nError detection');
require(path.join(jsDir, 'f1_team34_error_detection.js'));
const ED = CN.errorDetection;

test('Hamming: parity bit count follows 2^r >= m + r + 1', () => {
  assert.strictEqual(ED.parityBitCount(4), 3);
  assert.strictEqual(ED.parityBitCount(7), 4);
  assert.strictEqual(ED.parityBitCount(11), 4);
  assert.strictEqual(ED.parityBitCount(12), 5);
});

test('Hamming: 7 data bits need 4 parity bits and decode cleanly', () => {
  const enc = ED.hammingEncode('1011001', { parity: 'even' });
  assert.strictEqual(enc.n, 11);
  assert.strictEqual(enc.r, 4);
  assert.strictEqual(ED.extractData(enc.cw), '1011001');
  const dec = ED.hammingDecode(enc.cw, null, { parity: 'even' });
  assert.strictEqual(dec.status, 'no-error');
  assert.strictEqual(dec.syndrome, 0);
});

test('Hamming: every single-bit error is located and corrected (even and odd parity)', () => {
  ['even', 'odd'].forEach((parity) => {
    for (const data of ['1', '1011', '1011001', '110100111010', '10101010101010101010101010']) {
      const enc = ED.hammingEncode(data, { parity });
      for (let pos = 1; pos <= enc.n; pos++) {
        const bad = enc.cw.slice(); bad[pos - 1] ^= 1;
        const dec = ED.hammingDecode(bad, null, { parity });
        assert.strictEqual(dec.syndrome, pos, 'syndrome for ' + data + ' pos ' + pos);
        assert.strictEqual(dec.status, 'corrected');
        assert.strictEqual(dec.data, data);
      }
    }
  });
});

test('Hamming: plain code mis-corrects a double error', () => {
  const enc = ED.hammingEncode('1011001', { parity: 'even' });
  const bad = enc.cw.slice(); bad[2] ^= 1; bad[6] ^= 1;
  const dec = ED.hammingDecode(bad, null, { parity: 'even' });
  assert.notStrictEqual(dec.data, '1011001');
});

test('Extended Hamming: single errors corrected, double errors detected, overall bit error found', () => {
  const enc = ED.hammingEncode('1011001', { parity: 'even', extended: true });
  for (let pos = 1; pos <= enc.n; pos++) {
    const bad = enc.cw.slice(); bad[pos - 1] ^= 1;
    const dec = ED.hammingDecode(bad, enc.overall, { parity: 'even', extended: true });
    assert.strictEqual(dec.status, 'corrected');
    assert.strictEqual(dec.data, '1011001');
  }
  for (let a = 1; a <= enc.n; a++) for (let b = a + 1; b <= enc.n; b++) {
    const bad = enc.cw.slice(); bad[a - 1] ^= 1; bad[b - 1] ^= 1;
    const dec = ED.hammingDecode(bad, enc.overall, { parity: 'even', extended: true });
    assert.strictEqual(dec.status, 'double-error', 'double error ' + a + ',' + b);
  }
  const dec0 = ED.hammingDecode(enc.cw, enc.overall ^ 1, { parity: 'even', extended: true });
  assert.strictEqual(dec0.status, 'overall-bit-error');
  assert.strictEqual(dec0.data, '1011001');
});

test('CRC: textbook example 1101011011 / x^4+x+1 gives remainder 1110', () => {
  const enc = ED.crcEncode('1101011011', '10011');
  assert.strictEqual(enc.remainder, '1110');
  assert.strictEqual(enc.frame, '11010110111110');
});

test('CRC: encode then check gives zero remainder; shift-register form matches long division', () => {
  const rng = CN.makeRng(5);
  ED.crcPresets.forEach((p) => {
    for (let t = 0; t < 40; t++) {
      let data = ''; const len = rng.int(1, 32);
      for (let i = 0; i < len; i++) data += rng() < 0.5 ? '1' : '0';
      const enc = ED.crcEncode(data, p.gen);
      assert.ok(ED.crcCheck(enc.frame, p.gen).ok, p.id + ' frame should verify');
      assert.strictEqual(enc.remainder.length, p.gen.length - 1);
    }
  });
  // the fast register used by the lab must agree with the textbook division
  const scheme = ED.labSchemes.find((s) => s.name === 'CRC-8');
  for (let t = 0; t < 30; t++) {
    const data = []; for (let i = 0; i < 40; i++) data.push(rng() < 0.5 ? 1 : 0);
    const frame = scheme.encode(data);
    assert.strictEqual(ED.crcEncode(data.join(''), '100000111').frame, frame.join(''));
    assert.strictEqual(scheme.detects(frame), false);
  }
});

test('CRC: every single-bit error is detected; a multiple of G(x) is not', () => {
  const g = '10011';
  const enc = ED.crcEncode('1101011011', g);
  for (let i = 0; i < enc.frame.length; i++) {
    const bits = enc.frame.split(''); bits[i] = bits[i] === '1' ? '0' : '1';
    assert.ok(!ED.crcCheck(bits.join(''), g).ok, 'bit ' + i);
  }
  const rng = CN.makeRng(3);
  const flips = ED.undetectableError(g, enc.frame.length, rng);
  const bits = enc.frame.split('');
  flips.forEach((p) => { bits[p] = bits[p] === '1' ? '0' : '1'; });
  assert.notStrictEqual(bits.join(''), enc.frame);
  assert.ok(ED.crcCheck(bits.join(''), g).ok, 'hidden error should pass the check');
});

test('CRC: guarantees table is truthful (bursts <= r always caught)', () => {
  const g = '10011'; // r = 4
  const enc = ED.crcEncode('1101011011', g);
  const gu = ED.crcGuarantees(g, enc.frame.length);
  assert.strictEqual(gu.r, 4);
  assert.ok(gu.singleBit);
  for (let len = 1; len <= 4; len++) {
    for (let start = 0; start + len <= enc.frame.length; start++) {
      for (let pattern = 0; pattern < (1 << Math.max(0, len - 2)); pattern++) {
        const bits = enc.frame.split('');
        const flip = (p) => { bits[p] = bits[p] === '1' ? '0' : '1'; };
        flip(start); if (len > 1) flip(start + len - 1);
        for (let k = 0; k < len - 2; k++) if ((pattern >> k) & 1) flip(start + 1 + k);
        assert.ok(!ED.crcCheck(bits.join(''), g).ok, 'burst ' + len + ' at ' + start);
      }
    }
  }
  // (x+1) divides G(x) exactly when G has an even number of terms
  assert.ok(ED.crcGuarantees('1111', 14).oddErrors);   // x^3+x^2+x+1 = (x+1)^3: 4 terms
  assert.ok(!ED.crcGuarantees('1011', 14).oddErrors);  // x^3+x+1: 3 terms
  assert.ok(ED.crcGuarantees('100000111', 40).oddErrors); // CRC-8: 4 terms
});

test('Checksum: ones complement sum with end-around carry, verify passes', () => {
  const r = ED.onesComplementSum([0xFFFF, 0x0001], 16);
  assert.strictEqual(r.sum, 0x0001);
  const conv = ED.textToWords('HELLO LAB', 16);
  const gen = ED.checksumGenerate(conv.words, 16);
  assert.ok(ED.checksumVerify(conv.words, gen.checksum, 16).ok);
  const bad = conv.words.slice(); bad[0] ^= 0x0100;
  assert.ok(!ED.checksumVerify(bad, gen.checksum, 16).ok);
});

test('Checksum: reordering words is not detected (known weakness)', () => {
  const conv = ED.textToWords('ABCDEFGH', 16);
  const gen = ED.checksumGenerate(conv.words, 16);
  const swapped = conv.words.slice();
  const t = swapped[0]; swapped[0] = swapped[2]; swapped[2] = t;
  assert.notDeepStrictEqual(swapped, conv.words);
  assert.ok(ED.checksumVerify(swapped, gen.checksum, 16).ok);
});

test('Monte Carlo: parity never catches even-sized errors; CRC-16 catches every burst up to 16', () => {
  const rnd = ED.monteCarlo({ seed: 1, dataBits: 64, model: 'random', kMax: 6, trials: 600 });
  assert.strictEqual(rnd.series['Parity bit'][1], 0); // k=2
  assert.strictEqual(rnd.series['Parity bit'][0], 100); // k=1
  assert.strictEqual(rnd.series['CRC-16'][0], 100);
  assert.strictEqual(rnd.series['CRC-8'][2], 100); // 3 random flips: CRC-8 (even terms? 4 terms) catches odd counts
  const burst = ED.monteCarlo({ seed: 2, dataBits: 64, model: 'burst', kMax: 16, trials: 400 });
  burst.ks.forEach((k, i) => {
    if (k <= 8) assert.strictEqual(burst.series['CRC-8'][i], 100, 'CRC-8 burst ' + k);
    assert.strictEqual(burst.series['CRC-16'][i], 100, 'CRC-16 burst ' + k);
  });
});

/* ---------------------------------------------------------------------- */
const extra = process.argv.slice(2); // allow: node tests/... flow mac tcp qos
['flow_control', 'multiple_access', 'tcp_congestion', 'queuing_qos', 'subnetting', 'routing', 'journey'].forEach((name) => {
  const file = path.join(jsDir, 'f1_team34_' + name + '.js');
  if (require('fs').existsSync(file)) {
    console.log('\n' + name.replace('_', ' '));
    require(file);
    const suite = path.join(__dirname, 'f1_team34_tests_' + name + '.js');
    if (require('fs').existsSync(suite)) require(suite)({ test, assert, close, CN });
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('Failed: ' + failures.join('; ')); process.exit(1); }
