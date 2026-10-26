/* Tests for the ARQ simulator (Stop-and-Wait, Go-Back-N, Selective Repeat) */
'use strict';
module.exports = function ({ test, assert, close, CN }) {
  const FC = CN.flowControl;
  const base = { N: 10, Tf: 1, Tp: 2, seed: 3 };

  test('Stop-and-Wait with no loss: one frame per round trip, efficiency 1/(1+2a)', () => {
    const r = FC.simulate(Object.assign({}, base, { protocol: 'sw' }));
    assert.strictEqual(r.finish, 50); // 10 frames x (1 + 2*2)
    close(r.stats.efficiency, 0.2, 1e-9);
    close(r.stats.efficiency, FC.idealEfficiency('sw', 1, 2, 1), 1e-9);
    assert.strictEqual(r.stats.retx, 0);
  });

  test('Go-Back-N without loss: efficiency approaches min(1, W/(1+2a))', () => {
    const r = FC.simulate({ protocol: 'gbn', N: 400, W: 4, Tf: 1, Tp: 2, seed: 1 });
    close(r.stats.efficiency, 0.8, 0.02);
    const big = FC.simulate({ protocol: 'gbn', N: 400, W: 8, Tf: 1, Tp: 2, seed: 1 });
    close(big.stats.efficiency, 1, 0.03);
  });

  test('Selective Repeat without loss behaves like Go-Back-N', () => {
    const a = FC.simulate({ protocol: 'sr', N: 100, W: 4, Tf: 1, Tp: 2, seed: 1 });
    const b = FC.simulate({ protocol: 'gbn', N: 100, W: 4, Tf: 1, Tp: 2, seed: 1 });
    close(a.finish, b.finish, 1e-9);
  });

  test('One lost frame: Selective Repeat resends exactly 1, Go-Back-N resends the window', () => {
    const cfg = { N: 12, W: 4, Tf: 1, Tp: 2, seed: 1, dropData: [2] };
    const sr = FC.simulate(Object.assign({ protocol: 'sr' }, cfg));
    const gbn = FC.simulate(Object.assign({ protocol: 'gbn' }, cfg));
    assert.strictEqual(sr.stats.retx, 1);
    assert.ok(gbn.stats.retx >= 3, 'go-back-n resent ' + gbn.stats.retx);
    assert.ok(gbn.stats.discards >= 2);
    assert.ok(sr.finish <= gbn.finish);
    assert.strictEqual(sr.stats.timeouts, 1);
    assert.strictEqual(gbn.stats.timeouts, 1);
  });

  test('Lost ACK: Stop-and-Wait resends the frame, receiver recognises the duplicate', () => {
    const r = FC.simulate({ protocol: 'sw', N: 5, Tf: 1, Tp: 2, seed: 1, dropAck: [2] });
    assert.strictEqual(r.stats.retx, 1);
    assert.ok(r.log.rx.some((e) => e.kind === 'dup'));
    assert.strictEqual(r.stats.delivered, 5);
  });

  test('Cumulative ACKs: a lost ACK in Go-Back-N is covered by the next one', () => {
    // the next ACK arrives 1 Tf later, so the timer must be longer than 2*Tp + 1 for the cumulative ACK to save the day
    const r = FC.simulate({ protocol: 'gbn', N: 12, W: 4, Tf: 1, Tp: 2, seed: 1, dropAck: [2], timeout: 7 });
    assert.strictEqual(r.stats.retx, 0);
    const tight = FC.simulate({ protocol: 'gbn', N: 12, W: 4, Tf: 1, Tp: 2, seed: 1, dropAck: [2] });
    assert.ok(tight.stats.retx > 0, 'a timer that is too short causes needless go-back');
    assert.strictEqual(r.stats.delivered, 12);
  });

  test('Every frame is delivered exactly once and in order, for all protocols under random loss', () => {
    ['sw', 'gbn', 'sr'].forEach((protocol) => {
      for (let seed = 1; seed <= 25; seed++) {
        const r = FC.simulate({ protocol, N: 30, W: 5, Tf: 1, Tp: 1.5, seed, pData: 0.25, pAck: 0.2 });
        assert.notStrictEqual(r.finish, null, protocol + ' seed ' + seed + ' did not finish');
        const order = r.log.rx.filter((e) => e.kind === 'deliver').map((e) => e.seq);
        assert.deepStrictEqual(order, Array.from({ length: 30 }, (_, i) => i), protocol + ' seed ' + seed);
      }
    });
  });

  test('Same seed gives the same result; scripted drops use only the first attempt', () => {
    const cfg = { protocol: 'gbn', N: 20, W: 4, Tf: 1, Tp: 2, seed: 9, pData: 0.2 };
    assert.strictEqual(FC.simulate(cfg).finish, FC.simulate(cfg).finish);
    const r = FC.simulate({ protocol: 'sr', N: 8, W: 3, Tf: 1, Tp: 2, seed: 1, dropData: [3] });
    assert.strictEqual(r.log.frames.filter((f) => f.seq === 3 && f.lost).length, 1);
  });

  test('Simulation cannot loop forever when everything is lost', () => {
    const r = FC.simulate({ protocol: 'gbn', N: 5, W: 3, Tf: 1, Tp: 1, seed: 1, pData: 1, maxEvents: 5000 });
    assert.strictEqual(r.finish, null);
  });

  test('Measured efficiency under loss matches the textbook approximations (large window)', () => {
    const p = 0.15; const Tp = 2;
    const base2 = { N: 600, W: 24, Tf: 1, Tp, pData: p, pAck: 0 };
    const sr = FC.average(Object.assign({ protocol: 'sr' }, base2), 8).efficiency;
    const gbn = FC.average(Object.assign({ protocol: 'gbn' }, base2), 8).efficiency;
    const sw = FC.average(Object.assign({ protocol: 'sw', N: 300 }, { Tf: 1, Tp, pData: p, pAck: 0 }), 8).efficiency;
    close(sr, FC.lossyEfficiency('sr', p, Tp, 1), 0.05, 'SR');
    close(gbn, FC.lossyEfficiency('gbn', p, Tp, 1), 0.06, 'GBN');
    close(sw, FC.lossyEfficiency('sw', p, Tp, 1), 0.03, 'S&W');
    assert.ok(sr > gbn && gbn > sw, 'ordering SR > GBN > SW');
  });

  test('parseList accepts numbers and rejects junk', () => {
    assert.deepStrictEqual(FC.parseList('2, 5 7'), [2, 5, 7]);
    assert.deepStrictEqual(FC.parseList(''), []);
    assert.strictEqual(FC.parseList('2,x'), null);
  });
};
