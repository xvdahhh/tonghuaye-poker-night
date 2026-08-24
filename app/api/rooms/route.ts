import { NextResponse } from 'next/server';
import { insertRoom, mutateRoom } from '@/lib/db';
import { joinRoom, newRoom, publicState, roomCode } from '@/lib/poker';

function cleanName(value: unknown) {
  const name = String(value ?? '').trim().replace(/[<>]/g, '').slice(0, 12);
  if (!name) throw new Error('请输入你的昵称');
  return name;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; name?: string; code?: string };
    const name = cleanName(body.name);
    if (body.action === 'create') {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = roomCode();
        const created = newRoom(code, name);
        try {
          await insertRoom(created.state);
          return NextResponse.json({
            token: created.player.token,
            room: publicState(created.state, 1, created.player.token),
          });
        } catch (error) {
          if (!String(error).toLowerCase().includes('unique')) throw error;
        }
      }
      throw new Error('房间创建失败，请重试');
    }

    if (body.action === 'join') {
      const code = String(body.code ?? '').trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('请输入 6 位房间码');
      const joined = await mutateRoom(code, (state) => {
        const player = joinRoom(state, name);
        return { state, result: player };
      });
      if (!joined) return NextResponse.json({ error: '没有找到这张牌桌' }, { status: 404 });
      return NextResponse.json({
        token: joined.result.token,
        room: publicState(joined.state, joined.version, joined.result.token),
      });
    }
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '请求失败' }, { status: 400 });
  }
}


