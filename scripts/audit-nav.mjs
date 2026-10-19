import fs from 'node:fs';
import path from 'node:path';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== '.gemini') {
        results = results.concat(walk(fullPath));
      }
    } else if (file.endsWith('.html')) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = walk('.');
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const dMatch = content.match(/<nav class="desktop-nav"[^>]*>([\s\S]*?)<\/nav>/);
  const mMatch = content.match(/<nav class="mobile-menu"[^>]*>([\s\S]*?)<\/nav>/);
  console.log('FILE: ' + f);
  if (dMatch) {
    const links = [...dMatch[1].matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => m[2].replace(/<[^>]+>/g, '').trim() + ' (' + m[1] + ')');
    console.log('  DESKTOP: ' + links.join(' | '));
  } else {
    console.log('  DESKTOP: NONE');
  }
  if (mMatch) {
    const mlinks = [...mMatch[1].matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => m[2].replace(/<[^>]+>/g, '').trim() + ' (' + m[1] + ')');
    console.log('  MOBILE:  ' + mlinks.join(' | '));
  } else {
    console.log('  MOBILE:  NONE');
  }
}
