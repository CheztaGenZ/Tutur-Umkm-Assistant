import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, listKnowledge } from '../src/db.js';
import { createProduct, listProducts, updateProduct, deleteProduct } from '../src/products.js';

const dir = path.resolve('data-productstest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);

const item = createProduct(db, {
  ownerId: 'user-1',
  name: 'Nasi campur vegan',
  price: 35000,
  description: 'Tersedia setiap hari, bisa tidak pedas.',
  category: 'Makanan',
  available: true,
});
assert.ok(item.id);
assert.equal(item.price, 35000);
assert.equal(listProducts(db, 'user-1').length, 1);
assert.equal(listProducts(db, 'user-2').length, 0);

const kb = listKnowledge(db, { ownerId: 'user-1' });
assert.equal(kb.length, 1);
assert.match(kb[0].body, /35\.000/);
assert.match(kb[0].title, /Nasi campur vegan/);

updateProduct(db, item.id, 'user-1', {
  name: 'Nasi campur vegan',
  price: 38000,
  description: 'Tersedia setiap hari.',
  category: 'Makanan',
  available: false,
});
const after = listProducts(db, 'user-1')[0];
assert.equal(after.price, 38000);
assert.equal(after.available, 0);
const kb2 = listKnowledge(db, { ownerId: 'user-1' });
assert.match(kb2[0].body, /38\.000/);
assert.match(kb2[0].body, /tidak tersedia/i);

// Produk user lain tidak boleh mengubah knowledge user ini.
assert.throws(() => updateProduct(db, item.id, 'user-2', { name: 'x', price: 1 }));

assert.equal(deleteProduct(db, item.id, 'user-2'), false);
assert.equal(deleteProduct(db, item.id, 'user-1'), true);
assert.equal(listKnowledge(db, { ownerId: 'user-1' }).length, 0);

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('products ok');
