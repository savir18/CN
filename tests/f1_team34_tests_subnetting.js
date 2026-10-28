// Logic tests for the subnetting maths.
module.exports = function ({ test, assert, CN }) {
  const S = CN.subnetting; const p = S.parseIp; const s = S.ipToStr;

  test('parse and print addresses; reject bad ones', () => {
    assert.strictEqual(s(p('192.168.1.10')), '192.168.1.10');
    assert.strictEqual(p('256.1.1.1'), null); assert.strictEqual(p('1.2.3'), null); assert.strictEqual(p('a.b.c.d'), null);
    assert.strictEqual(p('255.255.255.255'), 4294967295);
  });
  test('masks from prefixes and back; non-contiguous masks rejected', () => {
    assert.strictEqual(s(S.maskFromPrefix(26)), '255.255.255.192');
    assert.strictEqual(s(S.maskFromPrefix(0)), '0.0.0.0');
    assert.strictEqual(S.prefixFromMask(p('255.255.240.0')), 20);
    assert.strictEqual(S.prefixFromMask(p('255.0.255.0')), null);
  });
  test('classic worked example: 192.168.10.37/26', () => {
    const a = S.analyze(p('192.168.10.37'), 26);
    assert.strictEqual(s(a.network), '192.168.10.0'); assert.strictEqual(s(a.broadcast), '192.168.10.63');
    assert.strictEqual(s(a.first), '192.168.10.1'); assert.strictEqual(s(a.last), '192.168.10.62');
    assert.strictEqual(a.hosts, 62); assert.strictEqual(a.cls, 'C'); assert.ok(/private/.test(a.kind));
  });
  test('edge prefixes /30 /31 /32 and /0', () => {
    assert.strictEqual(S.analyze(p('10.0.0.6'), 30).hosts, 2);
    assert.strictEqual(S.analyze(p('10.0.0.6'), 31).hosts, 2);
    assert.strictEqual(S.analyze(p('10.0.0.6'), 32).hosts, 1);
    assert.strictEqual(S.analyze(p('8.8.8.8'), 0).size, 4294967296);
  });
  test('detects network and broadcast addresses', () => {
    assert.ok(S.analyze(p('192.168.10.0'), 26).isNetworkAddr); assert.ok(S.analyze(p('192.168.10.63'), 26).isBroadcastAddr);
  });
  test('same-subnet test', () => {
    assert.ok(S.sameSubnet(p('192.168.10.70'), p('192.168.10.100'), 26).same);
    assert.ok(!S.sameSubnet(p('192.168.10.70'), p('192.168.10.130'), 26).same);
  });
  test('equal split rounds up to a power of two and tiles the space', () => {
    const r = S.splitEqual(p('192.168.10.0'), 24, 5);
    assert.strictEqual(r.newPrefix, 27); assert.strictEqual(r.total, 8);
    assert.strictEqual(s(r.subnets[1].network), '192.168.10.32'); assert.strictEqual(r.subnets[0].hosts, 30);
    for (let i = 1; i < r.subnets.length; i++) assert.strictEqual(r.subnets[i].network, r.subnets[i - 1].broadcast + 1);
    assert.ok(S.splitEqual(p('10.0.0.0'), 30, 8).error);
  });
  test('VLSM: 100, 50, 20, 2 hosts in a /24', () => {
    const r = S.vlsm(p('192.168.10.0'), 24, [100, 50, 20, 2]);
    assert.ok(!r.error);
    const byNeed = {}; r.rows.forEach((x) => { byNeed[x.need] = x; });
    assert.strictEqual(byNeed[100].prefix, 25); assert.strictEqual(byNeed[50].prefix, 26);
    assert.strictEqual(byNeed[20].prefix, 27); assert.strictEqual(byNeed[2].prefix, 30);
    assert.strictEqual(s(byNeed[50].info.network), '192.168.10.128'); assert.strictEqual(s(byNeed[20].info.network), '192.168.10.192');
    assert.strictEqual(s(byNeed[2].info.network), '192.168.10.224');
    // blocks never overlap
    for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i].info.network > r.rows[i - 1].info.broadcast);
  });
  test('VLSM reports when the space is too small', () => {
    assert.ok(S.vlsm(p('192.168.10.0'), 24, [200, 100]).error);
  });
  test('route summarisation: four /24s become one /22; gaps are reported', () => {
    const four = ['192.168.0.0', '192.168.1.0', '192.168.2.0', '192.168.3.0'].map((x) => ({ ip: p(x), prefix: 24 }));
    const r = S.aggregate(four);
    assert.strictEqual(s(r.summary.network), '192.168.0.0'); assert.strictEqual(r.summary.prefix, 22); assert.strictEqual(r.extra, 0);
    const gap = S.aggregate([{ ip: p('192.168.0.0'), prefix: 24 }, { ip: p('192.168.3.0'), prefix: 24 }]);
    assert.strictEqual(gap.summary.prefix, 22); assert.strictEqual(gap.extra, 512);
  });
  test('parseCidr accepts slash and dotted-mask forms', () => {
    assert.deepStrictEqual(S.parseCidr('10.1.2.3/8'), { ip: p('10.1.2.3'), prefix: 8 });
    assert.strictEqual(S.parseCidr('10.1.2.3 255.255.255.0').prefix, 24);
    assert.strictEqual(S.parseCidr('10.1.2.3/40'), null);
  });
};
