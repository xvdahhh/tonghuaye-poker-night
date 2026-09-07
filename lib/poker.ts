import type { ActionKind, ActionLogEntry, HandHistoryEntry, Player, RoomState, TableSettings, Winner } from './types';

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
const RAISE_UNIT = 10;
export const TURN_DURATION_MS = 30_000;
export const PRESENCE_ONLINE_MS = 12_000;
export const HOST_HANDOVER_MS = 18_000;
export const DEFAULT_TABLE_SETTINGS: TableSettings = {
  buyIn: 1_000,
  smallBlind: 10,
  bigBlind: 20,
  turnDurationMs: TURN_DURATION_MS,
};
const RECONNECT_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ACTIVE_PHASES = ['preflop', 'flop', 'turn', 'river'];

export function normalizeTableSettings(input: Partial<TableSettings> = {}): TableSettings {
  const buyIn = Number(input.buyIn ?? DEFAULT_TABLE_SETTINGS.buyIn);
  const bigBlind = Number(input.bigBlind ?? DEFAULT_TABLE_SETTINGS.bigBlind);
  const turnDurationMs = Number(input.turnDurationMs ?? DEFAULT_TABLE_SETTINGS.turnDurationMs);
  if (!Number.isInteger(buyIn) || buyIn < 500 || buyIn > 100_000 || buyIn % 100 !== 0) {
    throw new Error('起始筹码需为 500—100,000 之间的 100 整数倍');
  }
  if (!Number.isInteger(bigBlind) || bigBlind < 10 || bigBlind > 1_000 || bigBlind % 10 !== 0) {
    throw new Error('大盲需为 10—1,000 之间的 10 整数倍');
  }
  if (buyIn < bigBlind * 20) throw new Error('起始筹码至少需要 20 个大盲');
  if (!Number.isInteger(turnDurationMs) || turnDurationMs < 15_000 || turnDurationMs > 120_000 || turnDurationMs % 5_000 !== 0) {
    throw new Error('行动时间需为 15—120 秒之间的 5 秒整数倍');
  }
  return { buyIn, smallBlind: Math.max(5, Math.floor(bigBlind / 2)), bigBlind, turnDurationMs };
}

export function randomId(length = 20) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => (value % 36).toString(36)).join('');
}

function reconnectCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => RECONNECT_CHARS[value % RECONNECT_CHARS.length]).join('');
}

function uniqueReconnectCode(state: RoomState) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = reconnectCode();
    if (!state.players.some((player) => player.reconnectCode === code)) return code;
  }
  throw new Error('重连码生成失败，请重试');
}

export function appendActionLog(state: RoomState, text: string, at = Date.now()) {
  const entry: ActionLogEntry = { id: randomId(8), handNo: state.handNo, at, text };
  state.actionLog = [...(state.actionLog ?? []), entry].slice(-80);
  return entry;
}

function armTurnTimer(state: RoomState, now = Date.now()) {
  state.turnDurationMs = state.turnDurationMs ?? TURN_DURATION_MS;
  state.turnDeadlineAt = state.actorIndex >= 0 && ACTIVE_PHASES.includes(state.phase)
    ? now + state.turnDurationMs
    : undefined;
}

export function upgradeRoomState(state: RoomState, now = Date.now()) {
  let changed = false;
  if (!state.buyIn) { state.buyIn = DEFAULT_TABLE_SETTINGS.buyIn; changed = true; }
  if (!state.turnDurationMs) { state.turnDurationMs = TURN_DURATION_MS; changed = true; }
  if (!state.actionLog) { state.actionLog = []; changed = true; }
  if (!state.handHistory) { state.handHistory = []; changed = true; }
  state.players.forEach((player) => {
    if (!player.reconnectCode) { player.reconnectCode = uniqueReconnectCode(state); changed = true; }
  });
  if (ACTIVE_PHASES.includes(state.phase) && !state.handStartedAt) {
    state.handStartedAt = now;
    changed = true;
  }
  if (ACTIVE_PHASES.includes(state.phase) && state.actorIndex >= 0 && !state.turnDeadlineAt) {
    state.turnDeadlineAt = now + state.turnDurationMs;
    changed = true;
  }
  if (!ACTIVE_PHASES.includes(state.phase) && state.turnDeadlineAt) {
    state.turnDeadlineAt = undefined;
    changed = true;
  }
  return changed;
}

export function needsRoomMaintenance(state: RoomState, now = Date.now()) {
  return !state.buyIn
    || !state.turnDurationMs
    || !state.actionLog
    || !state.handHistory
    || state.players.some((player) => !player.reconnectCode)
    || (ACTIVE_PHASES.includes(state.phase) && state.actorIndex >= 0 && (!state.turnDeadlineAt || state.turnDeadlineAt <= now))
    || (!ACTIVE_PHASES.includes(state.phase) && Boolean(state.turnDeadlineAt));
}

function isPresent(presence: Record<string, number>, playerId: string, now: number, threshold: number) {
  return now - (presence[playerId] ?? 0) < threshold;
}

export function needsHostTransfer(state: RoomState, presence: Record<string, number>, now = Date.now()) {
  const host = state.players.find((player) => player.id === state.hostId);
  if (host && !host.leaving && isPresent(presence, host.id, now, HOST_HANDOVER_MS)) return false;
  return state.players.some((player) => !player.leaving && isPresent(presence, player.id, now, PRESENCE_ONLINE_MS));
}

export function transferHostIfNeeded(state: RoomState, presence: Record<string, number>, now = Date.now()) {
  if (!needsHostTransfer(state, presence, now)) return false;
  const nextHost = state.players.find((player) => !player.leaving && isPresent(presence, player.id, now, PRESENCE_ONLINE_MS));
  if (!nextHost || nextHost.id === state.hostId) return false;
  state.hostId = nextHost.id;
  state.message = `${nextHost.name} 已接任房主`;
  appendActionLog(state, state.message, now);
  return true;
}

export function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => chars[value % chars.length]).join('');
}

function freshDeck() {
  const cards = Array.from(SUITS, (suit) => Array.from(RANKS, (rank) => `${rank}${suit}`)).flat();
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const target = random[0] % (index + 1);
    [cards[index], cards[target]] = [cards[target], cards[index]];
  }
  return cards;
}

export function newRoom(code: string, name: string, requestedSettings: Partial<TableSettings> = {}) {
  const settings = normalizeTableSettings(requestedSettings);
  const player: Player = {
    id: randomId(10), token: randomId(28), reconnectCode: reconnectCode(), name, stack: settings.buyIn, hole: [],
    folded: false, allIn: false, leaving: false, waitingForNextHand: false,
    sittingOut: false, sittingOutNextHand: false, bet: 0, totalBet: 0,
  };
  const state: RoomState = {
    code, phase: 'lobby', handNo: 0, hostId: player.id, players: [player], dealerIndex: -1,
    actorIndex: -1, deck: [], community: [], pot: 0, currentBet: 0, minRaise: settings.bigBlind,
    buyIn: settings.buyIn, smallBlind: settings.smallBlind, bigBlind: settings.bigBlind,
    pending: [], raiseRights: [], winners: [], message: '等待好友加入牌桌',
    turnDurationMs: settings.turnDurationMs, actionLog: [], handHistory: [],
  };
  return { state, player };
}

export function joinRoom(state: RoomState, name: string) {
  upgradeRoomState(state);
  if (state.players.length >= 6) throw new Error('这张牌桌已经坐满');
  const waitingForNextHand = state.phase !== 'lobby';
  const player: Player = {
    id: randomId(10), token: randomId(28), reconnectCode: uniqueReconnectCode(state), name, stack: state.buyIn ?? DEFAULT_TABLE_SETTINGS.buyIn, hole: [],
    folded: waitingForNextHand, allIn: false, leaving: false, waitingForNextHand,
    sittingOut: false, sittingOutNextHand: false, bet: 0, totalBet: 0,
  };
  state.players.push(player);
  if (state.phase === 'lobby') state.message = `${player.name} 已入座`;
  else appendActionLog(state, `${player.name} 已入座，将从下一手参战`);
  return player;
}

export function configureTable(state: RoomState, player: Player, requestedSettings: Partial<TableSettings>, now = Date.now()) {
  if (player.id !== state.hostId) throw new Error('只有房主可以修改牌桌设置');
  if (state.phase !== 'lobby' || state.handNo > 0) throw new Error('牌桌设置只能在第一手开始前修改');
  const settings = normalizeTableSettings(requestedSettings);
  state.buyIn = settings.buyIn;
  state.smallBlind = settings.smallBlind;
  state.bigBlind = settings.bigBlind;
  state.minRaise = settings.bigBlind;
  state.turnDurationMs = settings.turnDurationMs;
  state.players.forEach((candidate) => { candidate.stack = settings.buyIn; });
  state.message = `牌桌设置已更新：${settings.smallBlind}/${settings.bigBlind}，买入 ${settings.buyIn}`;
  appendActionLog(state, state.message, now);
  return settings;
}

export function reconnectPlayer(state: RoomState, rawCode: string) {
  upgradeRoomState(state);
  const code = rawCode.trim().toUpperCase();
  const player = state.players.find((candidate) => candidate.reconnectCode === code && !candidate.leaving);
  if (!player) throw new Error('房间号或重连码不正确');
  player.token = randomId(28);
  return player;
}

function nextIndex(state: RoomState, start: number, eligible: (player: Player) => boolean) {
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const index = (start + offset + state.players.length) % state.players.length;
    if (eligible(state.players[index])) return index;
  }
  return -1;
}

function commitChips(state: RoomState, index: number, amount: number) {
  const player = state.players[index];
  const paid = Math.min(Math.max(0, amount), player.stack);
  player.stack -= paid;
  player.bet += paid;
  player.totalBet += paid;
  state.pot += paid;
  if (player.stack === 0) player.allIn = true;
  return paid;
}

function ensureRaiseRights(state: RoomState) {
  if (!state.raiseRights) state.raiseRights = [...state.pending];
  return state.raiseRights;
}

function refundUncalledBet(state: RoomState) {
  const highest = Math.max(0, ...state.players.map((player) => player.bet));
  const leaders = state.players.filter((player) => player.bet === highest);
  if (highest === 0 || leaders.length !== 1) return 0;
  const player = leaders[0];
  if (player.folded) return 0;
  const matched = Math.max(0, ...state.players.filter((candidate) => candidate.id !== player.id).map((candidate) => candidate.bet));
  const returned = highest - matched;
  player.bet -= returned;
  player.totalBet -= returned;
  player.stack += returned;
  player.allIn = player.stack === 0;
  state.pot -= returned;
  return returned;
}

function refundLegacyUncalledTotal(state: RoomState) {
  const highest = Math.max(0, ...state.players.map((player) => player.totalBet));
  const leaders = state.players.filter((player) => player.totalBet === highest);
  if (highest === 0 || leaders.length !== 1) return 0;
  const player = leaders[0];
  if (player.folded) return 0;
  const matched = Math.max(0, ...state.players.filter((candidate) => candidate.id !== player.id).map((candidate) => candidate.totalBet));
  const returned = highest - matched;
  player.totalBet -= returned;
  player.stack += returned;
  player.allIn = player.stack === 0;
  state.pot -= returned;
  return returned;
}

function reopenAfterRaise(state: RoomState, playerId: string) {
  const candidates = state.players
    .filter((candidate) => candidate.id !== playerId && !candidate.folded && !candidate.allIn)
    .map((candidate) => candidate.id);
  state.pending = candidates;
  state.raiseRights = [...candidates];
}

function requireResponsesToShortRaise(state: RoomState, playerId: string) {
  const waiting = new Set(state.pending);
  state.players.forEach((candidate) => {
    if (candidate.id !== playerId && !candidate.folded && !candidate.allIn && candidate.bet < state.currentBet) {
      waiting.add(candidate.id);
    }
  });
  state.pending = state.players.filter((candidate) => waiting.has(candidate.id)).map((candidate) => candidate.id);
}

function minimumRaiseTarget(state: RoomState) {
  const minimum = state.currentBet > 0 ? state.currentBet * 2 : state.bigBlind;
  return Math.ceil(minimum / RAISE_UNIT) * RAISE_UNIT;
}

function cleanupLeavingPlayers(state: RoomState) {
  const previousDealerId = state.players[state.dealerIndex]?.id;
  state.players = state.players.filter((player) => !player.leaving);
  state.dealerIndex = previousDealerId
    ? state.players.findIndex((player) => player.id === previousDealerId)
    : -1;
  if (!state.players.some((player) => player.id === state.hostId)) state.hostId = state.players[0]?.id ?? '';
}

export function setPlayerParticipation(state: RoomState, player: Player, sittingOut: boolean, now = Date.now()) {
  const activeHand = ACTIVE_PHASES.includes(state.phase);
  if (activeHand) {
    if (sittingOut) {
      if (player.sittingOut || player.waitingForNextHand) {
        player.sittingOut = true;
        player.waitingForNextHand = false;
        player.folded = true;
        state.message = `${player.name} 正在暂离`;
      } else {
        player.sittingOutNextHand = true;
        state.message = `${player.name} 将从下一手开始暂离`;
      }
    } else if (player.sittingOut || player.waitingForNextHand) {
      player.sittingOut = false;
      player.sittingOutNextHand = false;
      player.waitingForNextHand = true;
      player.folded = true;
      state.message = `${player.name} 将从下一手回到牌桌`;
    } else {
      player.sittingOutNextHand = false;
      state.message = `${player.name} 已取消下一手暂离`;
    }
  } else {
    player.sittingOut = sittingOut;
    player.sittingOutNextHand = false;
    player.waitingForNextHand = false;
    player.folded = sittingOut || player.stack <= 0;
    state.message = sittingOut ? `${player.name} 正在暂离` : `${player.name} 已回到牌桌`;
  }
  appendActionLog(state, state.message, now);
}

export function startHand(state: RoomState, now = Date.now()) {
  upgradeRoomState(state, now);
  if (state.phase !== 'lobby' && state.phase !== 'showdown') throw new Error('本手牌还没有结束');
  cleanupLeavingPlayers(state);
  state.players.forEach((player) => {
    if (player.sittingOutNextHand) player.sittingOut = true;
    player.sittingOutNextHand = false;
  });
  const funded = state.players.filter((player) => player.stack > 0 && !player.sittingOut && !player.leaving);
  if (funded.length < 2) throw new Error('至少需要两位有筹码的玩家');

  state.handNo += 1;
  state.phase = 'preflop';
  state.community = [];
  state.deck = freshDeck();
  state.pot = 0;
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.winners = [];
  state.actionLog = [];
  state.handStartedAt = now;
  state.players.forEach((player) => {
    player.hole = [];
    player.folded = player.stack <= 0 || Boolean(player.sittingOut);
    player.allIn = false;
    player.waitingForNextHand = false;
    player.bet = 0;
    player.totalBet = 0;
  });

  state.dealerIndex = nextIndex(state, state.dealerIndex, (player) => player.stack > 0);
  for (let round = 0; round < 2; round += 1) {
    for (let offset = 1; offset <= state.players.length; offset += 1) {
      const index = (state.dealerIndex + offset) % state.players.length;
      if (!state.players[index].folded) state.players[index].hole.push(state.deck.pop()!);
    }
  }

  const headsUp = funded.length === 2;
  const smallIndex = headsUp
    ? state.dealerIndex
    : nextIndex(state, state.dealerIndex, (player) => !player.folded);
  const bigIndex = nextIndex(state, smallIndex, (player) => !player.folded);
  commitChips(state, smallIndex, state.smallBlind);
  commitChips(state, bigIndex, state.bigBlind);
  state.currentBet = Math.max(state.players[smallIndex].bet, state.players[bigIndex].bet);
  state.pending = state.players.filter((player) => !player.folded && !player.allIn).map((player) => player.id);
  state.raiseRights = [...state.pending];
  state.actorIndex = nextIndex(state, bigIndex, (player) => state.pending.includes(player.id) && !player.allIn);
  state.message = `第 ${state.handNo} 手 · 翻牌前`;
  appendActionLog(state, `第 ${state.handNo} 手开始`, now);
  appendActionLog(state, `${state.players[smallIndex].name} 下小盲 ${state.players[smallIndex].bet}`, now);
  appendActionLog(state, `${state.players[bigIndex].name} 下大盲 ${state.players[bigIndex].bet}`, now);
  armTurnTimer(state, now);
  if (state.actorIndex < 0) runOut(state, now);
}

type Rank = { score: number[]; name: string };

function rankFive(cards: string[]): Rank {
  const values = cards.map((card) => RANKS.indexOf(card[0]) + 2).sort((a, b) => b - a);
  const suits = cards.map((card) => card[1]);
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const groups = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = Array.from(new Set(values));
  if (unique[0] === 14) unique.push(1);
  let straightHigh = 0;
  for (let index = 0; index <= unique.length - 5; index += 1) {
    if (unique[index] - unique[index + 4] === 4) { straightHigh = unique[index]; break; }
  }
  const flush = suits.every((suit) => suit === suits[0]);
  let score: number[];
  if (flush && straightHigh) score = [8, straightHigh];
  else if (groups[0][1] === 4) score = [7, groups[0][0], groups[1][0]];
  else if (groups[0][1] === 3 && groups[1][1] === 2) score = [6, groups[0][0], groups[1][0]];
  else if (flush) score = [5, ...values];
  else if (straightHigh) score = [4, straightHigh];
  else if (groups[0][1] === 3) score = [3, groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)];
  else if (groups[0][1] === 2 && groups[1][1] === 2) score = [2, Math.max(groups[0][0], groups[1][0]), Math.min(groups[0][0], groups[1][0]), groups[2][0]];
  else if (groups[0][1] === 2) score = [1, groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)];
  else score = [0, ...values];
  return { score, name: HAND_NAMES[score[0]] };
}

function compareScore(left: number[], right: number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) - (right[index] ?? 0);
  }
  return 0;
}

function bestHand(cards: string[]) {
  let best: Rank = { score: [-1], name: '' };
  for (let a = 0; a < cards.length - 4; a += 1)
    for (let b = a + 1; b < cards.length - 3; b += 1)
      for (let c = b + 1; c < cards.length - 2; c += 1)
        for (let d = c + 1; d < cards.length - 1; d += 1)
          for (let e = d + 1; e < cards.length; e += 1) {
            const rank = rankFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (compareScore(rank.score, best.score) > 0) best = rank;
          }
  return best;
}

function archiveCompletedHand(state: RoomState, now = Date.now()) {
  if ((state.handHistory ?? []).some((hand) => hand.handNo === state.handNo)) return;
  const entry: HandHistoryEntry = {
    handNo: state.handNo,
    startedAt: state.handStartedAt ?? now,
    completedAt: now,
    dealerId: state.players[state.dealerIndex]?.id ?? '',
    community: [...state.community],
    pot: state.pot,
    players: state.players
      .filter((player) => player.hole.length > 0 || player.totalBet > 0)
      .map((player) => ({
        id: player.id,
        name: player.name,
        hole: [...player.hole],
        folded: player.folded,
        totalBet: player.totalBet,
      })),
    winners: state.winners.map((winner) => ({ ...winner })),
    actions: (state.actionLog ?? []).map((action) => ({ ...action })),
  };
  state.handHistory = [...(state.handHistory ?? []), entry];
}

function showdown(state: RoomState, now = Date.now()) {
  refundLegacyUncalledTotal(state);
  state.phase = 'showdown';
  state.actorIndex = -1;
  state.pending = [];
  state.raiseRights = [];
  const contenders = state.players.filter((player) => !player.folded);
  const ranks = new Map(contenders.map((player) => [player.id, bestHand([...player.hole, ...state.community])]));
  const levels = Array.from(new Set(state.players.map((player) => player.totalBet).filter(Boolean))).sort((a, b) => a - b);
  const payouts = new Map<string, number>();
  let previous = 0;
  for (const level of levels) {
    const contributors = state.players.filter((player) => player.totalBet >= level);
    const eligible = contributors.filter((player) => !player.folded);
    const amount = (level - previous) * contributors.length;
    previous = level;
    const recipients = eligible.length ? eligible : contenders;
    if (!recipients.length || !amount) continue;
    let best = ranks.get(recipients[0].id)!;
    recipients.slice(1).forEach((player) => {
      const rank = ranks.get(player.id)!;
      if (compareScore(rank.score, best.score) > 0) best = rank;
    });
    const tied = recipients.filter((player) => compareScore(ranks.get(player.id)!.score, best.score) === 0);
    const share = Math.floor(amount / tied.length);
    let remainder = amount % tied.length;
    const tiedIds = new Set(tied.map((player) => player.id));
    const clockwise = Array.from({ length: state.players.length }, (_, offset) =>
      state.players[(state.dealerIndex + offset + 1 + state.players.length) % state.players.length],
    ).filter((player) => tiedIds.has(player.id));
    clockwise.forEach((player) => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      payouts.set(player.id, (payouts.get(player.id) ?? 0) + share + extra);
    });
  }
  const winners: Winner[] = Array.from(payouts, ([playerId, amount]) => ({
    playerId, amount, hand: ranks.get(playerId)?.name ?? '弃牌获胜',
  }));
  winners.forEach((winner) => { state.players.find((player) => player.id === winner.playerId)!.stack += winner.amount; });
  state.winners = winners;
  const names = winners.map((winner) => state.players.find((player) => player.id === winner.playerId)?.name).join('、');
  state.message = `${names} 赢得底池`;
  appendActionLog(state, winners.map((winner) => {
    const name = state.players.find((player) => player.id === winner.playerId)?.name ?? '玩家';
    return `${name} 赢得 ${winner.amount}（${winner.hand}）`;
  }).join('；'), now);
  archiveCompletedHand(state, now);
  armTurnTimer(state, now);
  cleanupLeavingPlayers(state);
}

function uncontested(state: RoomState, winner: Player, now = Date.now()) {
  winner.stack += state.pot;
  state.winners = [{ playerId: winner.id, amount: state.pot, hand: '对手弃牌' }];
  state.phase = 'showdown';
  state.actorIndex = -1;
  state.pending = [];
  state.raiseRights = [];
  state.message = `${winner.name} 赢得 ${state.pot} 筹码`;
  appendActionLog(state, `${winner.name} 赢得 ${state.pot}（对手弃牌）`, now);
  archiveCompletedHand(state, now);
  armTurnTimer(state, now);
  cleanupLeavingPlayers(state);
}

function removePlayer(state: RoomState, player: Player) {
  const dealerId = state.players[state.dealerIndex]?.id;
  state.players = state.players.filter((candidate) => candidate.id !== player.id);
  state.dealerIndex = dealerId
    ? state.players.findIndex((candidate) => candidate.id === dealerId)
    : -1;
  if (state.hostId === player.id) state.hostId = state.players[0]?.id ?? '';
  state.message = `${player.name} 离开了牌桌`;
}

export function leaveRoom(state: RoomState, player: Player) {
  appendActionLog(state, `${player.name} 退出牌桌`);
  if (state.phase === 'lobby' || state.phase === 'showdown' || player.waitingForNextHand) {
    removePlayer(state, player);
    return;
  }

  player.leaving = true;
  if (state.hostId === player.id) {
    state.hostId = state.players.find((candidate) => candidate.id !== player.id && !candidate.leaving)?.id ?? '';
  }
  if (player.folded) {
    state.message = `${player.name} 已退出牌桌`;
    return;
  }

  if (state.players[state.actorIndex]?.id === player.id) {
    act(state, player, 'fold');
  } else {
    player.folded = true;
    state.pending = state.pending.filter((id) => id !== player.id);
    state.raiseRights = ensureRaiseRights(state).filter((id) => id !== player.id);
    const remaining = state.players.filter((candidate) => !candidate.folded);
    if (remaining.length === 1) uncontested(state, remaining[0]);
    else if (state.pending.length === 0) advanceStreet(state);
  }
  if (state.phase !== 'showdown') state.message = `${player.name} 已退出，本手按弃牌处理`;
}

function runOut(state: RoomState, now = Date.now()) {
  refundUncalledBet(state);
  while (state.community.length < 5) {
    if (state.community.length === 0) state.community.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
    else state.community.push(state.deck.pop()!);
  }
  showdown(state, now);
}

function advanceStreet(state: RoomState, now = Date.now()) {
  refundUncalledBet(state);
  state.players.forEach((player) => { player.bet = 0; });
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  if (state.phase === 'preflop') { state.phase = 'flop'; state.community.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!); }
  else if (state.phase === 'flop') { state.phase = 'turn'; state.community.push(state.deck.pop()!); }
  else if (state.phase === 'turn') { state.phase = 'river'; state.community.push(state.deck.pop()!); }
  else { showdown(state, now); return; }
  const streetLabels = { flop: '进入翻牌圈', turn: '进入转牌圈', river: '进入河牌圈' };
  appendActionLog(state, streetLabels[state.phase as keyof typeof streetLabels], now);
  state.pending = state.players.filter((player) => !player.folded && !player.allIn).map((player) => player.id);
  state.raiseRights = [...state.pending];
  if (state.pending.length <= 1) { runOut(state, now); return; }
  state.actorIndex = nextIndex(state, state.dealerIndex, (player) => state.pending.includes(player.id));
  const labels = { flop: '翻牌圈', turn: '转牌圈', river: '河牌圈' };
  state.message = `第 ${state.handNo} 手 · ${labels[state.phase as keyof typeof labels]}`;
  armTurnTimer(state, now);
}

export function act(
  state: RoomState,
  player: Player,
  kind: ActionKind,
  amount?: number,
  context: { timedOut?: boolean; now?: number } = {},
) {
  const now = context.now ?? Date.now();
  if (!ACTIVE_PHASES.includes(state.phase)) throw new Error('现在不能操作');
  if (state.players[state.actorIndex]?.id !== player.id) throw new Error('还没轮到你');
  const index = state.actorIndex;
  const toCall = Math.max(0, state.currentBet - player.bet);
  const raiseRights = ensureRaiseRights(state);
  const canRaise = raiseRights.includes(player.id);
  if (kind === 'fold') {
    player.folded = true;
    appendActionLog(state, context.timedOut ? `${player.name} 超时弃牌` : `${player.name} 弃牌`, now);
  }
  else if (kind === 'check') {
    if (toCall !== 0) throw new Error('需要跟注或弃牌');
    appendActionLog(state, context.timedOut ? `${player.name} 超时自动过牌` : `${player.name} 过牌`, now);
  } else if (kind === 'call') {
    const paid = commitChips(state, index, toCall);
    appendActionLog(state, `${player.name} 跟注 ${paid}`, now);
  } else if (kind === 'raise') {
    const target = Number(amount);
    const maxTarget = player.bet + player.stack;
    const minimumTarget = minimumRaiseTarget(state);
    if (!canRaise) throw new Error('本轮下注未重新开放，只能跟注或弃牌');
    if (!Number.isInteger(target) || target <= state.currentBet || target > maxTarget) throw new Error('加注额无效');
    const isAllIn = target === maxTarget;
    if (!isAllIn && (target < minimumTarget || target % RAISE_UNIT !== 0)) {
      throw new Error(`加注需至少到 ${minimumTarget}，且为 ${RAISE_UNIT} 的整数倍`);
    }
    commitChips(state, index, target - player.bet);
    appendActionLog(state, `${player.name} 加注到 ${target}`, now);
    state.currentBet = player.bet;
    if (state.currentBet >= minimumTarget) {
      state.minRaise = state.currentBet;
      reopenAfterRaise(state, player.id);
    } else {
      requireResponsesToShortRaise(state, player.id);
    }
  } else if (kind === 'allin') {
    const target = player.bet + player.stack;
    const previousBet = state.currentBet;
    const minimumTarget = minimumRaiseTarget(state);
    if (target > previousBet && !canRaise) throw new Error('本轮下注未重新开放，只能跟注或弃牌');
    commitChips(state, index, player.stack);
    appendActionLog(state, `${player.name} 全下至 ${target}`, now);
    if (target > previousBet) {
      state.currentBet = target;
      if (state.currentBet >= minimumTarget) {
        state.minRaise = state.currentBet;
        reopenAfterRaise(state, player.id);
      } else {
        requireResponsesToShortRaise(state, player.id);
      }
    }
  }
  state.pending = state.pending.filter((id) => id !== player.id);
  state.raiseRights = ensureRaiseRights(state).filter((id) => id !== player.id);
  const remaining = state.players.filter((candidate) => !candidate.folded);
  if (remaining.length === 1) { uncontested(state, remaining[0], now); return; }
  if (state.pending.length === 0) { advanceStreet(state, now); return; }
  state.actorIndex = nextIndex(state, index, (candidate) => state.pending.includes(candidate.id) && !candidate.folded && !candidate.allIn);
  if (state.actorIndex < 0) advanceStreet(state, now);
  else armTurnTimer(state, now);
}

export function applyTurnTimeout(state: RoomState, now = Date.now()) {
  upgradeRoomState(state, now);
  if (!ACTIVE_PHASES.includes(state.phase) || !state.turnDeadlineAt || state.turnDeadlineAt > now) return false;
  const player = state.players[state.actorIndex];
  if (!player) { armTurnTimer(state, now); return false; }
  const toCall = Math.max(0, state.currentBet - player.bet);
  act(state, player, toCall > 0 ? 'fold' : 'check', undefined, { timedOut: true, now });
  return true;
}

export function publicState(
  state: RoomState,
  version: number,
  token: string,
  presence: Record<string, number> = {},
  now = Date.now(),
) {
  upgradeRoomState(state, now);
  const me = state.players.find((player) => player.token === token);
  if (!me) throw new Error('无效的玩家凭证');
  const reveal = state.phase === 'showdown';
  return {
    ...state,
    version,
    meId: me.id,
    myReconnectCode: me.reconnectCode ?? '',
    buyIn: state.buyIn ?? DEFAULT_TABLE_SETTINGS.buyIn,
    turnDurationMs: state.turnDurationMs ?? TURN_DURATION_MS,
    actionLog: state.actionLog ?? [],
    handHistory: (state.handHistory ?? []).map((hand) => ({
      ...hand,
      players: hand.players.map((player) => ({
        ...player,
        hole: player.id === me.id || !player.folded ? player.hole : player.hole.map(() => 'XX'),
      })),
    })),
    deck: undefined,
    players: state.players.map((player) => {
      const { token: privateToken, reconnectCode: privateReconnectCode, ...safePlayer } = player;
      void privateToken;
      void privateReconnectCode;
      return {
        ...safePlayer,
        online: now - (presence[player.id] ?? 0) < PRESENCE_ONLINE_MS,
        hole: player.id === me.id || (reveal && !player.folded) ? player.hole : player.hole.map(() => 'XX'),
      };
    }),
  };
}
