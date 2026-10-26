// Logic tests for the TCP congestion models.
module.exports = function ({ test, assert, close, CN }) {
  const T = CN.tcpCongestion;

  test('slow start doubles each round until ssthresh, then adds one', () => {
    const r = T.windowTrace({ variant: 'reno', rounds: 10, ssthresh: 8 }).rows.map((x) => x.cwnd);
    assert.deepStrictEqual(r.slice(0, 7), [1, 2, 4, 8, 9, 10, 11]);
  });

  test('phase label switches at ssthresh', () => {
    const rows = T.windowTrace({ variant: 'reno', rounds: 6, ssthresh: 8 }).rows;
    assert.strictEqual(rows[2].phase, 'slow start');
    assert.strictEqual(rows[3].phase, 'congestion avoidance');
  });

  test('triple duplicate ACK: Tahoe restarts at 1, Reno halves', () => {
    const ev = { 6: 'dup' };
    const tahoe = T.windowTrace({ variant: 'tahoe', rounds: 8, ssthresh: 8, events: ev }).rows;
    const reno = T.windowTrace({ variant: 'reno', rounds: 8, ssthresh: 8, events: ev }).rows;
    assert.strictEqual(tahoe[6].cwnd, 11);
    assert.strictEqual(tahoe[7].cwnd, 1);
    assert.strictEqual(tahoe[7].ssthresh, 5);
    assert.strictEqual(reno[7].cwnd, 5);
    assert.strictEqual(reno[7].ssthresh, 5);
  });

  test('timeout sends both variants to 1', () => {
    const ev = { 5: 'timeout' };
    ['tahoe', 'reno'].forEach((v) => {
      const rows = T.windowTrace({ variant: v, rounds: 7, ssthresh: 8, events: ev }).rows;
      assert.strictEqual(rows[6].cwnd, 1);
      assert.strictEqual(rows[6].ssthresh, Math.floor(rows[5].cwnd / 2));
    });
  });

  test('Reno never sends fewer segments than Tahoe on the same losses', () => {
    const ev = T.makeEvents({ 9: 'dup' }, 30, 0.15, 7);
    const a = T.windowTrace({ variant: 'tahoe', rounds: 30, ssthresh: 16, events: ev }).segments;
    const b = T.windowTrace({ variant: 'reno', rounds: 30, ssthresh: 16, events: ev }).segments;
    assert.ok(b >= a);
  });

  test('makeEvents is deterministic and keeps scripted events', () => {
    const a = T.makeEvents({ 3: 'timeout' }, 30, 0.2, 4); const b = T.makeEvents({ 3: 'timeout' }, 30, 0.2, 4);
    assert.deepStrictEqual(a, b);
    assert.strictEqual(a[3], 'timeout');
  });

  const base = { capacity: 1000, buffer: 100, duration: 60, flows: [{ rtt: 0.1, start: 0 }] };

  test('one Reno flow with a BDP-sized buffer keeps the link busy', () => {
    const s = T.simulateBottleneck(Object.assign({}, base, { buffer: 100 })).stats;
    assert.ok(s.utilization > 0.85, 'utilization ' + s.utilization);
    assert.ok(s.utilization <= 1.001);
  });

  test('a tiny buffer lowers utilisation', () => {
    const big = T.simulateBottleneck(Object.assign({}, base, { buffer: 100 })).stats.utilization;
    const tiny = T.simulateBottleneck(Object.assign({}, base, { buffer: 10 })).stats.utilization;
    assert.ok(tiny < big, tiny + ' vs ' + big);
  });

  test('two equal flows share fairly', () => {
    const s = T.simulateBottleneck(Object.assign({}, base, { flows: [{ rtt: 0.1, start: 0 }, { rtt: 0.1, start: 0 }] })).stats;
    assert.ok(s.fairness > 0.9, 'fairness ' + s.fairness);
  });

  test('a longer RTT gets a smaller share', () => {
    const s = T.simulateBottleneck(Object.assign({}, base, { flows: [{ rtt: 0.05, start: 0 }, { rtt: 0.2, start: 0 }] })).stats;
    assert.ok(s.throughput[0] > s.throughput[1]);
  });

  test('RED gives lower mean queueing delay than drop-tail', () => {
    const f = [{ rtt: 0.1, start: 0 }, { rtt: 0.1, start: 0 }];
    const d = T.simulateBottleneck(Object.assign({}, base, { flows: f, queue: 'droptail' })).stats.delayMs;
    const r = T.simulateBottleneck(Object.assign({}, base, { flows: f, queue: 'red' })).stats.delayMs;
    assert.ok(r < d, 'red ' + r + ' droptail ' + d);
  });

  test('identical seeds give identical results', () => {
    const a = T.simulateBottleneck(base).stats; const b = T.simulateBottleneck(base).stats;
    assert.deepStrictEqual(a.throughput, b.throughput);
  });
};
