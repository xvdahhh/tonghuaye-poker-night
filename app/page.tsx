'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionKind, ClientPlayer, ClientRoom, TableSettings } from '@/lib/types';
import { reconcileSeatOrder, rotateSeatOrderForHand, seatOrderForPlayers } from '@/lib/seats';

const SUITS: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RAISE_UNIT = 10;
type RoomAction = ActionKind | 'start' | 'rebuy' | 'configure' | 'sitout' | 'return';

function Card({ value, small = false }: { value: string; small?: boolean }) {
  if (value === 'XX') return <span className={`playing-card back ${small ? 'small' : ''}`} aria-label="暗牌" />;
  const rank = value[0] === 'T' ? '10' : value[0];
  const suit = SUITS[value[1]];
  const red = value[1] === 'h' || value[1] === 'd';
  return <span className={`playing-card ${red ? 'red' : ''} ${small ? 'small' : ''}`} aria-label={`${rank}${suit}`}><b>{rank}</b><i>{suit}</i></span>;
}

function Landing({ onEnter, onReconnect }: {
  onEnter: (mode: 'create' | 'join', name: string, code?: string, settings?: TableSettings) => Promise<void>;
  onReconnect: (code: string, reconnectCode: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [showReconnect, setShowReconnect] = useState(false);
  const [reconnectRoom, setReconnectRoom] = useState('');
  const [reconnectCode, setReconnectCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [buyIn, setBuyIn] = useState(1_000);
  const [bigBlind, setBigBlind] = useState(20);
  const [turnSeconds, setTurnSeconds] = useState(30);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setName(localStorage.getItem('poker-name') ?? '');
      const incoming = new URLSearchParams(location.search).get('room');
      if (incoming) { setCode(incoming.toUpperCase()); setReconnectRoom(incoming.toUpperCase()); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(mode: 'create' | 'join', event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError('先给自己取个昵称'); return; }
    if (mode === 'join' && code.trim().length !== 6) { setError('房间码是 6 位'); return; }
    setBusy(true); setError('');
    const settings = mode === 'create'
      ? { buyIn, smallBlind: bigBlind / 2, bigBlind, turnDurationMs: turnSeconds * 1_000 }
      : undefined;
    try { await onEnter(mode, name.trim(), code.trim().toUpperCase(), settings); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '没能进入牌桌'); setBusy(false); }
  }

  async function submitReconnect(event: FormEvent) {
    event.preventDefault();
    if (reconnectRoom.length !== 6 || reconnectCode.length !== 12) {
      setError('请输入 6 位房间号和 12 位重连码');
      return;
    }
    setBusy(true); setError('');
    try { await onReconnect(reconnectRoom, reconnectCode); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '没能恢复座位'); setBusy(false); }
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
            <details className="create-settings">
              <summary><span>牌桌设置</span><small>{buyIn.toLocaleString()} 筹码 · {bigBlind / 2}/{bigBlind} · {turnSeconds} 秒</small></summary>
              <div className="settings-grid">
                <label>起始筹码<select value={buyIn} onChange={(event) => setBuyIn(Number(event.target.value))}><option value={500} disabled={500 < bigBlind * 20}>500</option><option value={1000} disabled={1000 < bigBlind * 20}>1,000</option><option value={2000} disabled={2000 < bigBlind * 20}>2,000</option><option value={5000}>5,000</option><option value={10000}>10,000</option><option value={20000}>20,000</option></select></label>
                <label>盲注<select value={bigBlind} onChange={(event) => { const next = Number(event.target.value); setBigBlind(next); setBuyIn((current) => current >= next * 20 ? current : next <= 50 ? 1000 : next <= 100 ? 2000 : 5000); }}><option value={20}>10 / 20</option><option value={50}>25 / 50</option><option value={100}>50 / 100</option><option value={200}>100 / 200</option></select></label>
                <label>行动时间<select value={turnSeconds} onChange={(event) => setTurnSeconds(Number(event.target.value))}><option value={15}>15 秒</option><option value={30}>30 秒</option><option value={45}>45 秒</option><option value={60}>60 秒</option></select></label>
              </div>
            </details>
            <button className="primary-action" disabled={busy}>创建牌桌 <span>→</span></button>
          </form>
          <div className="entry-divider"><span>或</span></div>
          <form className="entry-form join-form" onSubmit={(event) => submit('join', event)}>
            <label>好友的房间码<input value={code} maxLength={6} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} placeholder="例如：Q7K9XP" /></label>
            <button className="secondary-action" disabled={busy}>加入牌桌</button>
          </form>
          <div className="reconnect-box">
            {!showReconnect ? (
              <button type="button" className="reconnect-toggle" onClick={() => setShowReconnect(true)}>换了设备？使用重连码恢复原座位</button>
            ) : (
              <form className="reconnect-form" onSubmit={submitReconnect}>
                <label>房间号<input value={reconnectRoom} maxLength={6} onChange={(event) => setReconnectRoom(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} placeholder="6 位房间号" /></label>
                <label>重连码<input value={reconnectCode} maxLength={12} onChange={(event) => setReconnectCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} placeholder="12 位重连码" /></label>
                <button disabled={busy}>恢复座位</button>
                <button type="button" className="reconnect-cancel" onClick={() => setShowReconnect(false)}>取消</button>
              </form>
            )}
          </div>
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
    <div className={`player-seat seat-pos-${position} ${isMe ? 'is-me' : ''} ${isActor ? 'is-actor' : ''} ${player.folded && !player.waitingForNextHand ? 'is-folded' : ''} ${player.waitingForNextHand ? 'is-waiting' : ''}`}>
      <div className="player-avatar">{player.name.slice(0, 1)}</div>
      <div className="player-meta"><b>{isMe ? `${player.name}（你）` : player.name}</b><span><i className={`presence-dot ${player.online ? 'online' : ''}`} aria-label={player.online ? '在线' : '离线'} />{player.stack.toLocaleString()} 筹码</span></div>
      {isDealer && <span className="dealer-badge">D</span>}
      {player.allIn && !player.leaving && <span className="state-badge">ALL IN</span>}
      {player.leaving ? <span className="state-badge">已退出</span> : player.sittingOut ? <span className="state-badge waiting-badge">暂离</span> : player.sittingOutNextHand ? <span className="state-badge waiting-badge">下手暂离</span> : player.waitingForNextHand ? <span className="state-badge waiting-badge">下手参战</span> : player.folded && room.phase !== 'lobby' && <span className="state-badge">已弃牌</span>}
      {player.bet > 0 && <span className="seat-bet">{player.bet}</span>}
      {!!player.hole.length && <div className="seat-cards">{player.hole.map((card, index) => <Card key={`${card}-${index}`} value={card} small={!isMe} />)}</div>}
      {winner && <div className="winner-pop">+{winner.amount} · {winner.hand}</div>}
    </div>
  );
}

function GameTable({ room, onAction, onLeave, busy, toast, connectionState }: {
  room: ClientRoom;
  onAction: (action: RoomAction, amount?: number, settings?: TableSettings) => Promise<boolean>;
  onLeave: () => Promise<void>;
  busy: boolean;
  toast: (message: string) => void;
  connectionState: 'connected' | 'reconnecting';
}) {
  const me = room.players.find((player) => player.id === room.meId)!;
  const playerIdSignature = room.players.map((player) => player.id).sort().join('|');
  const [seatOrder, setSeatOrder] = useState(() => seatOrderForPlayers(room.players, room.meId));
  const [showInfo, setShowInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [historyMode, setHistoryMode] = useState<'current' | 'history'>('current');
  const [settingsDraft, setSettingsDraft] = useState<TableSettings>(() => ({
    buyIn: room.buyIn,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    turnDurationMs: room.turnDurationMs,
  }));
  const [clockNow, setClockNow] = useState(0);
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
  const fundedPlayers = room.players.filter((player) => player.stack > 0 && !player.sittingOut && !player.sittingOutNextHand && !player.leaving).length;
  const toCall = Math.max(0, room.currentBet - me.bet);
  const canRaise = room.raiseRights?.includes(me.id) ?? room.pending.includes(me.id);
  const maximumTarget = me.bet + me.stack;
  const rawMinimumTarget = room.currentBet > 0 ? room.currentBet * 2 : room.bigBlind;
  const legalMinimumTarget = Math.ceil(rawMinimumTarget / RAISE_UNIT) * RAISE_UNIT;
  const minTarget = Math.min(maximumTarget, legalMinimumTarget);
  const [raiseTarget, setRaiseTarget] = useState(minTarget);
  const raiseIsAllIn = raiseTarget === maximumTarget;
  const validRaiseTarget = Number.isInteger(raiseTarget)
    && raiseTarget > room.currentBet
    && raiseTarget <= maximumTarget
    && (raiseIsAllIn || (raiseTarget >= legalMinimumTarget && raiseTarget % RAISE_UNIT === 0));
  const turnSeconds = room.turnDeadlineAt
    ? clockNow ? Math.max(0, Math.ceil((room.turnDeadlineAt - clockNow) / 1000)) : Math.ceil(room.turnDurationMs / 1000)
    : 0;

  useEffect(() => {
    const lastHandNo = previousHandNo.current;
    previousHandNo.current = room.handNo;
    setSeatOrder((current) => {
      const reconciled = reconcileSeatOrder(current, room.players, room.meId);
      const next = rotateSeatOrderForHand(reconciled, lastHandNo, room.handNo);
      const unchanged = next.length === current.length && next.every((id, index) => id === current[index]);
      return unchanged ? current : next;
    });
  }, [room.code, room.handNo, room.meId, room.players, playerIdSignature]);

  useEffect(() => {
    const timer = window.setTimeout(() => setRaiseTarget(minTarget), 0);
    return () => window.clearTimeout(timer);
  }, [minTarget, room.version]);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettingsDraft({
      buyIn: room.buyIn, smallBlind: room.smallBlind, bigBlind: room.bigBlind, turnDurationMs: room.turnDurationMs,
    }), 0);
    return () => window.clearTimeout(timer);
  }, [room.buyIn, room.smallBlind, room.bigBlind, room.turnDurationMs]);
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
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

  const participationAction: RoomAction = me.sittingOut || me.sittingOutNextHand ? 'return' : 'sitout';
  const participationLabel = me.sittingOut ? '下一手回桌' : me.sittingOutNextHand ? '取消暂离' : room.phase === 'lobby' || room.phase === 'showdown' ? '暂离' : '下手暂离';

  return (
    <main className="game-shell">
      <nav className="game-topbar">
        <div className="brand"><span className="brand-mark">♠</span><span>同花夜</span></div>
        <div className="room-tools">
          <button className="room-code" onClick={() => { navigator.clipboard.writeText(room.code); toast('房间码已复制'); }} aria-label="复制房间码">房间 <b>{room.code}</b> <span>复制</span></button>
          <button className="invite-button" onClick={invite}>邀请好友</button>
          {isHost && room.phase === 'lobby' && room.handNo === 0 && <button className="settings-button" onClick={() => setShowSettings(true)}>牌桌设置</button>}
          <button className="participation-button" disabled={busy} onClick={() => onAction(participationAction)}>{participationLabel}</button>
          <button className="info-button" onClick={() => setShowInfo(true)}>牌局记录</button>
          <button className="exit-button" disabled={busy} onClick={onLeave} aria-label="退出房间">退出</button>
        </div>
      </nav>

      <section className="game-area">
        <div className="game-status"><span className={`sync-dot ${connectionState}`} /> {connectionState === 'reconnecting' ? '连接中断，正在重连…' : me.sittingOut ? '正在暂离，点击“下一手回桌”即可回来' : me.sittingOutNextHand ? '本手结束后开始暂离' : me.waitingForNextHand ? '已入座，下一手开始参战' : room.phase === 'lobby' ? '等待开局' : room.message}</div>
        <div className="felt game-felt">
          <div className="felt-ring" />
          {room.phase === 'lobby' ? (
            <div className="lobby-center">
              <span className="lobby-label">PRIVATE TABLE</span>
              <h2>{fundedPlayers} 位玩家准备参战</h2>
              <p>{room.players.length} / 6 已入座 · 盲注 {room.smallBlind}/{room.bigBlind} · {room.turnDurationMs / 1_000} 秒</p>
              {isHost ? <button disabled={busy || room.players.length < 2} onClick={() => onAction('start')}>{room.players.length < 2 ? '再等一位好友' : '开始牌局'}</button> : <span className="waiting-host">等待房主开始…</span>}
            </div>
          ) : (
            <div className="board-center">
              <div className="pot-total"><span>底池</span><b>{room.pot.toLocaleString()}</b></div>
              <div className="community-cards game-community">
                {room.community.map((card) => <Card key={card} value={card} />)}
                {Array.from({ length: 5 - room.community.length }, (_, index) => <span className="card-slot" key={index} />)}
              </div>
              <p>{me.waitingForNextHand ? '你可以观看当前牌局，下一手会自动发牌' : room.phase === 'showdown' ? room.message : isTurn ? `轮到你行动 · ${turnSeconds} 秒` : `等待 ${room.players[room.actorIndex]?.name ?? '玩家'} · ${turnSeconds} 秒`}</p>
              {room.phase === 'showdown' && <div className="showdown-actions">
                {me.stack === 0 && <button className="rebuy-button" disabled={busy} onClick={() => onAction('rebuy')}>补充 {room.buyIn.toLocaleString()} 筹码</button>}
                {isHost && <button className="next-hand" disabled={busy || fundedPlayers < 2} onClick={() => onAction('start')}>{fundedPlayers < 2 ? '等待至少两位玩家' : '开始下一手'}</button>}
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
          <div className="turn-copy"><span>轮到你 · {turnSeconds} 秒</span><b>{toCall ? `需跟注 ${Math.min(toCall, me.stack)}` : '可以过牌'}</b></div>
          <div className="action-buttons">
            <button disabled={busy} className="fold-button" onClick={() => onAction('fold')}>弃牌 <kbd>F</kbd></button>
            <button disabled={busy} onClick={() => onAction(toCall ? 'call' : 'check')}>{toCall ? `跟注 ${Math.min(toCall, me.stack)}` : '过牌'} <kbd>C</kbd></button>
            {me.stack > toCall && canRaise && <div className="raise-control">
              <input aria-label="加注到" type="number" min={minTarget} max={maximumTarget} step={RAISE_UNIT} value={raiseTarget} onChange={(event) => setRaiseTarget(Number(event.target.value))} />
              <button disabled={busy || !validRaiseTarget} className="raise-button" onClick={() => onAction('raise', raiseTarget)}>加注到 {raiseTarget}</button>
            </div>}
            <button disabled={busy || (me.stack > toCall && !canRaise)} className="allin-button" onClick={() => onAction('allin')}>全下 {me.stack}</button>
          </div>
        </section>
      )}
      {showInfo && (
        <aside className="game-info-panel" aria-label="牌局记录">
          <div className="info-panel-header"><div><span>HAND {room.handNo || '—'}</span><h2>本手记录</h2></div><button onClick={() => setShowInfo(false)} aria-label="关闭牌局记录">×</button></div>
          <div className="reconnect-card">
            <div><span>跨设备恢复座位</span><code>{room.myReconnectCode}</code></div>
            <button onClick={() => { navigator.clipboard.writeText(room.myReconnectCode); toast('重连码已复制，请妥善保存'); }}>复制重连码</button>
          </div>
          <div className="history-tabs" role="tablist" aria-label="牌局记录范围">
            <button className={historyMode === 'current' ? 'active' : ''} onClick={() => setHistoryMode('current')}>本手</button>
            <button className={historyMode === 'history' ? 'active' : ''} onClick={() => setHistoryMode('history')}>历史 {room.handHistory.length}</button>
          </div>
          {historyMode === 'current' ? (
            <ol className="action-log">
              {room.actionLog.length ? [...room.actionLog].reverse().map((entry) => (
                <li key={entry.id}><time>{new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>{entry.text}</span></li>
              )) : <li className="empty-log">本手还没有操作记录</li>}
            </ol>
          ) : (
            <div className="hand-history">
              {room.handHistory.length ? [...room.handHistory].reverse().map((hand) => (
                <details key={hand.handNo} className="history-hand">
                  <summary><span><b>第 {hand.handNo} 手</b><small>{new Date(hand.completedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small></span><strong>{hand.winners.map((winner) => `${hand.players.find((player) => player.id === winner.playerId)?.name ?? '玩家'} +${winner.amount}`).join(' · ')}</strong></summary>
                  <div className="history-board"><span>公共牌</span><div>{hand.community.map((card, index) => <Card key={`${card}-${index}`} value={card} small />)}</div><b>底池 {hand.pot.toLocaleString()}</b></div>
                  <div className="history-players">
                    {hand.players.map((player) => <div key={player.id}><span>{player.name}{player.id === hand.dealerId ? ' · D' : ''}</span><div>{player.hole.map((card, index) => <Card key={`${card}-${index}`} value={card} small />)}</div><small>{player.folded ? '已弃牌' : `投入 ${player.totalBet}`}</small></div>)}
                  </div>
                  <ol className="action-log compact">{hand.actions.map((entry) => <li key={entry.id}><time>{new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>{entry.text}</span></li>)}</ol>
                </details>
              )) : <p className="empty-log">完成第一手后，这里会保留整场历史</p>}
            </div>
          )}
        </aside>
      )}
      {showSettings && (
        <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSettings(false); }}>
          <section className="table-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="table-settings-title">
            <div className="info-panel-header"><div><span>BEFORE HAND 1</span><h2 id="table-settings-title">牌桌设置</h2></div><button onClick={() => setShowSettings(false)} aria-label="关闭牌桌设置">×</button></div>
            <p>设置会应用到已经入座的所有玩家，第一手开始后锁定。</p>
            <div className="dialog-settings-grid">
              <label>起始筹码<select value={settingsDraft.buyIn} onChange={(event) => setSettingsDraft((current) => ({ ...current, buyIn: Number(event.target.value) }))}><option value={500} disabled={500 < settingsDraft.bigBlind * 20}>500</option><option value={1000} disabled={1000 < settingsDraft.bigBlind * 20}>1,000</option><option value={2000} disabled={2000 < settingsDraft.bigBlind * 20}>2,000</option><option value={5000}>5,000</option><option value={10000}>10,000</option><option value={20000}>20,000</option></select></label>
              <label>盲注<select value={settingsDraft.bigBlind} onChange={(event) => { const bigBlind = Number(event.target.value); setSettingsDraft((current) => ({ ...current, bigBlind, smallBlind: bigBlind / 2, buyIn: current.buyIn >= bigBlind * 20 ? current.buyIn : bigBlind <= 50 ? 1000 : bigBlind <= 100 ? 2000 : 5000 })); }}><option value={20}>10 / 20</option><option value={50}>25 / 50</option><option value={100}>50 / 100</option><option value={200}>100 / 200</option></select></label>
              <label>行动时间<select value={settingsDraft.turnDurationMs} onChange={(event) => setSettingsDraft((current) => ({ ...current, turnDurationMs: Number(event.target.value) }))}><option value={15000}>15 秒</option><option value={30000}>30 秒</option><option value={45000}>45 秒</option><option value={60000}>60 秒</option></select></label>
            </div>
            <div className="dialog-actions"><button className="secondary-action" onClick={() => setShowSettings(false)}>取消</button><button className="primary-action" disabled={busy} onClick={async () => { if (await onAction('configure', undefined, settingsDraft)) setShowSettings(false); }}>保存设置</button></div>
          </section>
        </div>
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
  const [connectionState, setConnectionState] = useState<'connected' | 'reconnecting'>('connected');

  const toast = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2200);
  }, []);

  const fetchRoom = useCallback(async (code: string, playerToken: string) => {
    try {
      const response = await fetch(`/api/rooms/${code}`, { headers: { 'x-player-token': playerToken }, cache: 'no-store' });
      if (!response.ok) {
        const failure = await response.json() as { error?: string };
        throw new Error(failure.error ?? '同步失败');
      }
      const data = await response.json() as { room: ClientRoom };
      setRoom((current) => !current || data.room.version >= current.version ? data.room : current);
      setConnectionState('connected');
    } catch (error) {
      setConnectionState('reconnecting');
      throw error;
    }
  }, []);

  useEffect(() => {
    const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
    if (!code) return;
    const savedToken = localStorage.getItem(`poker-token-${code}`);
    if (!savedToken) return;
    const timer = window.setTimeout(() => {
      setToken(savedToken);
      fetchRoom(code, savedToken).catch(() => { localStorage.removeItem(`poker-token-${code}`); setToken(''); });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchRoom]);

  const activeRoomCode = room?.code;
  useEffect(() => {
    if (!activeRoomCode || !token) return;
    const timer = window.setInterval(() => fetchRoom(activeRoomCode, token).catch(() => undefined), 1200);
    return () => window.clearInterval(timer);
  }, [activeRoomCode, token, fetchRoom]);

  async function enter(mode: 'create' | 'join', name: string, code?: string, settings?: TableSettings) {
    const response = await fetch('/api/rooms', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: mode, name, code, settings }),
    });
    const data = await response.json() as { error?: string; token?: string; room?: ClientRoom };
    if (!response.ok || !data.room || !data.token) throw new Error(data.error ?? '没能进入牌桌');
    localStorage.setItem('poker-name', name);
    localStorage.setItem(`poker-token-${data.room.code}`, data.token);
    history.replaceState(null, '', `?room=${data.room.code}`);
    setToken(data.token); setRoom(data.room); setConnectionState('connected');
  }

  async function reconnect(code: string, reconnectCode: string) {
    const response = await fetch('/api/rooms', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reconnect', code, reconnectCode }),
    });
    const data = await response.json() as { error?: string; token?: string; room?: ClientRoom };
    if (!response.ok || !data.room || !data.token) throw new Error(data.error ?? '没能恢复座位');
    const me = data.room.players.find((player) => player.id === data.room?.meId);
    if (me) localStorage.setItem('poker-name', me.name);
    localStorage.setItem(`poker-token-${data.room.code}`, data.token);
    history.replaceState(null, '', `?room=${data.room.code}`);
    setToken(data.token); setRoom(data.room); setConnectionState('connected');
  }

  async function action(kind: RoomAction, amount?: number, settings?: TableSettings) {
    if (!room) return false;
    setBusy(true);
    try {
      const response = await fetch(`/api/rooms/${room.code}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-player-token': token },
        body: JSON.stringify({ action: kind, amount, settings }),
      });
      const data = await response.json() as { error?: string; room?: ClientRoom };
      if (!response.ok || !data.room) throw new Error(data.error ?? '操作失败');
      setRoom(data.room);
      return true;
    } catch (error) { toast(error instanceof Error ? error.message : '操作失败'); return false; }
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

  return <>{room ? <GameTable room={room} onAction={action} onLeave={leave} busy={busy} toast={toast} connectionState={connectionState} /> : <Landing onEnter={enter} onReconnect={reconnect} />}{notice && <div className="toast" role="status">{notice}</div>}</>;
}
