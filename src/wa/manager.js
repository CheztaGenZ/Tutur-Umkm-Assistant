import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { WhatsAppClient } from './client.js';

const FORWARDED = ['state', 'message', 'contacts', 'history', 'presence', 'error'];

export class WhatsAppManager extends EventEmitter {
  constructor({ dataDir }) {
    super();
    this.dataDir = path.resolve(dataDir);
    this.clients = new Map();
  }

  ownerId(value) {
    return String(value || 'demo');
  }

  client(ownerId) {
    const id = this.ownerId(ownerId);
    let client = this.clients.get(id);
    if (client) return client;
    client = new WhatsAppClient({ dataDir: this.dataDir, ownerId: id });
    for (const event of FORWARDED) {
      client.on(event, (payload) => this.emit(event, { ownerId: id, payload }));
    }
    this.clients.set(id, client);
    return client;
  }

  snapshot(ownerId) {
    return this.client(ownerId).snapshot();
  }

  async start(ownerId) {
    return this.client(ownerId).start();
  }

  async stop(ownerId) {
    return this.client(ownerId).stop();
  }

  async restartFresh(ownerId) {
    return this.client(ownerId).restartFresh();
  }

  savedOwners() {
    const root = path.join(this.dataDir, 'wa');
    try {
      return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => fs.existsSync(path.join(root, name, 'auth', 'creds.json')));
    } catch {
      return [];
    }
  }

  async startAll() {
    for (const ownerId of this.savedOwners()) {
      this.start(ownerId).catch((err) => {
        this.emit('error', { ownerId, payload: err });
      });
    }
  }

  async stopAll() {
    await Promise.all([...this.clients.values()].map((client) => client.stop().catch(() => {})));
  }
}
