/* Tests for the Routing lab logic */
module.exports = function ({ test, assert, close, CN }) {
  const R = CN.routing;

  test('Dijkstra on the classic graph gives the textbook distances from A', () => {
    const g = R.makeGraph('classic'); const r = R.dijkstra(g, 'A');
    assert(r.dist.A === 0 && r.dist.B === 7 && r.dist.C === 9 && r.dist.F === 11 && r.dist.D === 20 && r.dist.E === 20, JSON.stringify(r.dist));
    assert(R.pathTo(r.prev, 'E').join('') === 'ACFE', R.pathTo(r.prev, 'E').join(''));
    assert(R.firstHop(r.prev, 'A', 'E') === 'C');
  });

  test('Dijkstra trace finalises every reachable router once, in order of distance', () => {
    const g = R.makeGraph('classic'); const r = R.dijkstra(g, 'A');
    const picks = r.steps.slice(1).map((s) => s.picked);
    assert(new Set(picks).size === picks.length && picks.length === 6);
    const d = picks.map((p) => r.dist[p]);
    for (let i = 1; i < d.length; i++) assert(d[i] >= d[i - 1], 'distances must be non-decreasing');
  });

  test('a broken link is ignored and unreachable routers stay at infinity', () => {
    const g = R.makeGraph('chain'); g.edges[1].up = false;
    const r = R.dijkstra(g, 'A');
    assert(r.dist.B === 1 && r.dist.C === Infinity);
  });

  test('distance vector converges to the same costs as Dijkstra', () => {
    const g = R.makeGraph('classic'); const hist = R.dvRun(g, R.dvInit(g), 'none');
    const last = hist[hist.length - 1];
    g.nodes.forEach((s) => { const dj = R.dijkstra(g, s.id); g.nodes.forEach((t) => assert(last[s.id][t.id].cost === dj.dist[t.id], s.id + '->' + t.id)); });
  });

  test('plain distance vector counts to infinity after the C link fails', () => {
    const g = R.makeGraph('chain'); let st = R.dvRun(g, R.dvInit(g), 'none'); st = st[st.length - 1];
    assert(st.A.C.cost === 2);
    g.edges[1].up = false;
    const hist = R.dvRun(g, st, 'none', 60);
    const costs = hist.map((s) => s.A.C.cost);
    assert(costs.length > 6, 'should take many rounds, got ' + costs.length);
    assert(costs.some((c, i) => i > 0 && c > costs[i - 1]), 'cost should climb');
    assert(costs[costs.length - 1] === R.INF);
  });

  test('split horizon and poison reverse stop the loop on the chain', () => {
    ['split', 'poison'].forEach((m) => {
      const g = R.makeGraph('chain'); let st = R.dvRun(g, R.dvInit(g), m); st = st[st.length - 1];
      g.edges[1].up = false;
      const hist = R.dvRun(g, st, m, 60);
      assert(hist.length <= 4, m + ' took ' + hist.length + ' rounds');
      assert(hist[hist.length - 1].A.C.cost === R.INF && hist[hist.length - 1].B.C.cost === R.INF);
    });
  });
};
