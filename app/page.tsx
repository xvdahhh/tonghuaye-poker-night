'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionKind, ClientPlayer, ClientRoom } from '@/lib/types';
import { reconcileSeatOrder, rotateSeatOrderForHand, seatOrderForPlayers } from '@/lib/seats';

const SUITS: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

function Card({ value, small = false }: { value: string; small?: boolean }) {
  if (value === 'XX') return <span className={`playing-card back ${small ? 'small' : ''}`} aria-label="暗牌" />;
  const rank = value[0] === 'T' ? '10' : value[0];
  const suit = SUITS[value[1]];
  const red = value[1] === 'h' || value[1] === 'd';
  return <span className={`playing-card ${red ? 'red' : ''} ${small ? 'small' : ''}`} aria-label={`${rank}${suit}`}><b>{rank}</b><i>{suit}</i></span>;
}

function Landing({ onEnter }: { onEnter: (mode: 'create' | 'join', name: string, code?: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(localStorage.getItem('poker-name') ?? '');
    const incoming = new URLSearchParams(location.search).get('room');
    if (incoming) setCode(incoming.toUpperCase());
  }, []);

  async function submit(mode: 'create' | 'join', event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError('先给自己取个昵称'); return; }
    if (mode === 'join' && code.trim().length !== 6) { setError('房间码是 6 位'); return; }
    setBusy(true); setError('');
    try { await onEnter(mode, name.trim(), code.trim().toUpperCase()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '没能进入牌桌'); setBusy(false); }
  }

  return (
    <main className="landing-shell">
      <nav className="topbar">
        <div className="brand"><span className="brand-mark">♠</span><span>同花夜</span></div>
        <div className="live-pill"><span /> 好友牌局 · 在线</div>
      </nav>
      <section className="hero">
        <p className="eyebrow">PRIVATE TABLE · 2—6 PLAYERS</p>
        <h1>今晚，<em>把朋友叫上桌。</em></h1>
        <p className="lede">无需下载，无需注册。创建一张私人牌桌，把房间码发给朋友，马上开局。</p>
        <div className="entry-card">
          <form className="entry-form" onSubmit={(event) => submit('create', event)}>
            <label>你的昵称<input value={name} maxLength={12} onChange={(event) => setName(event.target.value)} placeholder="例如：小林" autoComplete="nickname" /></label>
            <button className="primary-action" disabled={busy}>创建牌桌 <span>→</span></button>
          </form>
          <div className="entry-divider"><span>或</span></div>
          <form className="entry-form join-form" onSubmit={(event) => submit('join', event)}>
            <label>好友的房间码<input value={code} maxLength={6} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} placeholder="例如：Q7K9XP" /></label>
            <button className="secondary-action" disabled={busy}>加入牌桌</button>
          </form>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      </section>
      <section className="table-preview" aria-label="牌桌预览">
        <div className="preview-seat preview-a"><span>陈</span><b>陈默</b><small>1,000</small></div>
        <div className="preview-seat preview-b"><span>林</span><b>林西</b><small>1,240</small></div>
        <div className="felt preview-felt">
          <div className="pot-label">底池 <b>240</b></div>
          <div className="community-cards"><Card value="Th" /><Card value="Jc" /><Card value="Qd" /><Card value="XX" /><Card value="XX" /></div>
          <div className="dealer-chip">D</div>
        </div>
        <div className="preview-seat preview-c active"><span>你</span><b>你</b><small>860</small></div>
      </section>
      <footer><span>服务器公平洗牌 · 自动判定牌型</span><span>仅供好友休闲娱乐 · 不涉及真钱</span></footer>
    </main>
  );
}

function PlayerSeat({ player, position, room }: { player: ClientPlayer; position: number; room: ClientRoom }) {
  const isMe = player.id === room.meId;
  const isActor = room.players[room.actorIndex]?.id === player.id;
  const isDealer = room.players[room.dealerIndex]?.id === player.id;
  const winner = room.winners.find((item) => item.playerId === player.id);
  return (
    <div className={`player-seat seat-pos-${position} ${isMe ? 'is-me' : ''} ${isActor ? 'is-actor' : ''} ${player.folded ? 'is-folded' : ''}`}>
      <div className="player-avatar">{player.name.slice(0, 1)}</div>
      <div className="player-meta"><b>{isMe ? `${player.name}（你）` : player.name}</b><span>{player.stack.toLocaleString()} 筹码</span></div>
      {isDealer && <span className="dealer-badge">D</span>}
      {player.allIn && !player.leaving && <span className="state-badge">ALL IN</span>}
      {player.leaving ? <span className="state-badge">已退出</span> : player.folded && room.phase !== 'lobby' && <span className="state-badge">已弃牌</span>}
      {player.bet > 0 && <span className="seat-bet">{player.bet}</span>}
      {!!player.hole.length && <div className="seat-cards">{player.hole.map((card, index) => <Card key={`${card}-${index}`} value={card} small={!isMe} />)}</div>}
      {winner && <div className="winner-pop">+{winner.amount} · {winner.hand}</div>}
    </div>
  );
}

function GameTable({ room, onAction, onLeave, busy, toast }: {
  room: ClientRoom;
  onAction: (action: ActionKind | 'start' | 'rebuy', amount?: number) => Promise<void>;
  onLeave: () => Promise<void>;
  busy: boolean;
  toast: (message: string) => void;
}) {
  const me = room.players.find((player) => player.id === room.meId)!;
  const playerIdSignature = room.players.map((player) => player.id).sort().join('|');
  const [seatOrder, setSeatOrder] = useState(() => seatOrderForPlayers(room.players, room.meId));
  const previousHandNo = useRef(room.handNo);
  const orderedPlayers = useMemo(() => {
    const playersById = new Map(room.players.map((player) => [player.id, player]));
    const seated = seatOrder.flatMap((id) => {
      const player = playersById.get(id);
      return player ? [player] : [];
    });
    const knownIds = new Set(seatOrder);
    return [...seated, ...room.players.filter((player) => !knownIds.has(player.id))];
  }, [room.players, seatOrder]);
  const isHost = room.hostId === room.meId;
  const isTurn = room.players[room.actorIndex]?.id === room.meId;
  const fundedPlayers = room.players.filter((player) => player.stack > 0).length;
  const toCall = Math.max(0, room.currentBet - me.bet);
  const canRaise = room.raiseRights?.includes(me.id) ?? room.pending.includes(me.id);
  const minTarget = Math.min(me.bet + me.stack, room.currentBet + room.minRaise);
  const [raiseTarget, setRaiseTarget] = useState(minTarget);

  useEffect(() => {
    const lastHandNo = previousHandNo.current;
    previousHandNo.current = room.handNo;
    setSeatOrder((current) => {
      const reconciled = reconcileSeatOrder(current, room.players, room.meId);
      const next = rotateSeatOrderForHand(reconciled, lastHandNo, room.handNo);
      const unchanged = next.length === current.length && next.every((id, index) => id === current[index]);
      return unchanged ? current : next;
    });
  }, [room.code, room.handNo, room.meId, playerIdSignature]);

  useEffect(() => setRaiseTarget(minTarget), [minTarget, room.version]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isTurn || busy || event.repeat || (event.target instanceof HTMLInputElement)) return;
      if (event.key.toLowerCase() === 'f') onAction('fold');
      if (event.key.toLowerCase() === 'c') onAction(toCall ? 'call' : 'check');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTurn, busy, onAction, toCall]);

  async function invite() {
    const url = `${location.origin}${location.pathname}?room=${room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: '来「同花夜」打牌', text: `房间码 ${room.code}`, url });
      else { await navigator.clipboard.writeText(url); toast('邀请链接已复制'); }
    } catch { /* share sheet cancelled */ }
  }

  return (
    <main className="game-shell">
      <nav className="game-topbar">
        <div className="brand"><span className="brand-mark">♠</span><span>同花夜</span></div>
        <div className="room-tools">
          <button className="room-code" onClick={() => { navigator.clipboard.writeText(room.code); toast('房间码已复制'); }} aria-label="复制房间码">房间 <b>{room.code}</b> <span>复制</span></button>
          <button className="invite-button" onClick={invite}>邀请好友</button>
          <button className="exit-button" disabled={busy} onClick={onLeave} aria-label="退出房间">退出</button>
        </div>
      </nav>

      <section className="game-area">
        <div className="game-status"><span className="sync-dot" /> {room.phase === 'lobby' ? '等待开局' : room.message}</div>
        <div className="felt game-felt">
          <div className="felt-ring" />
          {room.phase === 'lobby' ? (
            <div className="lobby-center">
              <span className="lobby-label">PRIVATE TABLE</span>
              <h2>{room.players.length} / 6 位玩家已入座</h2>
              <p>把房间码 <b>{room.code}</b> 发给好友</p>
              {isHost ? <button disabled={busy || room.players.length < 2} onClick={() => onAction('start')}>{room.players.length < 2 ? '再等一位好友' : '开始牌局'}</button> : <span className="waiting-host">等待房主开始…</span>}
            </div>
          ) : (
            <div className="board-center">
              <div className="pot-total"><span>底池</span><b>{room.pot.toLocaleString()}</b></div>
              <div className="community-cards game-community">
                {room.community.map((card) => <Card key={card} value={card} />)}
                {Array.from({ length: 5 - room.community.length }, (_, index) => <span className="card-slot" key={index} />)}
              </div>
              <p>{room.phase === 'showdown' ? room.message : isTurn ? '轮到你行动' : `等待 ${room.players[room.actorIndex]?.name ?? '玩家'}…`}</p>
              {room.phase === 'showdown' && <div className="showdown-actions">
                {me.stack === 0 && <button className="rebuy-button" disabled={busy} onClick={() => onAction('rebuy')}>补充 1,000 筹码</button>}
                {isHost && <button className="next-hand" disabled={busy || fundedPlayers < 2} onClick={() => onAction('start')}>{fundedPlayers < 2 ? '等待玩家补充筹码' : '开始下一手'}</button>}
              </div>}
            </div>
          )}
        </div>
        <div className="seats-layer">
          {orderedPlayers.map((player, index) => <PlayerSeat key={player.id} player={player} position={index} room={room} />)}
          {Array.from({ length: Math.max(0, 2 - room.players.length) }, (_, index) => <div className={`empty-seat seat-pos-${room.players.length + index}`} key={index}>等待入座</div>)}
        </div>
      </section>

      {isTurn && room.phase !== 'showdown' && (
        <section className="action-dock" aria-label="牌局操作">
          <div className="turn-copy"><span>轮到你</span><b>{toCall ? `需跟注 ${Math.min(toCall, me.stack)}` : '可以过牌'}</b></div>
          <div className="action-buttons">
            <button disabled={busy} className="fold-button" onClick={() => onAction('fold')}>弃牌 <kbd>F</kbd></button>
            <button disabled={busy} onClick={() => onAction(toCall ? 'call' : 'check')}>{toCall ? `跟注 ${Math.min(toCall, me.stack)}` : '过牌'} <kbd>C</kbd></button>
            {me.stack > toCall && canRaise && <div className="raise-control">
              <input aria-label="加注到" type="number" min={minTarget} max={me.bet + me.stack} step={room.bigBlind} value={raiseTarget} onChange={(event) => setRaiseTarget(Number(event.target.value))} />
              <button disabled={busy || raiseTarget <= room.currentBet} className="raise-button" onClick={() => onAction('raise', raiseTarget)}>加注到 {raiseTarget}</button>
            </div>}
            <button disabled={busy || (me.stack > toCall && !canRaise)} className="allin-button" onClick={() => onAction('allin')}>全下 {me.stack}</button>
          </div>
        </section>
      )}
      <p className="fair-note">仅供好友休闲娱乐 · 不涉及真钱交易</p>
    </main>
  );
}

export default function Home() {
  const [room, setRoom] = useState<ClientRoom | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const toast = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2200);
  }, []);

  const fetchRoom = useCallback(async (code: string, playerToken: string) => {
    const response = await fetch(`/api/rooms/${code}`, { headers: { 'x-player-token': playerToken }, cache: 'no-store' });
    if (!response.ok) {
      const failure = await response.json() as { error?: string };
      throw new Error(failure.error ?? '同步失败');
    }
    const data = await response.json() as { room: ClientRoom };
    setRoom((current) => !current || data.room.version >= current.version ? data.room : current);
  }, []);

  useEffect(() => {
    const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
    if (!code) return;
    const savedToken = localStorage.getItem(`poker-token-${code}`);
    if (!savedToken) return;
    setToken(savedToken);
    fetchRoom(code, savedToken).catch(() => localStorage.removeItem(`poker-token-${code}`));
  }, [fetchRoom]);

  useEffect(() => {
    if (!room || !token) return;
    const timer = window.setInterval(() => fetchRoom(room.code, token).catch(() => undefined), 1200);
    return () => window.clearInterval(timer);
  }, [room?.code, token, fetchRoom]);

  async function enter(mode: 'create' | 'join', name: string, code?: string) {
    const response = await fetch('/api/rooms', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: mode, name, code }),
    });
    const data = await response.json() as { error?: string; token?: string; room?: ClientRoom };
    if (!response.ok || !data.room || !data.token) throw new Error(data.error ?? '没能进入牌桌');
    localStorage.setItem('poker-name', name);
    localStorage.setItem(`poker-token-${data.room.code}`, data.token);
    history.replaceState(null, '', `?room=${data.room.code}`);
    setToken(data.token); setRoom(data.room);
  }

  async function action(kind: ActionKind | 'start' | 'rebuy', amount?: number) {
    if (!room) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/rooms/${room.code}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-player-token': token },
        body: JSON.stringify({ action: kind, amount }),
      });
      const data = await response.json() as { error?: string; room?: ClientRoom };
      if (!response.ok || !data.room) throw new Error(data.error ?? '操作失败');
      setRoom(data.room);
    } catch (error) { toast(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusy(false); }
  }

  async function leave() {
    if (!room) return;
    const activeHand = ['preflop', 'flop', 'turn', 'river'].includes(room.phase);
    if (activeHand && !window.confirm('现在退出会将本手牌视为弃牌，确定退出房间吗？')) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/rooms/${room.code}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-player-token': token }, body: JSON.stringify({ action: 'leave' }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? '退出失败');
      localStorage.removeItem(`poker-token-${room.code}`);
      history.replaceState(null, '', location.pathname);
      setRoom(null); setToken('');
    } catch (error) { toast(error instanceof Error ? error.message : '退出失败'); }
    finally { setBusy(false); }
  }

  return <>{room ? <GameTable room={room} onAction={action} onLeave={leave} busy={busy} toast={toast} /> : <Landing onEnter={enter} />}{notice && <div className="toast" role="status">{notice}</div>}</>;
}

