import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db.js';
import {
  hashPassword,
  verifyPassword,
  createUser,
  findUserByEmail,
  createSession,
  getSessionUser,
  deleteSession,
} from '../src/auth.js';

const dir = path.resolve('data-authtest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);

const hash = hashPassword('rahasia123');
assert.match(hash, /^scrypt\$/);
assert.equal(verifyPassword('rahasia123', hash), true);
assert.equal(verifyPassword('salah', hash), false);
assert.equal(verifyPassword('rahasia123', 'bukan-hash'), false);

const user = createUser(db, {
  email: 'Sari@Example.com',
  name: 'Sari',
  password: 'rahasia123',
});
assert.ok(user.id);
assert.equal(user.email, 'sari@example.com');
assert.equal(user.password_hash, undefined);

assert.throws(() => createUser(db, { email: 'sari@example.com', name: 'Lain', password: 'x1234567' }));

const found = findUserByEmail(db, 'SARI@example.com');
assert.equal(found.id, user.id);

const token = createSession(db, user.id, 60_000);
assert.ok(token.length >= 32);
assert.equal(getSessionUser(db, token).id, user.id);
assert.equal(getSessionUser(db, 'token-palsu'), null);

deleteSession(db, token);
assert.equal(getSessionUser(db, token), null);

const expired = createSession(db, user.id, -1);
assert.equal(getSessionUser(db, expired), null);

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('auth ok');
