import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

async function JavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return JavaScriptFiles(target);
    return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
  }));
  return nested.flat();
}

test('user-facing Cyrillic strings live only in the i18n dictionary', async () => {
  const root = path.resolve(import.meta.dirname, '../plugin');
  const files = (await JavaScriptFiles(root)).filter(file => !file.endsWith(`${path.sep}i18n.js`));
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (/[А-Яа-яЁё]/u.test(source)) violations.push(path.relative(root, file));
  }
  assert.deepEqual(violations, []);
});
