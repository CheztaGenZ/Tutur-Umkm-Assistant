import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('data-productimgtest');
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;

const { openDb } = await import('../src/db.js');
const { createProduct, updateProduct, deleteProduct } = await import('../src/products.js');

const db = openDb(dir);
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X0WQAAAAASUVORK5CYII=';

const item = createProduct(db, { ownerId: 'u1', name: 'Kopi', price: 10000, image: png });
assert.match(item.image_url, /^\/uploads\/products\/.+\.png$/);
const file = path.join(dir, 'uploads', 'products', path.basename(item.image_url));
assert.equal(fs.existsSync(file), true);

const updated = updateProduct(db, item.id, 'u1', { removeImage: true });
assert.equal(updated.image_url, null);
assert.equal(fs.existsSync(file), false);

const second = createProduct(db, { ownerId: 'u1', name: 'Teh', price: 8000, image: png });
const secondFile = path.join(dir, 'uploads', 'products', path.basename(second.image_url));
deleteProduct(db, second.id, 'u1');
assert.equal(fs.existsSync(secondFile), false);

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('product image ok');
