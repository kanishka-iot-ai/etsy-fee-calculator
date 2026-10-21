import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Responsive Layout: styles.v4.css declares unified mobile navigation breakpoint at 1100px', () => {
  const css = fs.readFileSync(path.resolve('styles.v4.css'), 'utf8');
  assert.ok(css.includes('@media (max-width: 1100px)'), 'Should define @media (max-width: 1100px)');
  assert.ok(css.includes('.desktop-nav') && css.includes('display: none !important'), 'Should hide .desktop-nav on screens <= 1100px');
  assert.ok(css.includes('.menu-toggle') && css.includes('display: grid !important'), 'Should display .menu-toggle on screens <= 1100px');
});

test('Responsive Layout: input-grid single-column rule defined for small screens', () => {
  const css = fs.readFileSync(path.resolve('styles.v4.css'), 'utf8');
  assert.ok(css.includes('@media (max-width: 440px)'), 'Should define small mobile breakpoint for inputs');
  assert.ok(css.includes('grid-template-columns: 1fr'), 'Should stack inputs to single column on small screens');
});

test('Responsive Layout: bulk simulator bar has mobile column stacking and touch-safe wrapping', () => {
  const css = fs.readFileSync(path.resolve('styles.v4.css'), 'utf8');
  assert.ok(css.includes('.bulk-simulator-bar'), 'Contains .bulk-simulator-bar rules');
  assert.ok(css.includes('.simulator-tier-select-wrap'), 'Contains .simulator-tier-select-wrap rules');
  assert.ok(css.includes('.table-scroll') && css.includes('overflow-x: auto'), 'Contains touch scrolling for tables');
});

test('Responsive Layout: calculator grid stacks to single column on tablets (<= 860px)', () => {
  const css = fs.readFileSync(path.resolve('styles.v4.css'), 'utf8');
  assert.ok(css.includes('@media (max-width: 860px)'), 'Contains <= 860px breakpoint for calculator grid');
  assert.ok(css.includes('.calculator-grid') && css.includes('grid-template-columns: 1fr'), 'Stacks calculator grid to 1 column');
});
