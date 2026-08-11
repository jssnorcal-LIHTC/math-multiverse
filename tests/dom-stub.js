'use strict';
// A DOM stub with only the surface engine/items.js and engine/runner.js actually touch. It exists so the
// interaction layer can be tested in the sub-second unit gate instead of only in a browser smoke run.
//
// Deliberately minimal. It asserts nothing about browser semantics -- no layout, no event bubbling, no
// real CSS. What it CAN prove is whether our own handlers run or return early, and which classes our own
// code puts on which node. Both Task 9 defects lived exactly there: a guard reading the wrong element, and
// reveal painting the wrong class. Anything that depends on real browser behaviour belongs in smoke.js.

function makeEl(tag) {
  const classes = new Set();
  // A real attrs store, plain map only, nothing mirrored onto properties. engine/figures.js sets
  // alt/loading/src via setAttribute and a test reads them back via getAttribute.
  const attrs = Object.create(null);
  const node = {
    tagName: tag,
    children: [],
    // A real style object carries the CSSOM methods, not just properties. engine/runner.js sets the
    // per-pack accent with style.setProperty('--mv-color', ...), so a bare {} throws there.
    style: (function () {
      const props = Object.create(null);
      return {
        setProperty(k, v) { props[k] = String(v); },
        getPropertyValue(k) { return props[k] === undefined ? '' : props[k]; },
        removeProperty(k) { const v = props[k]; delete props[k]; return v === undefined ? '' : v; },
        _props: props,
      };
    })(),
    dataset: {},
    disabled: false,
    _text: '',
    type: '',
    value: '',
    placeholder: '',
    autocomplete: '',
    get className() { return [...classes].join(' '); },
    set className(v) {
      classes.clear();
      String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
    },
    get textContent() { return node._text; },
    set textContent(v) { node._text = String(v); },
    // items.js clears a container with innerHTML = ''; nothing reads it back.
    get innerHTML() { return ''; },
    set innerHTML(v) { if (v === '') node.children.length = 0; },
    appendChild(c) { node.children.push(c); if (c) c._parent = node; return c; },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    addEventListener(t, f) { node['on' + t] = f; },
    scrollIntoView() {},
    // Single-class selectors only, which is all items.js uses. Depth-first, document order.
    querySelectorAll(sel) {
      const want = String(sel).replace(/^\./, '');
      const out = [];
      (function walk(n) {
        for (const c of n.children) {
          if (c.classList && c.classList.contains(want)) out.push(c);
          walk(c);
        }
      })(node);
      return out;
    },
    // A real parent link, because returning null unconditionally does not just lose information: it
    // silently SKIPS any `if (node.parentNode)` branch, so the suite cannot see that code at all. That
    // is how shorttext.reveal's duplicate-append defect stayed invisible to a probe written to catch it.
    get parentNode() { return node._parent || null; },
  };
  return node;
}

// Installs the stub on the global object and returns the element factory. Idempotent.
function installDomStub() {
  global.document = {
    createElement: makeEl,
    createTextNode: () => makeEl('#text'),
  };
  return { makeEl };
}

module.exports = { installDomStub, makeEl };
