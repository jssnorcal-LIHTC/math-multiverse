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
      // Task 4 needs the two-argument form (`toggle('active', i === viewIdx)`): `force`
      // decides membership directly rather than flipping current state, so repeated calls
      // with the same force are idempotent, matching the real DOM's classList.toggle.
      toggle(c, force) {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
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
    // Splices `c` out of `children` and clears its parent link, mirroring real DOM removal
    // closely enough that `if (node.parentNode)` guards keep meaning what they say after a
    // remove: a removed node's parentNode must go back to null, not linger stale.
    removeChild(c) {
      const i = node.children.indexOf(c);
      if (i !== -1) { node.children.splice(i, 1); c._parent = null; }
      return c;
    },
    // A real parent link, because returning null unconditionally does not just lose information: it
    // silently SKIPS any `if (node.parentNode)` branch, so the suite cannot see that code at all. That
    // is how shorttext.reveal's duplicate-append defect stayed invisible to a probe written to catch it.
    get parentNode() { return node._parent || null; },
    // engine/figures.js's attachReveal inserts the reveal strip between an existing prog/hearts
    // pair: `barEl.insertBefore(strip, barEl.children[1] || null)`. Splices at refNode's index
    // when refNode is a real child of this node; appends for a null/absent refNode (the common
    // case here) AND for a refNode that is not actually this node's child, rather than letting
    // `indexOf` return -1 flow into `splice(-1, 0, ...)`, which would silently insert before the
    // LAST child instead of at the end -- the exact class of corruption removeChild's own fix
    // above exists to prevent, just on the insert side instead of the remove side.
    //
    // Fix round 1: also detaches `newNode` from any PREVIOUS parent first. The real DOM moves a
    // node that already has a parent rather than duplicating it; the first version of this stub
    // method skipped that step, so a node already appended somewhere else would end up listed in
    // TWO children arrays at once (the old parent's and this one's) while `_parent` pointed at
    // only the new one -- the same "state lies about itself" shape removeChild's own fix exists
    // to prevent, just reachable from the insert side instead of the remove side.
    insertBefore(newNode, refNode) {
      if (newNode && newNode._parent && newNode._parent !== node) {
        const oldParent = newNode._parent;
        const oi = oldParent.children.indexOf(newNode);
        if (oi !== -1) oldParent.children.splice(oi, 1);
      }
      const i = refNode ? node.children.indexOf(refNode) : -1;
      if (i === -1) node.children.push(newNode);
      else node.children.splice(i, 0, newNode);
      if (newNode) newNode._parent = node;
      return newNode;
    },
    // engine/figures.js's renderItemFigure (Task 7) reads `itemBox.firstChild` to insert a figure
    // before the stem rather than after it; without this, `insertBefore(wrap, undefined)` would
    // silently degrade to an append, changing where the figure renders with no test noticing.
    get firstChild() { return node.children[0] || null; },
  };
  return node;
}

// Installs the stub on the global object and returns the element factory. Idempotent.
function installDomStub() {
  // One body per install, not per makeEl call, so a test can read document.body.children and
  // see everything appended across the whole run rather than a fresh empty node each time.
  const body = makeEl('body');
  global.document = {
    createElement: makeEl,
    createTextNode: () => makeEl('#text'),
    body,
  };
  return { makeEl };
}

module.exports = { installDomStub, makeEl };
