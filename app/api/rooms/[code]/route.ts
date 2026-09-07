import { NextResponse } from 'next/server';
import { clearPresence, mutateRoom, readPresence, readRoom, touchPresence } from '@/lib/db';
import {
  act,
  appendActionLog,
  applyTurnTimeout,
  configureTable,
  leaveRoom,
  needsHostTransfer,
  needsRoomMaintenance,
  publicState,
  setPlayerParticipation,
  startHand,
  transferHostIfNeeded,
  upgradeRoomState,
} from '@/lib/poker';
import type { ActionKind, TableSettings } from '@/lib/types';

type Context = { params: Promise<{ code: string }> };

function getToken(request: Request) {
  return request.headers.get('x-player-token') ?? new URL(request.url).searchParams.get('token') ?? '';
}

export async function GET(request: Request, context: Context) {
  try {
    const { code: rawCode } = await context.params;
    const code = rawCode.toUpperCase();
    let room = await readRoom(code);
    if (!room) return NextResponse.json({ error: '牌桌不存在' }, { status: 404 });
    const token = getToken(request);
    if (!room.state.players.some((player) => player.token === token)) throw new Error('无效的玩家凭证');
    const now = Date.now();
    const currentPlayer = room.state.players.find((player) => player.token === token)!;
    await touchPresence(code, currentPlayer.id, now);
    const presence = await readPresence(code);
    if (needsRoomMaintenance(room.state, now) || needsHostTransfer(room.state, presence, now)) {
      const maintained = await mutateRoom(code, (state) => {
        upgradeRoomState(state, now);
        transferHostIfNeeded(state, presence, now);
        applyTurnTimeout(state, now);
        return { state, result: null };
      });
      if (maintained) room = maintained;
    }
    const player = room.state.players.find((candidate) => candidate.token === token);
    if (!player) throw new Error('玩家凭证已失效');
    return NextResponse.json({ room: publicState(room.state, room.version, token, presence, now) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '请求失败' }, { status: 401 });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { code: rawCode } = await context.params;
    const code = rawCode.toUpperCase();
    const token = getToken(request);
    const now = Date.now();
    const body = await request.json() as {
      action?: ActionKind | 'start' | 'leave' | 'rebuy' | 'configure' | 'sitout' | 'return';
      amount?: number;
      settings?: Partial<TableSettings>;
    };
    const presence = await readPresence(code);
    let playerId = '';
    const changed = await mutateRoom(code, (state) => {
      upgradeRoomState(state, now);
      applyTurnTimeout(state, now);
      const player = state.players.find((candidate) => candidate.token === token);
      if (!player) throw new Error('玩家凭证已失效');
      playerId = player.id;
      presence[player.id] = now;
      transferHostIfNeeded(state, presence, now);
      if (body.action === 'start') {
        if (player.id !== state.hostId) throw new Error('只有房主可以开局');
        startHand(state, now);
      } else if (body.action === 'leave') {
        leaveRoom(state, player);
      } else if (body.action === 'rebuy') {
        if (state.phase !== 'lobby' && state.phase !== 'showdown') throw new Error('请在本手结束后补充筹码');
        if (player.stack > 0) throw new Error('筹码归零后才能重新买入');
        player.stack = state.buyIn ?? 1_000;
        player.allIn = false;
        state.message = `${player.name} 已补充 ${player.stack.toLocaleString()} 筹码`;
        appendActionLog(state, state.message, now);
      } else if (body.action === 'configure') {
        configureTable(state, player, body.settings ?? {}, now);
      } else if (body.action === 'sitout') {
        setPlayerParticipation(state, player, true, now);
      } else if (body.action === 'return') {
        setPlayerParticipation(state, player, false, now);
      } else if (body.action) {
        act(state, player, body.action, body.amount);
      } else {
        throw new Error('未知操作');
      }
      return { state, result: null };
    });
    if (!changed) return NextResponse.json({ error: '牌桌不存在' }, { status: 404 });
    if (body.action === 'leave') {
      await clearPresence(code, playerId);
      return NextResponse.json({ ok: true });
    }
    await touchPresence(code, playerId, now);
    const refreshedPresence = await readPresence(code);
    return NextResponse.json({ room: publicState(changed.state, changed.version, token, refreshedPresence, now) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求失败';
    return NextResponse.json({ error: message }, { status: message.includes('正忙') ? 409 : 400 });
  }
}
