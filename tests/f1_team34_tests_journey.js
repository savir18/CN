// Logic tests for the packet journey and switching maths.
module.exports = function ({ test, assert, close, CN }) {
  const J = CN.journey;
  const text = 'GET /index.html HTTP/1.1';

  test('CRC-32 matches the standard check value', () => {
    const bytes = Array.from('123456789', (c) => c.charCodeAt(0));
    assert.strictEqual(J.crc32(bytes), 0xcbf43926);
  });
  test('internet checksum matches a known IPv4 header (0xB861)', () => {
    const hdr = [0x45, 0, 0, 0x73, 0, 0, 0x40, 0, 0x40, 0x11, 0, 0, 0xc0, 0xa8, 0, 1, 0xc0, 0xa8, 0, 0xc7];
    assert.strictEqual(J.internetChecksum(hdr), 0xb861);
    hdr[10] = 0xb8; hdr[11] = 0x61;
    assert.ok(J.ipChecksumOk(hdr));
    hdr[8] = 0x3f; // a changed TTL with the old checksum must fail
    assert.ok(!J.ipChecksumOk(hdr));
  });
  test('journey: TTL drops by one per router, MACs change per link, IPs stay', () => {
    const t = J.journey({ text, ttl: 8 });
    assert.ok(!t.dropped);
    const frames = t.steps.filter((s) => s.frame && !s.receive).map((s) => s.frame);
    assert.strictEqual(frames.length, 3);
    const ips = t.steps.filter((s) => s.ip && s.frame && !s.receive).map((s) => s.ip);
    assert.deepStrictEqual(ips.map((i) => i.ttl), [8, 7, 6]);
    assert.ok(new Set(ips.map((i) => i.src)).size === 1 && new Set(ips.map((i) => i.dst)).size === 1);
    assert.ok(new Set(frames.map((f) => f.srcMac)).size === 3 && new Set(frames.map((f) => f.dstMac)).size === 3);
    frames.forEach((f) => assert.ok(J.frameFcsOk(f)));
    ips.forEach((i) => assert.ok(J.ipChecksumOk(i.bytes)));
    assert.notStrictEqual(ips[0].checksum, ips[1].checksum);
  });
  test('journey: TTL 2 dies at R2 and TTL 1 dies at R1', () => {
    const a = J.journey({ text, ttl: 2 }); assert.ok(a.dropped); assert.strictEqual(a.steps[a.steps.length - 1].router, 'R2');
    const b = J.journey({ text, ttl: 1 }); assert.ok(b.dropped); assert.strictEqual(b.steps[b.steps.length - 1].router, 'R1');
    assert.ok(!J.journey({ text, ttl: 3 }).dropped);
  });
  test('header overhead is 58 bytes; corrupted frame fails its FCS', () => {
    const t = J.journey({ text, ttl: 8 }); const f = t.steps[3].frame;
    assert.strictEqual(f.bytes.length, 58 + text.length);
    const bad = Object.assign({}, f, { bytes: f.bytes.slice() }); bad.bytes[30] ^= 1;
    assert.ok(!J.frameFcsOk(bad));
  });
  test('packet switching: one packet and equal packets follow N*L/R and (N+P-1)*L/R', () => {
    const o = { msgBytes: 1000, rate: 8000, links: 3, prop: 0, setup: 0, header: 0, pktPayload: 1000 };
    assert.ok(Math.abs(J.packetDelay(o) - 3 * 1) < 1e-9);
    const o2 = Object.assign({}, o, { pktPayload: 250 }); // 4 packets of 250 B = 0.25 s each
    assert.ok(Math.abs(J.packetDelay(o2) - (3 + 4 - 1) * 0.25) < 1e-9);
  });
  test('circuit delay is set-up + transmission + propagation; smaller last packet is not slower than a full one', () => {
    assert.ok(Math.abs(J.circuitDelay({ msgBytes: 1000, rate: 8000, links: 3, prop: 0.01, setup: 0.5 }) - (0.5 + 1 + 0.03)) < 1e-9);
    const base = { rate: 1e6, links: 4, prop: 0, setup: 0, header: 40 };
    assert.ok(J.packetDelay(Object.assign({ msgBytes: 2500, pktPayload: 1000 }, base)) <= J.packetDelay(Object.assign({ msgBytes: 3000, pktPayload: 1000 }, base)) + 1e-12);
  });
  test('statistical multiplexing: 35 users at 10% on a link for 10 gives well under 0.1% overload', () => {
    const p = J.overloadProbability(35, 0.1, 10);
    assert.ok(p > 0.0002 && p < 0.001, String(p));
    assert.strictEqual(J.overloadProbability(10, 0.1, 10), 0);
    const big = J.overloadProbability(80, 0.1, 10); assert.ok(big > 0.1 && big < 0.4, String(big));
  });
};
