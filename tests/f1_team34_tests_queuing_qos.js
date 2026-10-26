// Logic tests for the queuing / QoS model.
module.exports = function ({ test, assert, close, CN }) {
  const Q = CN.queuingQos;
  const base = { capacity: 1e6, dataLoad: 0.9, burst: 0.3, duration: 20, seed: 3, buffer: 50, voipWeight: 0.25 };

  test('traffic generator produces sorted arrivals from all three flows near the requested load', () => {
    const arr = Q.generate(base);
    for (let i = 1; i < arr.length; i++) assert.ok(arr[i].t >= arr[i - 1].t);
    const bits = [0, 0, 0]; arr.forEach((p) => { bits[p.f] += p.size * 8; });
    close(bits[0] / 20, 80000, 2000);                  // voice: 200 B every 20 ms = 80 kbps
    close((bits[1] + bits[2]) / 20 / 1e6, 0.9, 0.2);   // data close to 90% of the link
  });

  test('a lone packet sees only its own transmission time', () => {
    const r = Q.run([{ t: 0.5, f: 0, size: 125 }], Object.assign({}, base, { duration: 1 }));
    close(r.flows[0].meanMs, 1, 1e-6); // 1000 bits at 1 Mbps = 1 ms
  });

  test('every packet is either delivered or dropped, in all three rules', () => {
    const arr = Q.generate(Object.assign({}, base, { dataLoad: 1.3 }));
    ['fifo', 'priority', 'wfq'].forEach((d) => {
      const r = Q.run(arr, Object.assign({}, base, { discipline: d }));
      r.flows.forEach((f) => { assert.strictEqual(f.sent, f.series.length + f.dropped); });
    });
  });

  test('FIFO: voice shares the data queue, priority and WFQ protect it', () => {
    const all = Q.compare(base);
    const f = all.fifo.flows[0].p95Ms; const p = all.priority.flows[0].p95Ms; const w = all.wfq.flows[0].p95Ms;
    assert.ok(p < f / 2, 'priority ' + p + ' fifo ' + f);
    assert.ok(w < f / 2, 'wfq ' + w + ' fifo ' + f);
    assert.ok(all.priority.flows[0].jitterMs < all.fifo.flows[0].jitterMs);
  });

  test('priority keeps voice delay to roughly one packet time under overload', () => {
    const r = Q.run(Q.generate(Object.assign({}, base, { dataLoad: 1.4 })), Object.assign({}, base, { discipline: 'priority' }));
    assert.ok(r.flows[0].maxMs < 20, 'max ' + r.flows[0].maxMs);
    assert.strictEqual(r.flows[0].dropped, 0);
  });

  test('WFQ never starves the bulk flow', () => {
    const all = Q.compare(Object.assign({}, base, { dataLoad: 1.2 }));
    assert.ok(all.wfq.flows[2].throughput > 0.3 * 1e6);
  });

  test('delay for voice grows with data load under FIFO', () => {
    const s = Q.sweepLoad(base, [0.3, 0.7, 1.1]).fifo.map((p) => p[1]);
    assert.ok(s[0] < s[1] && s[1] < s[2], s.join(','));
  });

  test('throughput never exceeds link speed and results are repeatable', () => {
    const a = Q.compare(base); const b = Q.compare(base);
    const sum = a.fifo.flows.reduce((x, f) => x + f.throughput, 0);
    assert.ok(sum <= 1e6 * 1.001);
    assert.strictEqual(a.wfq.flows[0].meanMs, b.wfq.flows[0].meanMs);
  });

  test('verdict flags poor voice quality', () => {
    assert.strictEqual(Q.voipVerdict({ meanMs: 5, p95Ms: 8, jitterMs: 2, loss: 0 }, 60).ok, true);
    assert.deepStrictEqual(Q.voipVerdict({ meanMs: 90, p95Ms: 200, jitterMs: 40, loss: 0.05 }, 0).fails, ['delay', 'jitter', 'loss']);
  });
};
