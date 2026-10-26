/* Tests for the multiple access simulators */
'use strict';
module.exports = function ({ test, assert, close, CN }) {
  const MAC = CN.multipleAccess;

  test('Pure ALOHA simulation follows S = G e^(-2G); maximum about 0.184 at G = 0.5', () => {
    [0.1, 0.5, 1, 2].forEach((G) => close(MAC.throughputPoint('aloha', G, { frames: 60000, seed: 3 }), MAC.theory.aloha(G), 0.012, 'G=' + G));
    close(MAC.theory.aloha(0.5), 0.1839, 0.001);
  });

  test('Slotted ALOHA simulation follows S = G e^(-G); maximum about 0.368 at G = 1', () => {
    [0.2, 1, 2, 3].forEach((G) => close(MAC.throughputPoint('slotted', G, { frames: 40000, seed: 3 }), MAC.theory.slotted(G), 0.012, 'G=' + G));
    close(MAC.theory.slotted(1), 0.3679, 0.001);
  });

  test('Non-persistent and 1-persistent CSMA simulations match the Kleinrock-Tobagi slotted formulas', () => {
    [0.2, 1, 3, 6].forEach((G) => {
      close(MAC.throughputPoint('csmanp', G, { L: 10, frames: 20000, seed: 4 }), MAC.theory.csmanp(G, 0.1), 0.02, 'np G=' + G);
      close(MAC.throughputPoint('csma1', G, { L: 10, frames: 20000, seed: 4 }), MAC.theory.csma1(G, 0.1), 0.02, '1p G=' + G);
    });
  });

  test('Carrier sensing beats ALOHA at the same load; shorter wires (smaller a) help CSMA', () => {
    const G = 1;
    const csma = MAC.throughputPoint('csmanp', G, { L: 10, frames: 20000, seed: 2 });
    assert.ok(csma > MAC.theory.slotted(G) + 0.05, 'csma ' + csma);
    const near = MAC.throughputPoint('csma1', 2, { L: 50, frames: 12000, seed: 2 });
    const far = MAC.throughputPoint('csma1', 2, { L: 5, frames: 12000, seed: 2 });
    assert.ok(near > far, 'a=0.02 should beat a=0.2: ' + near + ' vs ' + far);
  });

  test('CSMA/CD recovers from collisions faster than plain 1-persistent CSMA at heavy load', () => {
    const cd = MAC.throughputPoint('csmacd', 3, { L: 10, frames: 20000, seed: 2 });
    const p1 = MAC.throughputPoint('csma1', 3, { L: 10, frames: 20000, seed: 2 });
    assert.ok(cd > p1, 'cd ' + cd + ' vs 1p ' + p1);
  });

  test('Live simulation: light traffic is delivered almost completely; every protocol conserves frames', () => {
    MAC.PROTOCOLS.forEach((p) => {
      const sim = MAC.createSim({ protocol: p.id, N: 5, L: 10, load: 0.1, seed: 1 });
      sim.run(10 * 3000);
      const s = sim.summary();
      assert.ok(s.S > 0.07 && s.S <= 0.11, p.id + ' S=' + s.S);
      const inFlight = sim.stations.filter((x) => x.state !== 0).length;
      assert.strictEqual(sim.stats.generated, sim.stats.delivered + sim.stats.dropped + inFlight, p.id + ' frame accounting');
    });
  });

  test('Live simulation: heavy traffic makes ALOHA collide a lot, CSMA/CD copes better', () => {
    const run = (id) => { const sim = MAC.createSim({ protocol: id, N: 8, L: 10, load: 2, seed: 5 }); sim.run(10 * 4000); return sim.summary(); };
    const aloha = run('aloha'); const cd = run('csmacd'); const slotted = run('slotted');
    assert.ok(aloha.collidedShare > 0.3, 'aloha collisions ' + aloha.collidedShare);
    assert.ok(cd.S > aloha.S, 'cd ' + cd.S + ' aloha ' + aloha.S);
    assert.ok(slotted.S > aloha.S * 0.9);
  });

  test('Live simulation: slotted ALOHA frames always start on a slot boundary', () => {
    const sim = MAC.createSim({ protocol: 'slotted', N: 4, L: 10, load: 1, seed: 2 });
    sim.run(2000);
    for (let i = 0; i < 4; i++) {
      for (let k = 1; k < 2000; k++) {
        const c = sim.code(i, k); const prev = sim.code(i, k - 1);
        if ((c === 3 || c === 4 || c === 2) && !(prev === 3 || prev === 4 || prev === 2)) assert.strictEqual(k % 10, 0, 'station ' + i + ' started at ' + k);
      }
    }
  });

  test('Live simulation is repeatable for a given seed', () => {
    const a = MAC.createSim({ protocol: 'csma1', N: 6, L: 10, load: 1, seed: 8 }); a.run(3000);
    const b = MAC.createSim({ protocol: 'csma1', N: 6, L: 10, load: 1, seed: 8 }); b.run(3000);
    assert.deepStrictEqual(a.summary(), b.summary());
  });
};
