/* ==========================================================================
   Protocol Lab - core helpers
   Shared by every tab: random numbers, tiny DOM helpers, form widgets,
   the tab registry, the hash router and the light/dark theme switch.
   Written as plain browser JavaScript (no modules, no build step) so the
   project runs by double-clicking f1_team34_index.html.
   ========================================================================== */
(function (root) {
  'use strict';
  const CN = (root.CN = root.CN || {});

  /* ------------------------------------------------------------------
     1. Seeded random numbers
     A seed makes every simulation repeatable: same seed -> same result.
     ------------------------------------------------------------------ */
  CN.makeRng = function (seed) {
    let s = (Number(seed) >>> 0) || 1;
    function next() {
      // mulberry32: small, fast, good enough for simulations
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)); // inclusive both ends
    next.chance = (p) => next() < p;
    next.exp = (rate) => -Math.log(1 - next()) / rate; // exponential waiting time
    next.normal = () => {
      // Box-Muller
      const u = 1 - next();
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    next.poisson = (lambda) => {
      if (lambda <= 0) return 0;
      if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * next.normal()));
      const limit = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do { k++; p *= next(); } while (p > limit);
      return k - 1;
    };
    next.binomial = (n, p) => {
      if (n <= 0 || p <= 0) return 0;
      if (p >= 1) return n;
      if (n > 60) {
        const mean = n * p;
        const sd = Math.sqrt(n * p * (1 - p));
        return Math.min(n, Math.max(0, Math.round(mean + sd * next.normal())));
      }
      let c = 0;
      for (let i = 0; i < n; i++) if (next() < p) c++;
      return c;
    };
    return next;
  };

  CN.randomSeed = () => Math.floor(Math.random() * 99999) + 1;

  /* ------------------------------------------------------------------
     2. Number formatting
     ------------------------------------------------------------------ */
  CN.fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
  CN.pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : '-');
  CN.clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  /* Everything below touches the DOM, so skip it when running under node tests. */
  if (typeof document === 'undefined') return;

  /* ------------------------------------------------------------------
     3. Tiny DOM helper:  h('div', {class:'x', onclick: fn}, child, child)
     ------------------------------------------------------------------ */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_TAGS = new Set(['svg', 'g', 'line', 'path', 'rect', 'circle', 'text', 'polygon', 'polyline', 'defs', 'clipPath', 'marker', 'title', 'tspan']);

  function appendChildren(node, kids) {
    for (const k of kids) {
      if (k === null || k === undefined || k === false) continue;
      if (Array.isArray(k)) appendChildren(node, k);
      else node.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }

  CN.h = function (tag, props, ...kids) {
    const isSvg = SVG_TAGS.has(tag);
    const node = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    if (props) {
      for (const key of Object.keys(props)) {
        const val = props[key];
        if (val === null || val === undefined || val === false) continue;
        if (key === 'class') node.setAttribute('class', val);
        else if (key === 'html') node.innerHTML = val;
        else if (key === 'text') node.textContent = val;
        else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2), val);
        else node.setAttribute(key, val === true ? '' : val);
      }
    }
    appendChildren(node, kids);
    return node;
  };
  const h = CN.h;

  CN.clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

  /* ------------------------------------------------------------------
     4. Small form widgets. Each returns { el, get(), set() } so the tab
        code can read the value without digging through the DOM.
     ------------------------------------------------------------------ */
  CN.slider = function (o) {
    const out = h('output', null);
    const input = h('input', { type: 'range', min: o.min, max: o.max, step: o.step || 1, value: o.value, 'aria-label': o.label });
    const fmt = o.format || ((v) => String(v));
    const update = () => {
      out.textContent = fmt(Number(input.value));
      const lo = Number(input.min); const hi = Number(input.max);
      input.style.setProperty('--pct', (hi > lo ? ((Number(input.value) - lo) / (hi - lo)) * 100 : 0) + '%');
    };
    input.addEventListener('input', () => { update(); if (o.onInput) o.onInput(Number(input.value)); });
    update();
    const el = h('label', { class: 'field' },
      h('span', { class: 'field-top' }, h('span', { class: 'field-label' }, o.label), out),
      input,
      o.hint ? h('span', { class: 'field-hint' }, o.hint) : null);
    return {
      el, input,
      get: () => Number(input.value),
      set: (v) => { input.value = v; update(); },
      setDisabled: (d) => { input.disabled = d; el.classList.toggle('disabled', d); },
      setRange: (min, max) => { input.min = min; input.max = max; },
    };
  };

  CN.select = function (o) {
    const sel = h('select', { 'aria-label': o.label },
      o.options.map((op) => h('option', { value: op.value }, op.label)));
    sel.value = o.value !== undefined ? o.value : o.options[0].value;
    sel.addEventListener('change', () => { if (o.onChange) o.onChange(sel.value); });
    const el = h('label', { class: 'field' },
      h('span', { class: 'field-label' }, o.label), sel,
      o.hint ? h('span', { class: 'field-hint' }, o.hint) : null);
    return { el, get: () => sel.value, set: (v) => { sel.value = v; }, select: sel };
  };

  CN.segmented = function (o) {
    let value = o.value !== undefined ? o.value : o.options[0].value;
    const buttons = o.options.map((op) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(op.value === value) }, op.label);
      b.addEventListener('click', () => api.set(op.value, true));
      return b;
    });
    const el = h('div', { class: 'seg', role: 'group', 'aria-label': o.label || 'options' }, buttons);
    const api = {
      el,
      get: () => value,
      set: (v, fire) => {
        value = v;
        buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(o.options[i].value === v)));
        if (fire && o.onChange) o.onChange(v);
      },
    };
    return api;
  };

  CN.textField = function (o) {
    const input = o.multiline
      ? h('textarea', { class: o.mono ? 'mono' : '', rows: o.rows || 2, placeholder: o.placeholder || '', 'aria-label': o.label })
      : h('input', { type: 'text', class: o.mono ? 'mono' : '', placeholder: o.placeholder || '', 'aria-label': o.label, autocomplete: 'off', spellcheck: 'false' });
    input.value = o.value || '';
    input.addEventListener('input', () => { if (o.onInput) o.onInput(input.value); });
    const el = h('label', { class: 'field' },
      h('span', { class: 'field-label' }, o.label), input,
      o.hint ? h('span', { class: 'field-hint' }, o.hint) : null);
    return { el, input, get: () => input.value, set: (v) => { input.value = v; }, invalid: (b) => input.setAttribute('aria-invalid', String(!!b)) };
  };

  CN.check = function (o) {
    const input = h('input', { type: 'checkbox' });
    input.checked = !!o.checked;
    input.addEventListener('change', () => { if (o.onChange) o.onChange(input.checked); });
    const el = h('label', { class: 'check' }, input, h('span', null, o.label));
    return { el, input, get: () => input.checked, set: (v) => { input.checked = v; }, setDisabled: (d) => { input.disabled = d; } };
  };

  CN.button = function (label, o) {
    o = o || {};
    const b = h('button', { type: 'button', class: 'btn' + (o.kind ? ' ' + o.kind : '') + (o.small ? ' small' : ''), title: o.title || null }, label);
    if (o.onClick) b.addEventListener('click', o.onClick);
    return b;
  };

  CN.readout = function (label, note) {
    const val = h('span', { class: 'r-value' }, '-');
    const noteEl = h('span', { class: 'r-note' }, note || '');
    const el = h('div', { class: 'readout' }, h('span', { class: 'r-label' }, label), val, note ? noteEl : null);
    return { el, set: (v, n) => { val.textContent = v; if (n !== undefined) noteEl.textContent = n; } };
  };

  /* Note box: kind is 'info' | 'good' | 'warn' | 'bad'. Always starts with a word/icon so colour is never alone. */
  const NOTE_ICON = { info: 'Note:', good: 'OK:', warn: 'Careful:', bad: 'Problem:' };
  CN.note = function (kind, content) {
    const box = h('div', { class: 'note' + (kind && kind !== 'info' ? ' ' + kind : ''), role: 'status' });
    CN.setNote(box, kind, content);
    return box;
  };
  CN.setNote = function (box, kind, content) {
    box.className = 'note' + (kind && kind !== 'info' ? ' ' + kind : '');
    CN.clear(box);
    box.appendChild(h('b', null, NOTE_ICON[kind || 'info']));
    box.appendChild(document.createTextNode(' '));
    if (content instanceof Node) box.appendChild(content);
    else box.appendChild(document.createTextNode(String(content)));
  };

  CN.section = function (title, hint, ...kids) {
    return h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, title), hint ? h('span', { class: 'hint' }, hint) : null),
      kids);
  };

  CN.panel = function (title, sub, ...kids) {
    return h('div', { class: 'panel' }, title ? h('h3', null, title) : null, sub ? h('div', { class: 'sub' }, sub) : null, kids);
  };

  CN.theory = function (title, htmlBody) {
    return h('details', { class: 'theory' }, h('summary', null, title), h('div', { class: 'body', html: htmlBody }));
  };

  /* Standard header for each page. units = [{unit, name}], topics = syllabus topic strings. */
  CN.pageHead = function (o) {
    const u = (o.units || []).map((x) => 'Unit ' + x.unit + ', ' + x.name).join('; ');
    const t = o.topics && o.topics.length ? ' Covers ' + o.topics.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.' : '';
    return h('header', { class: 'page-head' },
      h('h1', null, o.title),
      h('p', { class: 'lead' }, o.lead),
      u ? h('p', { class: 'syl' }, h('b', null, 'Syllabus: '), u + '.' + t) : null);
  };

  /* ------------------------------------------------------------------
     5. Animation helper that stops when the tab is closed
     ------------------------------------------------------------------ */
  CN.makeLoop = function (tick) {
    let raf = 0;
    let last = 0;
    let running = false;
    function frame(now) {
      if (!running) return;
      const dt = Math.min(0.1, (now - last) / 1000); // seconds, capped so a hidden tab doesn't jump
      last = now;
      tick(dt);
      raf = requestAnimationFrame(frame);
    }
    return {
      start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
      stop() { running = false; cancelAnimationFrame(raf); },
      get running() { return running; },
    };
  };

  /* ------------------------------------------------------------------
     6. Theme (light / dark)
     ------------------------------------------------------------------ */
  const themeListeners = [];
  CN.onThemeChange = (fn) => themeListeners.push(fn);
  CN.offThemeChange = (fn) => { const i = themeListeners.indexOf(fn); if (i >= 0) themeListeners.splice(i, 1); };

  CN.setTheme = function (theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('cn-theme', theme); } catch (e) { /* storage may be blocked - fine */ }
    themeListeners.slice().forEach((fn) => fn(theme));
  };
  CN.getTheme = () => document.documentElement.getAttribute('data-theme') || 'light';

  CN.cssVar = function (name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };

  /* ------------------------------------------------------------------
     7. Tab registry + router
     Each tab file calls CN.registerTab({...}). mount(host) builds the page and
     may return { destroy() } so timers and animation loops stop on leaving.
     ------------------------------------------------------------------ */
  CN.tabs = [];
  CN.registerTab = (def) => { CN.tabs.push(def); };

  let current = null;

  function buildRail() {
    const rail = document.getElementById('rail');
    CN.clear(rail);
    const mark = h('svg', { class: 'brand-mark', viewBox: '0 0 30 30', 'aria-hidden': 'true' },
      h('rect', { x: 3, y: 4, width: 24, height: 5, rx: 2, fill: '#6da7ec' }),
      h('rect', { x: 3, y: 12.5, width: 24, height: 5, rx: 2, fill: '#ffffff', opacity: 0.85 }),
      h('rect', { x: 3, y: 21, width: 24, height: 5, rx: 2, fill: '#6da7ec', opacity: 0.55 }));
    rail.appendChild(h('div', { class: 'brand' }, mark,
      h('div', { class: 'brand-text' },
        h('div', { class: 'brand-name' }, 'Protocol Lab'),
        h('div', { class: 'brand-sub' }, 'Team 34 project'))));

    let groupKey = null;
    let groupEl = null;
    let linksEl = null;
    CN.tabs.forEach((t) => {
      const key = t.group ? t.group.name : '';
      if (key !== groupKey) {
        groupKey = key;
        groupEl = h('nav', { class: 'nav-group' + (t.group ? '' : ' solo'), 'aria-label': key || 'Overview' });
        linksEl = h('div', { class: 'nav-group-links' });
        if (t.group) {
          groupEl.appendChild(h('div', { class: 'nav-group-title' },
            h('b', null, 'Layer ' + t.group.layer), h('span', null, t.group.name)));
        }
        groupEl.appendChild(linksEl);
        rail.appendChild(groupEl);
      }
      linksEl.appendChild(h('a', { class: 'nav-link', href: '#' + t.id, 'data-tab': t.id }, t.title));
    });

    const themeBtn = CN.button(CN.getTheme() === 'dark' ? 'Light theme' : 'Dark theme', {
      onClick: () => CN.setTheme(CN.getTheme() === 'dark' ? 'light' : 'dark'),
    });
    CN.onThemeChange((th) => { themeBtn.textContent = th === 'dark' ? 'Light theme' : 'Dark theme'; });
    rail.appendChild(h('div', { class: 'rail-foot' }, themeBtn));
  }

  function route() {
    const id = (location.hash || '#overview').slice(1);
    const def = CN.tabs.find((t) => t.id === id) || CN.tabs[0];
    document.querySelectorAll('.nav-link').forEach((a) => {
      if (a.getAttribute('data-tab') === def.id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (current && current.destroy) {
      try { current.destroy(); } catch (e) { console.error(e); }
    }
    const main = document.getElementById('main');
    CN.clear(main);
    const page = h('div', { class: 'page' });
    main.appendChild(page);
    document.title = def.title + ' | Protocol Lab';
    current = def.mount(page) || null;
    window.scrollTo(0, 0);
  }

  CN.start = function () {
    buildRail();
    window.addEventListener('hashchange', route);
    route();
  };
})(typeof window !== 'undefined' ? window : globalThis);
