/**
 * Katalog produk per akun. Setiap perubahan disinkronkan ke knowledge base
 * supaya jawaban AI memakai harga dan ketersediaan yang sama.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { upsertKnowledge, deleteKnowledge, getKnowledge } from './db.js';

const now = () => Date.now();
const formatPrice = (value) => new Intl.NumberFormat('id-ID').format(Number(value) || 0);

const uploadDir = () => path.join(path.resolve(config.dataDir), 'uploads', 'products');

function saveImage(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('Format foto harus JPG, PNG, atau WebP');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 2.5 * 1024 * 1024) throw new Error('Foto terlalu besar, maksimal 2,5 MB');
  fs.mkdirSync(uploadDir(), { recursive: true });
  const ext = match[1].toLowerCase() === 'jpeg' || match[1].toLowerCase() === 'jpg' ? 'jpg' : match[1].toLowerCase();
  const file = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(uploadDir(), file), buffer);
  return `/uploads/products/${file}`;
}

function removeImage(imagePath) {
  if (!imagePath || !String(imagePath).startsWith('/uploads/products/')) return;
  const file = path.basename(String(imagePath));
  try {
    fs.unlinkSync(path.join(uploadDir(), file));
  } catch {
    /* file sudah tidak ada */
  }
}

const mapProduct = (row) =>
  row
    ? {
        id: row.id,
        owner_id: row.owner_id,
        name: row.name,
        price: row.price,
        description: row.description,
        category: row.category,
        image_url: row.image_path || null,
        available: row.available === 1 || row.available === true ? 1 : 0,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }
    : null;

function syncKnowledge(db, product) {
  const status = product.available ? 'Tersedia.' : 'Sedang tidak tersedia.';
  const body = `Harga Rp${formatPrice(product.price)}. ${product.description || ''} ${status}`.trim();
  upsertKnowledge(db, {
    id: `produk-${product.id}`,
    ownerId: product.owner_id,
    category: 'menu',
    title: product.name,
    body,
    keywords: [product.name, product.category, 'harga', 'menu', 'produk'].join(', '),
    active: product.available ? 1 : 0,
  });
}

export function listProducts(db, ownerId) {
  return db
    .prepare('SELECT * FROM products WHERE owner_id = ? ORDER BY category, name')
    .all(String(ownerId))
    .map(mapProduct);
}

export function getProduct(db, id, ownerId) {
  return mapProduct(
    db.prepare('SELECT * FROM products WHERE id = ? AND owner_id = ?').get(String(id), String(ownerId)),
  );
}

export function createProduct(db, { ownerId, name, price = 0, description = '', category = 'Menu', available = true, image = null }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Nama produk wajib diisi');
  const id = `pr_${crypto.randomUUID().slice(0, 8)}`;
  const ts = now();
  const imagePath = image ? saveImage(image) : null;
  db.prepare(
    `INSERT INTO products (id, owner_id, name, price, description, category, image_path, available, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    String(ownerId),
    cleanName,
    Math.max(0, Math.round(Number(price) || 0)),
    String(description || '').trim(),
    String(category || 'Menu').trim() || 'Menu',
    imagePath,
    available ? 1 : 0,
    ts,
    ts,
  );
  const product = getProduct(db, id, ownerId);
  syncKnowledge(db, product);
  return product;
}

export function updateProduct(db, id, ownerId, patch = {}) {
  const current = getProduct(db, id, ownerId);
  if (!current) throw new Error('Produk tidak ditemukan untuk akun ini');
  const next = {
    name: patch.name !== undefined ? String(patch.name).trim() : current.name,
    price: patch.price !== undefined ? Math.max(0, Math.round(Number(patch.price) || 0)) : current.price,
    description: patch.description !== undefined ? String(patch.description).trim() : current.description,
    category: patch.category !== undefined ? String(patch.category).trim() || 'Menu' : current.category,
    available: patch.available !== undefined ? (patch.available ? 1 : 0) : current.available,
  };
  if (!next.name) throw new Error('Nama produk wajib diisi');

  let imagePath = current.image_url;
  if (patch.removeImage === true && imagePath) {
    removeImage(imagePath);
    imagePath = null;
  }
  if (patch.image) {
    const nextImage = saveImage(patch.image);
    if (imagePath) removeImage(imagePath);
    imagePath = nextImage;
  }

  db.prepare(
    `UPDATE products SET name = ?, price = ?, description = ?, category = ?, image_path = ?, available = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
  ).run(
    next.name,
    next.price,
    next.description,
    next.category,
    imagePath,
    next.available,
    now(),
    String(id),
    String(ownerId),
  );
  const product = getProduct(db, id, ownerId);
  syncKnowledge(db, product);
  return product;
}

export function deleteProduct(db, id, ownerId) {
  const current = getProduct(db, id, ownerId);
  if (!current) return false;
  const result = db
    .prepare('DELETE FROM products WHERE id = ? AND owner_id = ?')
    .run(String(id), String(ownerId));
  if (!result.changes) return false;
  removeImage(current.image_url);
  const kb = getKnowledge(db, `produk-${id}`);
  if (kb) deleteKnowledge(db, `produk-${id}`);
  return true;
}
