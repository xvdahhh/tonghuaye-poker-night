import { NextResponse } from 'next/server';
import { mutateRoom, readRoom } from '@/lib/db';
import { act, publicState, startHand } from '@/lib/poker';
import type { ActionKind } from '@/lib/types';

type Context = { params: Promise<{ code: string }> };

function getToken(request: Request) {
  return request.headers.get('x-player-token') ?? new URL(request.url).searchParams.get('token') ?? '';
}

export async function GET(request: Request, context: Context) {
  try {
    const { code: rawCode } = await context.params;
    const code = rawCode.toUpperCase();
    const room = await readRoom(code);
    if (!room) return NextResponse.json({ error: '牌桌不存在' }, { status: 404 });
    return NextResponse.json({ room: publicState(room.state, room.version, getToken(request)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '请求失败' }, { status: 401 });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { code: rawCode } = await context.params;
    const code = rawCode.toUpperCase();
    const token = getToken(request);
    const body = await request.json() as { action?: ActionKind | 'start' | 'leave' | 'rebuy'; amount?: number };
    const changed = await mutateRoom(code, (state) => {
      const player = state.players.find((candidate) => candidate.token === token);
      if (!player) throw new Error('玩家凭证已失效');
      if (body.action === 'start') {
        if (player.id !== state.hostId) throw new Error('只有房主可以开局');
        startHand(state);
      } else if (body.action === 'leave') {
        if (state.phase !== 'lobby') throw new Error('牌局中不能离开座位');
        state.players = state.players.filter((candidate) => candidate.id !== player.id);
        if (state.hostId === player.id) state.hostId = state.players[0]?.id ?? '';
        state.message = `${player.name} 离开了牌桌`;
      } else if (body.action === 'rebuy') {
        if (state.phase !== 'lobby' && state.phase !== 'showdown') throw new Error('请在本手结束后补充筹码');
        if (player.stack > 0) throw new Error('筹码归零后才能重新买入');
        player.stack = 1000;
        player.allIn = false;
        state.message = `${player.name} 已补充 1,000 筹码`;
      } else if (body.action) {
        act(state, player, body.action, body.amount);
      } else {
        throw new Error('未知操作');
      }
      return { state, result: null };
    });
    if (!changed) return NextResponse.json({ error: '牌桌不存在' }, { status: 404 });
    if (body.action === 'leave') return NextResponse.json({ ok: true });
    return NextResponse.json({ room: publicState(changed.state, changed.version, token) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求失败';
    return NextResponse.json({ error: message }, { status: message.includes('正忙') ? 409 : 400 });
  }
}

