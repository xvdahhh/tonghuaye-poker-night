import { NextResponse } from 'next/server';
import { insertRoom, mutateRoom, readPresence, touchPresence } from '@/lib/db';
import { joinRoom, newRoom, publicState, reconnectPlayer, roomCode, upgradeRoomState } from '@/lib/poker';

function cleanName(value: unknown) {
  const name = String(value ?? '').trim().replace(/[<>]/g, '').slice(0, 12);
  if (!name) throw new Error('请输入你的昵称');
  return name;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; name?: string; code?: string; reconnectCode?: string };
    const now = Date.now();
    const requestedCode = String(body.code ?? '').trim().toUpperCase();
    if (body.action === 'reconnect') {
      const recovery = String(body.reconnectCode ?? '').trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(requestedCode) || !/^[A-Z2-9]{12}$/.test(recovery)) {
        throw new Error('请输入正确的房间号和 12 位重连码');
      }
      const reconnected = await mutateRoom(requestedCode, (state) => {
        upgradeRoomState(state, now);
        const player = reconnectPlayer(state, recovery);
        return { state, result: player };
      });
      if (!reconnected) return NextResponse.json({ error: '没有找到这张牌桌' }, { status: 404 });
      await touchPresence(requestedCode, reconnected.result.id, now);
      const presence = await readPresence(requestedCode);
      return NextResponse.json({
        token: reconnected.result.token,
        room: publicState(reconnected.state, reconnected.version, reconnected.result.token, presence, now),
      });
    }

    const name = cleanName(body.name);
    if (body.action === 'create') {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = roomCode();
        const created = newRoom(code, name);
        try {
          await insertRoom(created.state);
          await touchPresence(code, created.player.id, now);
          return NextResponse.json({
            token: created.player.token,
            room: publicState(created.state, 1, created.player.token, { [created.player.id]: now }, now),
          });
        } catch (error) {
          if (!String(error).toLowerCase().includes('unique')) throw error;
        }
      }
      throw new Error('房间创建失败，请重试');
    }

    if (body.action === 'join') {
      const code = requestedCode;
      if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('请输入 6 位房间码');
      const joined = await mutateRoom(code, (state) => {
        const player = joinRoom(state, name);
        return { state, result: player };
      });
      if (!joined) return NextResponse.json({ error: '没有找到这张牌桌' }, { status: 404 });
      await touchPresence(code, joined.result.id, now);
      const presence = await readPresence(code);
      return NextResponse.json({
        token: joined.result.token,
        room: publicState(joined.state, joined.version, joined.result.token, presence, now),
      });
    }
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '请求失败' }, { status: 400 });
  }
}
