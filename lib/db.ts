import { env } from 'cloudflare:workers';
import type { RoomState } from './types';

type RoomRow = {
  state_json: string;
  version: number;
};

let schemaReady = false;

export async function ensureSchema() {
  if (schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY NOT NULL,
      state_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  schemaReady = true;
}

export async function insertRoom(state: RoomState) {
  await ensureSchema();
  const now = Date.now();
  return env.DB.prepare(
    'INSERT INTO rooms (code, state_json, version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
  ).bind(state.code, JSON.stringify(state), now, now).run();
}

export async function readRoom(code: string) {
  await ensureSchema();
  const row = await env.DB.prepare(
    'SELECT state_json, version FROM rooms WHERE code = ?',
  ).bind(code).first<RoomRow>();
  if (!row) return null;
  return { state: JSON.parse(row.state_json) as RoomState, version: row.version };
}

export async function mutateRoom<T>(
  code: string,
  transform: (state: RoomState) => { state: RoomState; result: T },
) {
  await ensureSchema();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readRoom(code);
    if (!current) return null;
    const changed = transform(current.state);
    const updated = await env.DB.prepare(
      'UPDATE rooms SET state_json = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?',
    ).bind(JSON.stringify(changed.state), Date.now(), code, current.version).run();
    if ((updated.meta.changes ?? 0) === 1) {
      return { state: changed.state, version: current.version + 1, result: changed.result };
    }
  }
  throw new Error('牌桌正忙，请重试');
}


