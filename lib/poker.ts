import type { ActionKind, Player, RoomState, Winner } from './types';

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

export function randomId(length = 20) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => (value % 36).toString(36)).join('');
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

export function newRoom(code: string, name: string) {
  const player: Player = {
    id: randomId(10), token: randomId(28), name, stack: 1000, hole: [],
    folded: false, allIn: false, leaving: false, bet: 0, totalBet: 0,
  };
  const state: RoomState = {
    code, phase: 'lobby', handNo: 0, hostId: player.id, players: [player], dealerIndex: -1,
    actorIndex: -1, deck: [], community: [], pot: 0, currentBet: 0, minRaise: 20,
    smallBlind: 10, bigBlind: 20, pending: [], winners: [], message: '等待好友加入牌桌',
  };
  return { state, player };
}

export function joinRoom(state: RoomState, name: string) {
  if (state.phase !== 'lobby') throw new Error('牌局已经开始');
  if (state.players.length >= 6) throw new Error('这张牌桌已经坐满');
  const player: Player = {
    id: randomId(10), token: randomId(28), name, stack: 1000, hole: [],
    folded: false, allIn: false, leaving: false, bet: 0, totalBet: 0,
  };
  state.players.push(player);
  state.message = `${player.name} 已入座`;
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

function cleanupLeavingPlayers(state: RoomState) {
  const previousDealerId = state.players[state.dealerIndex]?.id;
  state.players = state.players.filter((player) => !player.leaving);
  state.dealerIndex = previousDealerId
    ? state.players.findIndex((player) => player.id === previousDealerId)
    : -1;
  if (!state.players.some((player) => player.id === state.hostId)) state.hostId = state.players[0]?.id ?? '';
}

export function startHand(state: RoomState) {
  cleanupLeavingPlayers(state);
  const funded = state.players.filter((player) => player.stack > 0);
  if (funded.length < 2) throw new Error('至少需要两位有筹码的玩家');
  if (state.phase !== 'lobby' && state.phase !== 'showdown') throw new Error('本手牌还没有结束');

  state.handNo += 1;
  state.phase = 'preflop';
  state.community = [];
  state.deck = freshDeck();
  state.pot = 0;
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.winners = [];
  state.players.forEach((player) => {
    player.hole = [];
    player.folded = player.stack <= 0;
    player.allIn = false;
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
  state.actorIndex = nextIndex(state, bigIndex, (player) => state.pending.includes(player.id) && !player.allIn);
  state.message = `第 ${state.handNo} 手 · 翻牌前`;
  if (state.actorIndex < 0) runOut(state);
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

function showdown(state: RoomState) {
  state.phase = 'showdown';
  state.actorIndex = -1;
  state.pending = [];
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
    if (!eligible.length || !amount) continue;
    let best = ranks.get(eligible[0].id)!;
    eligible.slice(1).forEach((player) => {
      const rank = ranks.get(player.id)!;
      if (compareScore(rank.score, best.score) > 0) best = rank;
    });
    const tied = eligible.filter((player) => compareScore(ranks.get(player.id)!.score, best.score) === 0);
    const share = Math.floor(amount / tied.length);
    let remainder = amount % tied.length;
    tied.forEach((player) => {
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
  cleanupLeavingPlayers(state);
}

function uncontested(state: RoomState, winner: Player) {
  winner.stack += state.pot;
  state.winners = [{ playerId: winner.id, amount: state.pot, hand: '对手弃牌' }];
  state.phase = 'showdown';
  state.actorIndex = -1;
  state.pending = [];
  state.message = `${winner.name} 赢得 ${state.pot} 筹码`;
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
  if (state.phase === 'lobby' || state.phase === 'showdown') {
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
    const remaining = state.players.filter((candidate) => !candidate.folded);
    if (remaining.length === 1) uncontested(state, remaining[0]);
    else if (state.pending.length === 0) advanceStreet(state);
  }
  if (state.phase !== 'showdown') state.message = `${player.name} 已退出，本手按弃牌处理`;
}

function runOut(state: RoomState) {
  while (state.community.length < 5) {
    if (state.community.length === 0) state.community.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
    else state.community.push(state.deck.pop()!);
  }
  showdown(state);
}

function advanceStreet(state: RoomState) {
  state.players.forEach((player) => { player.bet = 0; });
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  if (state.phase === 'preflop') { state.phase = 'flop'; state.community.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!); }
  else if (state.phase === 'flop') { state.phase = 'turn'; state.community.push(state.deck.pop()!); }
  else if (state.phase === 'turn') { state.phase = 'river'; state.community.push(state.deck.pop()!); }
  else { showdown(state); return; }
  state.pending = state.players.filter((player) => !player.folded && !player.allIn).map((player) => player.id);
  if (state.pending.length <= 1) { runOut(state); return; }
  state.actorIndex = nextIndex(state, state.dealerIndex, (player) => state.pending.includes(player.id));
  const labels = { flop: '翻牌圈', turn: '转牌圈', river: '河牌圈' };
  state.message = `第 ${state.handNo} 手 · ${labels[state.phase as keyof typeof labels]}`;
}

export function act(state: RoomState, player: Player, kind: ActionKind, amount?: number) {
  if (!['preflop', 'flop', 'turn', 'river'].includes(state.phase)) throw new Error('现在不能操作');
  if (state.players[state.actorIndex]?.id !== player.id) throw new Error('还没轮到你');
  const index = state.actorIndex;
  const toCall = Math.max(0, state.currentBet - player.bet);
  if (kind === 'fold') player.folded = true;
  else if (kind === 'check') {
    if (toCall !== 0) throw new Error('需要跟注或弃牌');
  } else if (kind === 'call') {
    commitChips(state, index, toCall);
  } else if (kind === 'raise') {
    const target = Math.floor(Number(amount));
    const maxTarget = player.bet + player.stack;
    if (!Number.isFinite(target) || target <= state.currentBet) throw new Error('加注额无效');
    if (target < state.currentBet + state.minRaise && target < maxTarget) throw new Error(`最少加注到 ${state.currentBet + state.minRaise}`);
    const previousBet = state.currentBet;
    commitChips(state, index, target - player.bet);
    state.currentBet = player.bet;
    state.minRaise = Math.max(state.bigBlind, state.currentBet - previousBet);
    state.pending = state.players.filter((candidate) => candidate.id !== player.id && !candidate.folded && !candidate.allIn).map((candidate) => candidate.id);
  } else if (kind === 'allin') {
    const target = player.bet + player.stack;
    const previousBet = state.currentBet;
    commitChips(state, index, player.stack);
    if (target > previousBet) {
      const raiseSize = target - previousBet;
      state.currentBet = target;
      if (raiseSize >= state.minRaise) {
        state.minRaise = raiseSize;
        state.pending = state.players.filter((candidate) => candidate.id !== player.id && !candidate.folded && !candidate.allIn).map((candidate) => candidate.id);
      }
    }
  }
  state.pending = state.pending.filter((id) => id !== player.id);
  const remaining = state.players.filter((candidate) => !candidate.folded);
  if (remaining.length === 1) { uncontested(state, remaining[0]); return; }
  if (state.pending.length === 0) { advanceStreet(state); return; }
  state.actorIndex = nextIndex(state, index, (candidate) => state.pending.includes(candidate.id) && !candidate.folded && !candidate.allIn);
  if (state.actorIndex < 0) advanceStreet(state);
}

export function publicState(state: RoomState, version: number, token: string) {
  const me = state.players.find((player) => player.token === token);
  if (!me) throw new Error('无效的玩家凭证');
  const reveal = state.phase === 'showdown';
  return {
    ...state,
    version,
    meId: me.id,
    deck: undefined,
    players: state.players.map(({ token: _token, ...player }) => ({
      ...player,
      hole: player.id === me.id || (reveal && !player.folded) ? player.hole : player.hole.map(() => 'XX'),
    })),
  };
}

