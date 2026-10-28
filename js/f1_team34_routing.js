/* ==========================================================================
   Tab: Routing  (Unit 5, Routing Protocols)
   Part 1 - logic (no DOM):
     * dijkstra()       link-state shortest paths with a step-by-step trace
     * dvInit / dvStep  distance-vector (Bellman-Ford) one synchronous round
                        at a time, with split horizon and poison reverse
   Part 2 - the interface: a drawn network you can change, two algorithm modes.
   ========================================================================== */
(function (root) {
  'use strict';
  const CN = (root.CN = root.CN || {});
  const R = (CN.routing = {});
  const INF = 32; // "infinity": a cost of 32 or more means unreachable (RIP uses 16, but our example costs reach 20)

  R.INF = INF;
  R.PRESETS = {
    classic: {
      name: 'Six routers (classic example)',
      nodes: [{ id: 'A', x: 70, y: 170 }, { id: 'B', x: 190, y: 60 }, { id: 'C', x: 200, y: 262 }, { id: 'D', x: 395, y: 60 }, { id: 'E', x: 530, y: 170 }, { id: 'F', x: 395, y: 262 }],
      edges: [['A', 'B', 7], ['A', 'C', 9], ['A', 'F', 14], ['B', 'C', 10], ['B', 'D', 15], ['C', 'D', 11], ['C', 'F', 2], ['D', 'E', 6], ['E', 'F', 9]],
    },
    chain: {
      name: 'Three in a line (count-to-infinity demo)',
      nodes: [{ id: 'A', x: 110, y: 160 }, { id: 'B', x: 300, y: 160 }, { id: 'C', x: 490, y: 160 }],
      edges: [['A', 'B', 1], ['B', 'C', 1]],
    },
  };
  R.makeGraph = function (key) {
    const p = R.PRESETS[key];
    return { nodes: p.nodes.map((n) => Object.assign({}, n)), edges: p.edges.map(([a, b, cost]) => ({ a, b, cost, up: true })) };
  };
  R.neighbours = function (g, id) {
    const out = [];
    g.edges.forEach((e, i) => { if (!e.up) return; if (e.a === id) out.push({ id: e.b, cost: e.cost, edge: i }); else if (e.b === id) out.push({ id: e.a, cost: e.cost, edge: i }); });
    return out;
  };

  /* ----- link state: Dijkstra ----------------------------------------------- */
  R.dijkstra = function (g, src) {
    const ids = g.nodes.map((n) => n.id);
    const dist = {}; const prev = {}; const done = {};
    ids.forEach((id) => { dist[id] = Infinity; prev[id] = null; done[id] = false; });
    dist[src] = 0;
    const snap = () => ({ dist: Object.assign({}, dist), prev: Object.assign({}, prev), done: Object.assign({}, done) });
    const steps = [Object.assign({ picked: null, relax: [] }, snap())];
    for (;;) {
      let u = null;
      ids.forEach((id) => { if (!done[id] && dist[id] < Infinity && (u === null || dist[id] < dist[u])) u = id; });
      if (u === null) break;
      done[u] = true;
      const relax = [];
      R.neighbours(g, u).forEach((nb) => {
        if (done[nb.id]) return;
        const alt = dist[u] + nb.cost;
        const better = alt < dist[nb.id];
        relax.push({ node: nb.id, alt, old: dist[nb.id], improved: better });
        if (better) { dist[nb.id] = alt; prev[nb.id] = u; }
      });
      steps.push(Object.assign({ picked: u, relax }, snap()));
    }
    return { dist, prev, steps };
  };
  R.pathTo = function (prev, dst) {
    const p = []; let x = dst;
    while (x !== null && x !== undefined) { p.unshift(x); x = prev[x]; }
    return p;
  };
  R.firstHop = (prev, src, dst) => { const p = R.pathTo(prev, dst); return p[0] === src && p.length > 1 ? p[1] : null; };

  /* ----- distance vector ----------------------------------------------------- */
  /* state[node][dest] = { cost, next } */
  R.dvInit = function (g) {
    const ids = g.nodes.map((n) => n.id); const st = {};
    ids.forEach((n) => {
      st[n] = {};
      ids.forEach((d) => { st[n][d] = { cost: n === d ? 0 : INF, next: n === d ? n : null }; });
      R.neighbours(g, n).forEach((nb) => { if (nb.cost < st[n][nb.id].cost) st[n][nb.id] = { cost: nb.cost, next: nb.id }; });
    });
    return st;
  };
  /* One synchronous round: every node recomputes from its neighbours' previous vectors. mode: 'none' | 'split' | 'poison' */
  R.dvStep = function (g, st, mode) {
    const ids = g.nodes.map((n) => n.id); const next = {}; let changed = false;
    ids.forEach((n) => {
      next[n] = {}; const nbs = R.neighbours(g, n);
      ids.forEach((d) => {
        if (d === n) { next[n][d] = { cost: 0, next: n }; return; }
        let best = { cost: INF, next: null };
        nbs.forEach((nb) => {
          let adv = st[nb.id][d].cost;
          if (st[nb.id][d].next === n && d !== nb.id) { // the neighbour reaches d through us
            if (mode === 'split') adv = INF; // do not tell us the route we taught it
            if (mode === 'poison') adv = INF; // tell us explicitly it is unreachable
          }
          const c = Math.min(INF, nb.cost + adv);
          const cur = st[n][d];
          if (c < best.cost || (c === best.cost && c < INF && (nb.id === cur.next && best.next !== cur.next || (best.next !== cur.next && nb.id < best.next)))) best = { cost: c, next: nb.id };
        });
        if (best.cost >= INF) best = { cost: INF, next: null };
        next[n][d] = best;
        if (best.cost !== st[n][d].cost || best.next !== st[n][d].next) changed = true;
      });
    });
    return { state: next, changed };
  };
  R.dvRun = function (g, st, mode, maxRounds) {
    const history = [st]; let cur = st;
    for (let i = 0; i < (maxRounds || 60); i++) {
      const r = R.dvStep(g, cur, mode);
      if (!r.changed) break;
      history.push(r.state); cur = r.state;
    }
    return history;
  };

  if (typeof document === 'undefined') return;

  /* ======================================================================
     USER INTERFACE
     ====================================================================== */
  const h = CN.h;

  /* draws the network; styleNode(id) -> class, styleEdge(i) -> class */
  function drawGraph(g, o) {
    const W = 600; const H = 330;
    const svg = h('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'netsvg', role: 'img', 'aria-label': 'Network of routers and links with costs' });
    const pos = {}; g.nodes.forEach((n) => { pos[n.id] = n; });
    g.edges.forEach((e, i) => {
      const a = pos[e.a]; const b = pos[e.b]; const cls = 'nedge ' + (e.up ? '' : 'down ') + (o.edgeClass ? o.edgeClass(i) : '') + (i === o.selected ? ' sel' : '');
      const gEl = h('g', { class: 'nedge-g', onclick: () => o.onEdge && o.onEdge(i), style: 'cursor:pointer' },
        h('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'nhit' }),
        h('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: cls }));
      const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
      gEl.appendChild(h('rect', { x: mx - 14, y: my - 10, width: 28, height: 20, rx: 4, class: 'ncostbg' + (i === o.selected ? ' sel' : '') }));
      gEl.appendChild(h('text', { x: mx, y: my + 4, 'text-anchor': 'middle', class: 'ncost' }, e.up ? e.cost : '✕'));
      svg.appendChild(gEl);
    });
    g.nodes.forEach((n) => {
      const cls = 'nnode ' + (o.nodeClass ? o.nodeClass(n.id) : '');
      svg.appendChild(h('g', { onclick: () => o.onNode && o.onNode(n.id), style: o.onNode ? 'cursor:pointer' : null },
        h('circle', { cx: n.x, cy: n.y, r: 21, class: cls }),
        h('text', { x: n.x, y: n.y + 5, 'text-anchor': 'middle', class: 'nlabel' }, n.id),
        o.badge && o.badge(n.id) !== undefined ? h('text', { x: n.x, y: n.y - 29, 'text-anchor': 'middle', class: 'nbadge' }, o.badge(n.id)) : null));
    });
    return svg;
  }
  const fmtD = (d) => (d === Infinity ? '∞' : String(d));

  CN.registerTab({
    id: 'routing',
    group: { layer: 3, name: 'Network' },
    title: 'Routing',
    mount(page) {
      page.appendChild(CN.pageHead({
        title: 'Routing protocols',
        lead: 'A router has to learn the best path to every network. Link-state routers each learn the whole map and run Dijkstra. Distance-vector routers only trade tables with their neighbours. Change the network and watch both react.',
        units: [{ unit: 5, name: 'Routing Protocols' }],
        topics: ['link state routing (Dijkstra)', 'distance vector routing', 'count to infinity, split horizon and poison reverse'],
      }));

      let g = R.makeGraph('classic');
      let selected = 0;
      let mode = 'ls';

      /* ---------- shared controls ---------- */
      const preset = CN.select({ label: 'Network', options: Object.keys(R.PRESETS).map((k) => ({ value: k, label: R.PRESETS[k].name })), value: 'classic', onChange: (v) => { g = R.makeGraph(v); selected = 0; src.setOptions(g); resetAll(); } });
      const edgeSel = h('select', { 'aria-label': 'Selected link' });
      const costSlider = CN.slider({ label: 'Link cost', min: 1, max: 15, value: 7, onInput: (v) => { g.edges[selected].cost = v; onGraphChanged(); }, hint: 'Cost might be distance, delay or the inverse of bandwidth.' });
      const downBtn = CN.button('Break link', { onClick: () => { g.edges[selected].up = !g.edges[selected].up; onGraphChanged(); } });
      edgeSel.addEventListener('change', () => { selected = Number(edgeSel.value); syncEdgeUi(); renderAll(); });

      const src = (function () {
        const sel = h('select', { 'aria-label': 'Router running the algorithm' });
        const api = {
          el: h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Router to compute from'), sel),
          get: () => sel.value, select: sel,
          setOptions(gr) { const keep = sel.value; CN.clear(sel); gr.nodes.forEach((n) => sel.appendChild(h('option', { value: n.id }, 'Router ' + n.id))); sel.value = gr.nodes.some((n) => n.id === keep) ? keep : gr.nodes[0].id; },
        };
        sel.addEventListener('change', () => { resetLs(); renderAll(); });
        api.setOptions(g); return api;
      })();

      const modeSeg = CN.segmented({ label: 'Algorithm', options: [{ value: 'ls', label: 'Link state' }, { value: 'dv', label: 'Distance vector' }], value: 'ls', onChange: (v) => { mode = v; renderAll(); } });
      const dvMode = CN.select({ label: 'Count-to-infinity fix', options: [{ value: 'none', label: 'None (plain distance vector)' }, { value: 'split', label: 'Split horizon' }, { value: 'poison', label: 'Poison reverse' }], value: 'none', onChange: () => { resetDv(); renderAll(); }, hint: 'Only used by distance vector.' });
      const dvDest = CN.select({ label: 'Plot cost to router', options: g.nodes.map((n) => ({ value: n.id, label: 'Router ' + n.id })), onChange: () => renderAll() });
      const dvView = CN.select({ label: 'Show table of router', options: g.nodes.map((n) => ({ value: n.id, label: 'Router ' + n.id })), onChange: () => renderAll() });

      const lsControls = h('div', null, src.el);
      const dvControls = h('div', { class: 'stackgap' }, dvMode.el, dvView.el, dvDest.el);

      const controls = h('div', { class: 'controls' },
        h('h3', null, 'Algorithm'), modeSeg.el, lsControls, dvControls,
        h('h3', null, 'Network'), preset.el,
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Selected link (or click it)'), edgeSel),
        costSlider.el, downBtn);

      /* ---------- link state state ---------- */
      let ls = { trace: null, idx: 0 };
      function resetLs() { ls = { trace: R.dijkstra(g, src.get()), idx: 0 }; }
      /* ---------- distance vector state ---------- */
      let dv = { hist: [R.dvInit(g)], round: 0, converged: false };
      function resetDv() { dv = { hist: [R.dvInit(g)], round: 0, converged: false }; }
      function resetAll() { resetLs(); resetDv(); syncEdgeUi(); fillDvSelects(true); renderAll(); }

      function fillDvSelects(fresh) {
        const fill = (api, labelFn, def, fresh) => {
          const sel = api.select; const keep = fresh ? null : sel.value; CN.clear(sel);
          g.nodes.forEach((n) => sel.appendChild(h('option', { value: n.id }, labelFn(n.id))));
          sel.value = g.nodes.some((n) => n.id === keep) ? keep : def;
        };
        fill(dvDest, (id) => 'Router ' + id, g.nodes[g.nodes.length - 1].id, fresh);
        fill(dvView, (id) => 'Router ' + id, g.nodes[0].id, fresh);
      }
      function syncEdgeUi() {
        CN.clear(edgeSel);
        g.edges.forEach((e, i) => edgeSel.appendChild(h('option', { value: i }, e.a + ' – ' + e.b + (e.up ? '' : '  (down)'))));
        edgeSel.value = selected;
        costSlider.set(g.edges[selected].cost);
        downBtn.textContent = g.edges[selected].up ? 'Break link' : 'Restore link';
      }
      function onGraphChanged() {
        syncEdgeUi();
        if (mode === 'ls') resetLs(); // link state floods the change, so everyone recomputes at once
        else dv.converged = false; // distance vector keeps its tables; the next round reacts
        renderAll();
      }

      /* ---------- stage ---------- */
      const graphHost = h('div'); const infoHost = h('div'); const tableHost = h('div'); const noteHost = h('div'); const chartHost = h('div');
      const buttons = h('div', { class: 'row', style: 'margin-bottom:10px' });
      const chart = new CN.Chart(chartHost, { height: 230, label: 'Cost to the chosen router over rounds' });
      const stage = h('div', { class: 'stage' },
        CN.panel('The network', 'Click a link to select it, then change its cost or break it.', graphHost, buttons),
        noteHost, infoHost, tableHost, h('div', { class: 'dvonly' }, CN.panel('Cost over time', 'Watch what happens to the cost after a link fails.', chartHost)));
      const dvOnly = stage.querySelector('.dvonly');

      function renderLs() {
        const tr = ls.trace; const st = tr.steps[ls.idx]; const total = tr.steps.length - 1;
        CN.clear(buttons);
        buttons.appendChild(CN.button(ls.idx >= total ? 'Finished' : 'Next step', { kind: 'primary', onClick: () => { if (ls.idx < total) { ls.idx++; renderAll(); } } }));
        buttons.appendChild(CN.button('Run to the end', { onClick: () => { ls.idx = total; renderAll(); } }));
        buttons.appendChild(CN.button('Restart', { onClick: () => { ls.idx = 0; renderAll(); } }));
        buttons.appendChild(h('span', { class: 'field-hint' }, 'Step ' + ls.idx + ' of ' + total));
        const treeEdges = new Set();
        g.nodes.forEach((n) => { if (st.done[n.id] && st.prev[n.id]) g.edges.forEach((e, i) => { if (e.up && ((e.a === n.id && e.b === st.prev[n.id]) || (e.b === n.id && e.a === st.prev[n.id]))) treeEdges.add(i); }); });
        CN.clear(graphHost);
        graphHost.appendChild(drawGraph(g, {
          selected, onEdge: (i) => { selected = i; syncEdgeUi(); renderAll(); },
          nodeClass: (id) => (id === src.get() ? 'src ' : '') + (id === st.picked ? 'pick' : st.done[id] ? 'done' : st.dist[id] < Infinity ? 'tent' : ''),
          edgeClass: (i) => (treeEdges.has(i) ? 'tree' : ''),
          badge: (id) => fmtD(st.dist[id]),
        }));
        CN.clear(noteHost);
        let msg;
        if (ls.idx === 0) msg = 'Router ' + src.get() + ' knows the whole map (each router floods its links to everyone). It starts with distance 0 to itself and infinity to everyone else.';
        else {
          const rx = st.relax.map((r) => r.node + ': ' + fmtD(st.dist[st.picked]) + ' + ' + (r.alt - st.dist[st.picked]) + ' = ' + r.alt + (r.improved ? (r.old === Infinity ? ' (new)' : ' (better than ' + r.old + ')') : ' (not better than ' + r.old + ')')).join('; ');
          msg = 'Pick ' + st.picked + ', the closest router not yet finalised (distance ' + st.dist[st.picked] + '). ' + (rx ? 'Relax its neighbours: ' + rx + '.' : 'It has no unfinalised neighbours.');
        }
        noteHost.appendChild(CN.note('info', msg));
        CN.clear(infoHost); dvOnly.style.display = 'none';
        // routing table once everything is done
        const rows = g.nodes.filter((n) => n.id !== src.get()).map((n) => {
          const finished = st.done[n.id]; const path = R.pathTo(st.prev, n.id);
          return h('tr', { class: finished ? '' : 'pending' }, h('td', null, n.id), h('td', { class: 'num' }, fmtD(st.dist[n.id])), h('td', null, finished && path[0] === src.get() ? path.join(' → ') : '-'), h('td', null, finished ? R.firstHop(st.prev, src.get(), n.id) || '-' : '-'),
            h('td', null, finished ? 'final' : st.dist[n.id] < Infinity ? 'tentative' : 'unknown'));
        });
        CN.clear(tableHost);
        tableHost.appendChild(CN.panel('Router ' + src.get() + ': routing table', 'The next hop is the only thing the router needs to forward a packet.', h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', null, 'To'), h('th', { class: 'num' }, 'Cost'), h('th', null, 'Shortest path'), h('th', null, 'Next hop'), h('th', null, 'Status'))), h('tbody', null, rows)))));
      }

      function renderDv() {
        const cur = dv.hist[dv.round]; const nodeId = dvView.select.value || g.nodes[0].id;
        CN.clear(buttons);
        buttons.appendChild(CN.button('Next round', { kind: 'primary', onClick: () => { stepDv(); } }));
        buttons.appendChild(CN.button('Run until stable', { onClick: () => { for (let i = 0; i < 40 && !dv.converged; i++) stepDv(true); renderAll(); } }));
        buttons.appendChild(CN.button('Restart', { onClick: () => { resetDv(); renderAll(); } }));
        buttons.appendChild(h('span', { class: 'field-hint' }, 'Round ' + dv.round + (dv.converged ? ' (stable)' : '')));
        CN.clear(graphHost);
        graphHost.appendChild(drawGraph(g, {
          selected, onEdge: (i) => { selected = i; syncEdgeUi(); renderAll(); },
          onNode: (id) => { dvView.select.value = id; renderAll(); },
          nodeClass: (id) => (id === nodeId ? 'src' : ''), badge: (id) => (id === nodeId ? undefined : (cur[nodeId][id].cost >= INF ? '∞' : String(cur[nodeId][id].cost))),
        }));
        CN.clear(noteHost);
        const brokenAny = g.edges.some((e) => !e.up);
        noteHost.appendChild(CN.note(dv.converged ? 'good' : 'info', dv.round === 0
          ? 'Round 0: each router only knows its direct neighbours. Press Next round: every router sends its table to its neighbours and recomputes. Numbers above the routers are router ' + nodeId + '’s current costs.'
          : dv.converged ? 'Stable after ' + dv.round + ' rounds: no table changed in the last round. ' + (brokenAny ? 'Costs of ' + INF + ' mean unreachable (infinity).' : 'Now break a link and press Next round to see how bad news travels.')
            : 'Round ' + dv.round + ': tables changed, so another round is needed.' + (brokenAny && dvMode.get() === 'none' ? ' Without a fix, neighbours keep believing each other’s old routes and costs creep upward one round at a time (count to infinity).' : '')));
        // matrix of all tables
        const ids = g.nodes.map((n) => n.id);
        CN.clear(tableHost);
        const mat = h('table', { class: 'tbl dvmat' }, h('thead', null, h('tr', null, h('th', null, 'From \\ To'), ids.map((d) => h('th', { class: 'num' }, d)))),
          h('tbody', null, ids.map((n) => h('tr', { class: n === nodeId ? 'sel' : '' }, h('td', null, 'Router ' + n), ids.map((d) => {
            const c = cur[n][d]; const prevC = dv.round > 0 ? dv.hist[dv.round - 1][n][d] : c; const ch = prevC.cost !== c.cost || prevC.next !== c.next;
            return h('td', { class: 'num' + (ch ? ' chg' : '') }, c.cost >= INF ? '∞' : c.cost + (n === d ? '' : ' (' + c.next + ')'));
          })))));
        tableHost.appendChild(CN.panel('All routing tables', 'Each cell is cost (next hop). Highlighted cells changed in the last round.', h('div', { class: 'scroll-x' }, mat)));
        CN.clear(infoHost);
        // chart
        dvOnly.style.display = '';
        const dest = dvDest.select.value;
        chart.set({
          xLabel: 'Round', yLabel: 'Cost from router ' + nodeId + ' to ' + dest, yMin: 0, yMax: INF + 1, xMin: 0, xMax: Math.max(6, dv.hist.length - 1), xTipLabel: 'round ', xFormat: (x) => String(Math.round(x)),
          hlines: [{ y: INF, label: 'infinity (' + INF + ')', color: 'bad' }], series: [{ name: 'Cost to ' + dest, color: 's1', type: 'line', marker: true, noLegend: true, points: dv.hist.map((s, i) => [i, Math.min(INF, s[nodeId][dest].cost)]) }],
        });
      }
      function stepDv(silent) {
        if (dv.converged) { if (!silent) renderAll(); return; }
        const r = R.dvStep(g, dv.hist[dv.round], dvMode.get());
        if (!r.changed) dv.converged = true; else { dv.hist.push(r.state); dv.round++; }
        if (!silent) renderAll();
      }

      function renderAll() {
        lsControls.style.display = mode === 'ls' ? '' : 'none'; dvControls.style.display = mode === 'dv' ? '' : 'none';
        if (mode === 'ls') { if (!ls.trace) resetLs(); renderLs(); } else renderDv();
      }
      // changing a link in distance-vector mode keeps the tables (that is the point), but lets the algorithm run again

      page.appendChild(h('div', { class: 'workbench' }, controls, stage));
      syncEdgeUi(); fillDvSelects(true); resetLs(); renderAll();

      page.appendChild(CN.section('How it works', 'Short notes for revision', h('div', { class: 'stage', style: 'gap:10px' },
        CN.theory('Link state and Dijkstra', '<ul><li>Every router floods a description of its links (a link-state advertisement) to the whole network, so every router holds the same map. OSPF works this way.</li><li>Each router then runs <b>Dijkstra</b>: keep a distance for every router, repeatedly finalise the closest unfinished one, and relax its neighbours (if distance(u) + cost(u,v) is smaller, update v).</li><li>The result is a shortest-path tree. Only the <b>next hop</b> goes into the forwarding table. Converges quickly but needs memory and flooding.</li></ul>'),
        CN.theory('Distance vector and Bellman-Ford', '<ul><li>Each router knows only its neighbours and tells them its table (a vector of distances). Every round, a router computes cost(v) = min over neighbours n of ( cost to n + n’s advertised cost to v ). RIP works this way, with 16 as infinity (this lab uses 32 so the example costs fit).</li><li>Routers never see the whole map: &ldquo;routing by rumour&rdquo;. Good news travels one hop per round; bad news can travel very slowly.</li></ul>'),
        CN.theory('Count to infinity, split horizon, poison reverse', '<ul><li>If B loses its link to C, B may hear A claim a route to C (which really goes through B). B believes it and adds 1, then A adds 1, and so on, climbing to infinity.</li><li><b>Split horizon</b>: do not advertise a route back to the neighbour you learned it from. <b>Poison reverse</b>: advertise it back, but with cost infinity. Both fix simple loops like this one; they cannot stop every loop in larger networks.</li></ul>'))));
      return { destroy() {} };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
