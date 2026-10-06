import { readFile } from 'node:fs/promises';

// Simple mock DOM environment
class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.id = '';
    this.innerHTML = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this.parentElement = null;
    this.scrollWidth = 100;
    this.clientWidth = 100;
    this.offsetWidth = 100;
    this.classList = {
      add: () => {},
      remove: () => {},
      contains: () => false,
      toggle: () => {}
    };
    this.style = {
      removeProperty: () => {},
      setProperty: () => {},
      fontSize: ''
    };
  }
  getContext() {
    return {
      measureText: () => ({ width: 50 }),
      font: ''
    };
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  prepend(child) { child.parentElement = this; this.children.unshift(child); }
  appendChild(child) { child.parentElement = this; this.children.push(child); }
  append(...nodes) { for (const n of nodes) { if (n instanceof MockElement) n.parentElement = this; } this.children.push(...nodes); }
  replaceChildren(...nodes) { for (const n of nodes) { if (n instanceof MockElement) n.parentElement = this; } this.children = [...nodes]; }
  closest() { return null; }
  setCustomValidity() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
  remove() {}
  querySelectorAll(sel) {
    const results = [];
    for (const c of this.children) {
      if (c instanceof MockElement) {
        if (sel === 'input, button:not(#retry-fees-btn), select' || sel === 'input, button' || sel.includes(',')) {
          results.push(c);
        } else if (sel.startsWith('#') && c.id === sel.slice(1)) {
          results.push(c);
        } else if (sel.startsWith('.') && c.className.includes(sel.slice(1))) {
          results.push(c);
        } else if (c.tagName.toLowerCase() === sel.toLowerCase()) {
          results.push(c);
        }
        results.push(...c.querySelectorAll(sel));
      }
    }
    return results;
  }
  querySelector(sel) {
    const list = this.querySelectorAll(sel);
    return list.length ? list[0] : null;
  }
}

const elementStore = new Map();
function getOrCreateMockElement(id, tag = 'div') {
  if (!elementStore.has(id)) {
    const el = new MockElement(tag);
    el.id = id;
    elementStore.set(id, el);
  }
  return elementStore.get(id);
}

// Setup global mock DOM
globalThis.window = globalThis;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {} });
globalThis.NodeFilter = { SHOW_TEXT: 4 };
globalThis.getComputedStyle = () => ({ fontSize: '20px' });
const htmlEl = new MockElement('html');
const bodyEl = new MockElement('body');
globalThis.document = {
  documentElement: htmlEl,
  body: bodyEl,
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => getOrCreateMockElement(id),
  querySelector: (sel) => {
    if (sel.startsWith('#')) return getOrCreateMockElement(sel.slice(1));
    return new MockElement(sel);
  },
  querySelectorAll: (sel) => [],
  createTreeWalker: () => ({ nextNode: () => null }),
  addEventListener: () => {},
  removeEventListener: () => {}
};

globalThis.localStorage = {
  _data: new Map(),
  getItem: (k) => globalThis.localStorage._data.get(k) || null,
  setItem: (k, v) => globalThis.localStorage._data.set(k, String(v)),
  removeItem: (k) => globalThis.localStorage._data.delete(k),
  clear: () => globalThis.localStorage._data.clear()
};

async function testBrowserSim() {
  console.log('Testing App.js Browser Simulation with Live Worker API...');
  
  // Set up required elements
  const heroWrap = getOrCreateMockElement('hero-title-wrap', 'div');
  const hero = getOrCreateMockElement('hero-title', 'h1');
  heroWrap.appendChild(hero);
  getOrCreateMockElement('calculator', 'section');
  getOrCreateMockElement('sale-form', 'form');
  getOrCreateMockElement('country', 'select');
  getOrCreateMockElement('item-price', 'input');
  getOrCreateMockElement('shipping', 'input');
  getOrCreateMockElement('net-profit', 'span');
  getOrCreateMockElement('total-fees', 'span');

  const appMod = await import('../src/app.js');
  
  console.log('Invoking loadFeeData() directly...');
  const success = await appMod.loadFeeData();
  console.log('loadFeeData completed. Success:', success);

  const state = appMod.getFeeDataState();
  console.log('State isLoaded:', state.isLoaded);
  console.log('State scheduleCount:', state.scheduleCount);
  console.log('State activeCountryCode:', state.activeCountryCode);
  console.log('State countryOrder count:', state.activeCountryOrder.length);
  if (state.error) {
    console.error('State error:', state.error);
  }

  if (!success || state.scheduleCount !== 62 || !state.isLoaded) {
    console.error('FAIL: Browser simulation did not load all 62 countries!');
    process.exit(1);
  }

  console.log('Browser simulation passed with 62 markets populated dynamically!');
}

testBrowserSim().catch(err => {
  console.error('Simulation error:', err);
  process.exit(1);
});
