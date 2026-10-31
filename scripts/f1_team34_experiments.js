/* ==========================================================================
   Protocol Lab - repeated experiments for the project report.
   Run:  node scripts/f1_team34_experiments.js
   Uses the same logic modules as the labs. Every random run uses a fixed seed,
   so the numbers below can be reproduced exactly.
   Writes results/f1_team34_experiment_results.json and prints the tables.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const jsDir = path.join(__dirname, '..', 'js');
require(path.join(jsDir, 'f1_team34_core.js'));
['routing', 'flow_control', 'tcp_congestion', 'queuing_qos'].forEach((m) => require(path.join(jsDir, 'f1_team34_' + m + '.js')));
const CN = globalThis.CN;
const RUNS = 30;

function stats(a) {
  const n = a.length; const mean = a.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { mean, sd, n };
}
const seeds = (base) => Array.from({ length: RUNS }, (_, i) => base * 1000 + i + 1);
const out = { runsPerCell: RUNS };

/* E1  Routing: rounds needed to settle after the last link of a chain breaks (deterministic) */
out.routing = [];
for (const len of [3, 4, 5, 6, 8]) {
  const ids = 'ABCDEFGHIJ'.slice(0, len).split('');
  const g = { nodes: ids.map((id, i) => ({ id, x: i * 50, y: 0 })), edges: ids.slice(1).map((id, i) => ({ a: ids[i], b: id, cost: 1, up: true })) };
  const row = { routers: len };
  for (const mode of ['none', 'split', 'poison']) {
    const settled = CN.routing.dvRun(g, CN.routing.dvInit(g), mode, 200);
    const gb = { nodes: g.nodes, edges: g.edges.map((e, i) => Object.assign({}, e, { up: i !== g.edges.length - 1 })) };
    const hist = CN.routing.dvRun(gb, settled[settled.length - 1], mode, 400);
    row[mode] = hist.length - 1;
  }
  out.routing.push(row);
}

/* E2  Flow control: Go-Back-N (baseline) vs Selective Repeat, random data-frame loss */
out.flow = [];
for (const [name, p] of [['S1 low loss', 0.02], ['S2 medium loss', 0.10], ['S3 high loss', 0.20]]) {
  const cell = { scenario: name, loss: p };
  for (const proto of ['gbn', 'sr']) {
    const effs = []; const retx = [];
    seeds(1).forEach((seed) => {
      const r = CN.flowControl.simulate({ protocol: proto, N: 200, W: 8, Tf: 1, Tp: 2, pData: p, pAck: 0, seed, record: false });
      if (r.finish !== null) { effs.push(r.stats.efficiency); retx.push(r.stats.retx / r.stats.N); }
    });
    cell[proto] = { efficiency: stats(effs), retxPerFrame: stats(retx) };
  }
  out.flow.push(cell);
}

/* E3  TCP: Tahoe (baseline) vs Reno, same random loss events for both, 100 RTT rounds */
out.tcp = [];
for (const [name, p] of [['S1 low loss', 0.02], ['S2 medium loss', 0.05], ['S3 high loss', 0.10]]) {
  const cell = { scenario: name, loss: p };
  const diffs = [];
  for (const variant of ['tahoe', 'reno']) cell[variant] = [];
  seeds(2).forEach((seed) => {
    const ev = CN.tcpCongestion.makeEvents({}, 100, p, seed);
    const t = CN.tcpCongestion.windowTrace({ variant: 'tahoe', rounds: 100, ssthresh: 16, events: ev }).segments;
    const r = CN.tcpCongestion.windowTrace({ variant: 'reno', rounds: 100, ssthresh: 16, events: ev }).segments;
    cell.tahoe.push(t); cell.reno.push(r); diffs.push((r - t) / t * 100);
  });
  cell.tahoe = stats(cell.tahoe); cell.reno = stats(cell.reno); cell.gainPct = stats(diffs);
  out.tcp.push(cell);
}

/* E4  Queuing: FIFO (baseline) vs priority vs WFQ on identical traffic, 1 Mbps link */
out.qos = [];
for (const [name, load] of [['S1 light data load', 0.5], ['S2 medium data load', 0.8], ['S3 heavy data load', 0.95]]) {
  const cell = { scenario: name, dataLoad: load };
  const acc = { fifo: { p95: [], mean: [], loss: [], jit: [], bulk: [] }, priority: { p95: [], mean: [], loss: [], jit: [], bulk: [] }, wfq: { p95: [], mean: [], loss: [], jit: [], bulk: [] } };
  seeds(3).forEach((seed) => {
    const res = CN.queuingQos.compare({ capacity: 1e6, dataLoad: load, burst: 0.3, duration: 20, seed, buffer: 50, voipWeight: 0.25, keepSeries: false });
    Object.keys(acc).forEach((d) => {
      const v = res[d].flows[0];
      acc[d].p95.push(v.p95Ms); acc[d].mean.push(v.meanMs); acc[d].loss.push(v.loss * 100); acc[d].jit.push(v.jitterMs);
      acc[d].bulk.push(res[d].flows[2].loss * 100);
    });
  });
  Object.keys(acc).forEach((d) => { cell[d] = {}; Object.keys(acc[d]).forEach((k) => { cell[d][k] = stats(acc[d][k]); }); });
  out.qos.push(cell);
}

fs.mkdirSync(path.join(__dirname, '..', 'results'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'results', 'f1_team34_experiment_results.json'), JSON.stringify(out, null, 2));
const f = (s, d) => s.mean.toFixed(d) + ' +/- ' + s.sd.toFixed(d);
console.log('\nRouting: rounds to settle after the last link breaks (chain of n routers)');
out.routing.forEach((r) => console.log('  n=' + r.routers + '  plain ' + r.none + '  split ' + r.split + '  poison ' + r.poison));
console.log('\nFlow control (N=200, W=8, Tf=1, Tp=2), ' + RUNS + ' seeds');
out.flow.forEach((c) => console.log('  ' + c.scenario + ' p=' + c.loss + '  eff GBN ' + f(c.gbn.efficiency, 3) + ' SR ' + f(c.sr.efficiency, 3) + '  retx/frame GBN ' + f(c.gbn.retxPerFrame, 3) + ' SR ' + f(c.sr.retxPerFrame, 3)));
console.log('\nTCP (100 rounds, ssthresh 16), ' + RUNS + ' seeds');
out.tcp.forEach((c) => console.log('  ' + c.scenario + ' p=' + c.loss + '  Tahoe ' + f(c.tahoe, 0) + ' Reno ' + f(c.reno, 0) + ' gain% ' + f(c.gainPct, 1)));
console.log('\nQoS VoIP (1 Mbps, 20 s), ' + RUNS + ' seeds');
out.qos.forEach((c) => console.log('  ' + c.scenario + '  p95 ms FIFO ' + f(c.fifo.p95, 1) + ' PQ ' + f(c.priority.p95, 1) + ' WFQ ' + f(c.wfq.p95, 1) + ' | loss% FIFO ' + f(c.fifo.loss, 2) + ' PQ ' + f(c.priority.loss, 2) + ' WFQ ' + f(c.wfq.loss, 2) + ' | bulk loss% PQ ' + f(c.priority.bulk, 2) + ' WFQ ' + f(c.wfq.bulk, 2) + ' FIFO ' + f(c.fifo.bulk, 2)));
