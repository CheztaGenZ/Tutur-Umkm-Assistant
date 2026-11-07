import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '../config.js';

const storage = new AsyncLocalStorage();

export function currentAiConfig() {
  return storage.getStore()?.ai || config.ai;
}

export function withAiConfig(ai, fn) {
  if (!ai) return fn();
  return storage.run({ ai }, fn);
}
