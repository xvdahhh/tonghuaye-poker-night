import { env } from 'cloudflare:workers';
import type { RoomState } from './types';

type RoomRow = {
  state_json: string;
  version: number;
};

export async function insertRoom(state: RoomState) {
  const now = Date.now();
  return env.DB.prepare(
    'INSERT INTO rooms (code, state_json, version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
  ).bind(state.code, JSON.stringify(state), now, now).run();
}

export async function readRoom(code: string) {
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

export async function touchPresence(code: string, playerId: string, now = Date.now()) {
  await env.DB.prepare(`
    INSERT INTO room_presence (room_code, player_id, last_seen_at)
    VALUES (?, ?, ?)
    ON CONFLICT (room_code, player_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `).bind(code, playerId, now).run();
}

export async function readPresence(code: string) {
  const result = await env.DB.prepare(
    'SELECT player_id, last_seen_at FROM room_presence WHERE room_code = ?',
  ).bind(code).all<{ player_id: string; last_seen_at: number }>();
  return Object.fromEntries((result.results ?? []).map((row) => [row.player_id, row.last_seen_at]));
}

export async function clearPresence(code: string, playerId: string) {
  await env.DB.prepare(
    'DELETE FROM room_presence WHERE room_code = ? AND player_id = ?',
  ).bind(code, playerId).run();
}
