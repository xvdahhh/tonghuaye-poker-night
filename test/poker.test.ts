import assert from 'node:assert/strict';
import test from 'node:test';
import {
  act,
  applyTurnTimeout,
  configureTable,
  joinRoom,
  leaveRoom,
  newRoom,
  publicState,
  reconnectPlayer,
  setPlayerParticipation,
  startHand,
  transferHostIfNeeded,
  upgradeRoomState,
} from '../lib/poker.ts';
import type { Player, RoomState } from '../lib/types.ts';

const BOARD = ['2s', '3h', '7d', '9c', 'Jc'];

function player(
  id: string,
  hole: string[],
  totalBet: number,
  options: Partial<Player> = {},
): Player {
  return {
    id,
    token: id,
    name: id,
    stack: 0,
    hole,
    folded: false,
    allIn: false,
    leaving: false,
    bet: totalBet,
    totalBet,
    ...options,
  };
}

function room(players: Player[], options: Partial<RoomState> = {}): RoomState {
  const actorIndex = options.actorIndex ?? players.length - 1;
  return {
    code: 'TEST',
    phase: 'river',
    handNo: 1,
    hostId: players[0].id,
    players,
    dealerIndex: 0,
    actorIndex,
    deck: [],
    community: [...BOARD],
    pot: players.reduce((sum, candidate) => sum + candidate.totalBet, 0),
    currentBet: Math.max(0, ...players.map((candidate) => candidate.bet)),
    minRaise: 20,
    smallBlind: 10,
    bigBlind: 20,
    pending: [players[actorIndex].id],
    raiseRights: [players[actorIndex].id],
    winners: [],
    message: '',
    ...options,
  };
}

function payout(state: RoomState) {
  return state.winners.reduce((sum, winner) => sum + winner.amount, 0);
}

test('主池与多出的边池分别发给有资格的最佳牌', () => {
  const players = [
    player('A', ['As', 'Ad'], 50, { allIn: true }),
    player('B', ['Kh', 'Kd'], 100),
    player('C', ['Qh', 'Qd'], 100, { stack: 1 }),
  ];
  const state = room(players, { actorIndex: 2 });

  act(state, players[2], 'check');

  assert.deepEqual(state.winners, [
    { playerId: 'A', amount: 150, hand: '一对' },
    { playerId: 'B', amount: 100, hand: '一对' },
  ]);
  assert.equal(payout(state), 250);
});

test('平分底池的零头给庄家左侧最近的并列赢家', () => {
  const players = [
    player('A', ['As', 'Kd'], 51),
    player('B', ['Ah', 'Kc'], 51),
    player('C', ['Qs', 'Td'], 51, { stack: 1 }),
  ];
  const state = room(players, {
    actorIndex: 2,
    community: ['2s', '2h', '5d', '9c', 'Jc'],
    dealerIndex: 0,
  });

  act(state, players[2], 'check');

  assert.equal(state.winners.find((winner) => winner.playerId === 'B')?.amount, 77);
  assert.equal(state.winners.find((winner) => winner.playerId === 'A')?.amount, 76);
  assert.equal(payout(state), 153);
});

test('未被跟注的筹码先返还，不会把返还者显示成赢家', () => {
  const players = [
    player('A', ['4s', '5s'], 100, { stack: 10 }),
    player('B', ['Ah', 'Ad'], 50, { allIn: true }),
  ];
  const state = room(players, { actorIndex: 0, pending: ['A'], raiseRights: ['A'] });

  act(state, players[0], 'check');

  assert.equal(state.pot, 100);
  assert.equal(players[0].stack, 60);
  assert.deepEqual(state.winners, [{ playerId: 'B', amount: 100, hand: '一对' }]);
  assert.equal(state.message, 'B 赢得底池');
});

test('不足最小加注的全下仍要求已行动玩家补齐差额，但不重开加注权', () => {
  const players = [
    player('A', ['As', 'Ad'], 100, { stack: 900 }),
    player('B', ['Kh', 'Kd'], 100, { stack: 900 }),
    player('C', ['Qh', 'Qd'], 80, { stack: 50 }),
  ];
  const state = room(players, {
    phase: 'preflop',
    actorIndex: 2,
    deck: ['2s', '3h', '7d'],
    community: [],
    pot: 280,
    currentBet: 100,
    minRaise: 80,
    pending: ['C'],
    raiseRights: ['C'],
  });

  act(state, players[2], 'allin');

  assert.equal(state.phase, 'preflop');
  assert.deepEqual(state.pending, ['A', 'B']);
  assert.deepEqual(state.raiseRights, []);
  assert.equal(state.currentBet, 130);
  assert.equal(state.minRaise, 80);
  assert.throws(() => act(state, players[0], 'raise', 210), /下注未重新开放/);

  act(state, players[0], 'call');
  act(state, players[1], 'call');

  assert.equal(state.phase, 'flop');
  assert.equal(state.pot, 390);
  assert.deepEqual(players.map((candidate) => candidate.totalBet), [130, 130, 130]);
});

test('短码全下后，尚未行动的玩家仍然可以完成一次合法加注', () => {
  const players = [
    player('A', ['As', 'Ad'], 100, { stack: 900 }),
    player('B', ['Kh', 'Kd'], 100, { stack: 900 }),
    player('C', ['Qh', 'Qd'], 80, { stack: 50 }),
    player('D', ['Jh', 'Jd'], 100, { stack: 900 }),
  ];
  const state = room(players, {
    phase: 'preflop',
    actorIndex: 2,
    deck: ['2s', '3h', '7d'],
    community: [],
    pot: 380,
    currentBet: 100,
    minRaise: 80,
    pending: ['C', 'D'],
    raiseRights: ['C', 'D'],
  });

  act(state, players[2], 'allin');
  assert.equal(state.players[state.actorIndex].id, 'D');

  act(state, players[3], 'raise', 260);

  assert.equal(state.currentBet, 260);
  assert.equal(state.minRaise, 260);
  assert.deepEqual(state.pending, ['A', 'B']);
  assert.deepEqual(state.raiseRights, ['A', 'B']);
});

test('普通加注至少为当前最高下注两倍，且必须是 10 的整数倍', () => {
  const makeState = () => {
    const players = [
      player('A', ['As', 'Ad'], 100, { stack: 900 }),
      player('B', ['Kh', 'Kd'], 100, { stack: 900 }),
      player('C', ['Qh', 'Qd'], 100, { stack: 900 }),
    ];
    return { players, state: room(players, {
      phase: 'preflop',
      actorIndex: 2,
      deck: ['2s', '3h', '7d'],
      community: [],
      pot: 300,
      currentBet: 100,
      minRaise: 100,
      pending: ['C'],
      raiseRights: ['C'],
    }) };
  };

  const belowDouble = makeState();
  assert.throws(() => act(belowDouble.state, belowDouble.players[2], 'raise', 180), /至少到 200/);

  const notTenMultiple = makeState();
  assert.throws(() => act(notTenMultiple.state, notTenMultiple.players[2], 'raise', 205), /10 的整数倍/);

  const legal = makeState();
  act(legal.state, legal.players[2], 'raise', 210);
  assert.equal(legal.state.currentBet, 210);
  assert.equal(legal.state.minRaise, 210);
  assert.deepEqual(legal.state.pending, ['A', 'B']);
});

test('不足两倍且不是 10 的整数倍时，真实全下仍然允许', () => {
  const players = [
    player('A', ['As', 'Ad'], 100, { stack: 900 }),
    player('B', ['Kh', 'Kd'], 100, { stack: 900 }),
    player('C', ['Qh', 'Qd'], 100, { stack: 55 }),
  ];
  const state = room(players, {
    phase: 'preflop',
    actorIndex: 2,
    deck: ['2s', '3h', '7d'],
    community: [],
    pot: 300,
    currentBet: 100,
    minRaise: 100,
    pending: ['C'],
    raiseRights: ['C'],
  });

  act(state, players[2], 'allin');

  assert.equal(state.currentBet, 155);
  assert.deepEqual(state.pending, ['A', 'B']);
  assert.deepEqual(state.raiseRights, []);
});

test('退出玩家已经投入的筹码保留在底池且全部派发', () => {
  const players = [
    player('A', ['As', 'Ad'], 100, { allIn: true }),
    player('B', ['Kh', 'Kd'], 100, { allIn: true }),
    player('C', ['Qh', 'Qd'], 150, { folded: true, leaving: true }),
    player('D', ['Jh', 'Jd'], 0, { stack: 1000, bet: 0 }),
  ];
  const state = room(players, {
    phase: 'preflop',
    actorIndex: 3,
    deck: [...BOARD],
    community: [],
    pot: 350,
    currentBet: 150,
    pending: ['D'],
    raiseRights: ['D'],
  });

  act(state, players[3], 'fold');

  assert.equal(state.phase, 'showdown');
  assert.equal(state.pot, 350);
  assert.equal(payout(state), 350);
  assert.equal(state.players.some((candidate) => candidate.id === 'C'), false);
  assert.deepEqual(state.winners, [{ playerId: 'A', amount: 350, hand: '一对' }]);
});

test('牌局中新玩家可入座旁观，并在下一手自动参战', () => {
  const players = [
    player('A', ['As', 'Ad'], 20, { stack: 980 }),
    player('B', ['Kh', 'Kd'], 20, { stack: 980 }),
  ];
  const state = room(players, {
    phase: 'flop',
    actorIndex: 0,
    pending: ['A', 'B'],
    raiseRights: ['A', 'B'],
    message: '第 1 手 · 翻牌圈',
  });
  const pendingBeforeJoin = [...state.pending];

  const newcomer = joinRoom(state, 'C');

  assert.equal(newcomer.waitingForNextHand, true);
  assert.equal(newcomer.folded, true);
  assert.deepEqual(newcomer.hole, []);
  assert.deepEqual(state.pending, pendingBeforeJoin);
  assert.equal(state.message, '第 1 手 · 翻牌圈');

  state.phase = 'showdown';
  state.actorIndex = -1;
  state.pending = [];
  state.raiseRights = [];
  startHand(state);

  assert.equal(newcomer.waitingForNextHand, false);
  assert.equal(newcomer.folded, false);
  assert.equal(newcomer.hole.length, 2);
  assert.equal(state.pending.includes(newcomer.id), true);
});

test('等待下手的新玩家退出时立即释放座位', () => {
  const players = [
    player('A', ['As', 'Ad'], 20, { stack: 980 }),
    player('B', ['Kh', 'Kd'], 20, { stack: 980 }),
  ];
  const state = room(players, { phase: 'turn', actorIndex: 0, pending: ['A', 'B'] });
  const newcomer = joinRoom(state, 'C');

  leaveRoom(state, newcomer);

  assert.equal(state.players.some((candidate) => candidate.id === newcomer.id), false);
});

test('行动倒计时结束后，需要跟注的玩家自动弃牌并推进牌局', () => {
  const players = [
    player('A', ['As', 'Ad'], 100, { stack: 900 }),
    player('B', ['Kh', 'Kd'], 50, { stack: 950 }),
    player('C', ['Qh', 'Qd'], 100, { stack: 900 }),
  ];
  const state = room(players, {
    phase: 'preflop',
    actorIndex: 1,
    deck: ['2s', '3h', '7d'],
    community: [],
    currentBet: 100,
    pending: ['B'],
    raiseRights: ['B'],
    turnDurationMs: 30_000,
    turnDeadlineAt: 100,
    actionLog: [],
  });

  assert.equal(applyTurnTimeout(state, 101), true);

  assert.equal(players[1].folded, true);
  assert.equal(state.phase, 'flop');
  assert.equal(state.actionLog?.some((entry) => entry.text === 'B 超时弃牌'), true);
  assert.equal(state.turnDeadlineAt, 30_101);
});

test('没有跟注压力时，行动超时会自动过牌', () => {
  const players = [
    player('A', ['As', 'Ad'], 0, { stack: 1000, bet: 0 }),
    player('B', ['Kh', 'Kd'], 0, { stack: 1000, bet: 0 }),
  ];
  const state = room(players, {
    phase: 'flop', actorIndex: 0, community: ['2s', '3h', '7d'], deck: ['9c'],
    currentBet: 0, pending: ['A', 'B'], raiseRights: ['A', 'B'],
    turnDurationMs: 30_000, turnDeadlineAt: 500, actionLog: [],
  });

  applyTurnTimeout(state, 501);

  assert.equal(state.players[state.actorIndex].id, 'B');
  assert.equal(state.actionLog?.at(-1)?.text, 'A 超时自动过牌');
  assert.equal(state.turnDeadlineAt, 30_501);
});

test('重连码可以在新设备恢复同一座位，并轮换旧设备凭证', () => {
  const created = newRoom('ABC234', 'A');
  const guest = joinRoom(created.state, 'B');
  guest.stack = 777;
  const oldToken = guest.token;
  const recovery = guest.reconnectCode!;

  const recovered = reconnectPlayer(created.state, recovery.toLowerCase());
  const view = publicState(created.state, 2, recovered.token, {
    [created.player.id]: 900,
    [guest.id]: 995,
  }, 1_000);

  assert.equal(recovered.id, guest.id);
  assert.equal(recovered.stack, 777);
  assert.notEqual(recovered.token, oldToken);
  assert.equal(view.myReconnectCode, recovery);
  assert.equal(view.players.find((candidate) => candidate.id === guest.id)?.online, true);
  assert.equal(view.players.find((candidate) => candidate.id === created.player.id)?.online, true);
  assert.equal('token' in view.players[0], false);
  assert.equal('reconnectCode' in view.players[0], false);
});

test('旧房间会补齐重连码、操作记录和行动倒计时', () => {
  const players = [
    player('A', ['As', 'Ad'], 20, { stack: 980 }),
    player('B', ['Kh', 'Kd'], 20, { stack: 980 }),
  ];
  const state = room(players, {
    phase: 'turn', actorIndex: 0, community: ['2s', '3h', '7d', '9c'],
    pending: ['A', 'B'], raiseRights: ['A', 'B'], actionLog: undefined,
    turnDurationMs: undefined, turnDeadlineAt: undefined,
  });

  assert.equal(upgradeRoomState(state, 2_000), true);
  assert.equal(state.players.every((candidate) => candidate.reconnectCode?.length === 12), true);
  assert.deepEqual(state.actionLog, []);
  assert.equal(state.turnDurationMs, 30_000);
  assert.equal(state.turnDeadlineAt, 32_000);
});

test('多种投入与弃牌组合始终保持筹码守恒', () => {
  const values = [0, 1, 2, 5];
  const holes = [['As', 'Ad'], ['Kh', 'Kd'], ['Qh', 'Qd']];
  let checked = 0;

  for (const first of values) for (const second of values) for (const third of values) {
    const totals = [first, second, third];
    const originalPot = first + second + third;
    if (!originalPot) continue;
    for (let mask = 0; mask < 8; mask += 1) {
      const players = totals.map((total, index) => player(String(index), holes[index], total, {
        bet: 0,
        folded: Boolean(mask & (1 << index)),
      }));
      const actorIndex = players.findLastIndex((candidate) => !candidate.folded);
      if (actorIndex < 0) continue;
      players[actorIndex].stack = 1;
      const state = room(players, {
        actorIndex,
        pot: originalPot,
        currentBet: 0,
        pending: [players[actorIndex].id],
        raiseRights: [players[actorIndex].id],
      });
      const initialStacks = state.players.reduce((sum, candidate) => sum + candidate.stack, 0);

      act(state, players[actorIndex], 'check');

      assert.equal(payout(state), state.pot);
      assert.equal(
        state.players.reduce((sum, candidate) => sum + candidate.stack, 0),
        initialStacks + originalPot,
      );
      checked += 1;
    }
  }

  assert.equal(checked, 441);
});

test('房主离线后自动把房主身份交给仍在线的玩家', () => {
  const created = newRoom('ABC234', 'A');
  const guest = joinRoom(created.state, 'B');
  const now = 100_000;

  assert.equal(transferHostIfNeeded(created.state, { [created.player.id]: now - 20_000, [guest.id]: now }, now), true);
  assert.equal(created.state.hostId, guest.id);
  assert.equal(created.state.actionLog?.at(-1)?.text, 'B 已接任房主');
});

test('房主可在第一手前配置买入、盲注和行动时间', () => {
  const created = newRoom('ABC234', 'A');
  const guest = joinRoom(created.state, 'B');

  configureTable(created.state, created.player, {
    buyIn: 5_000,
    bigBlind: 100,
    turnDurationMs: 45_000,
  }, 1_000);

  assert.equal(created.state.buyIn, 5_000);
  assert.equal(created.state.smallBlind, 50);
  assert.equal(created.state.bigBlind, 100);
  assert.equal(created.state.turnDurationMs, 45_000);
  assert.deepEqual(created.state.players.map((candidate) => candidate.stack), [5_000, 5_000]);

  startHand(created.state, 2_000);
  assert.throws(() => configureTable(created.state, guest, { buyIn: 1_000 }), /只有房主/);
  assert.throws(() => configureTable(created.state, created.player, { buyIn: 1_000 }), /第一手开始前/);
});

test('玩家可以暂离，并选择从下一手回到牌桌', () => {
  const created = newRoom('ABC234', 'A');
  const guest = joinRoom(created.state, 'B');
  joinRoom(created.state, 'C');

  setPlayerParticipation(created.state, guest, true, 1_000);
  startHand(created.state, 2_000);

  assert.equal(guest.sittingOut, true);
  assert.equal(guest.hole.length, 0);
  assert.equal(guest.folded, true);

  setPlayerParticipation(created.state, guest, false, 2_100);
  assert.equal(guest.waitingForNextHand, true);
  created.state.phase = 'showdown';
  created.state.actorIndex = -1;
  created.state.pending = [];
  startHand(created.state, 3_000);

  assert.equal(guest.sittingOut, false);
  assert.equal(guest.waitingForNextHand, false);
  assert.equal(guest.hole.length, 2);
});

test('完成的每一手都会保留在整场历史中并隐藏弃牌者底牌', () => {
  const created = newRoom('ABC234', 'A');
  joinRoom(created.state, 'B');
  startHand(created.state, 1_000);
  const actor = created.state.players[created.state.actorIndex];
  const viewer = created.state.players.find((candidate) => candidate.id !== actor.id)!;

  act(created.state, actor, 'fold', undefined, { now: 1_100 });

  assert.equal(created.state.handHistory?.length, 1);
  assert.equal(created.state.handHistory?.[0].actions.at(-1)?.text.includes('赢得'), true);
  const view = publicState(created.state, 2, viewer.token, { [viewer.id]: 1_100 }, 1_100);
  assert.deepEqual(view.handHistory[0].players.find((candidate) => candidate.id === actor.id)?.hole, ['XX', 'XX']);

  startHand(created.state, 2_000);
  assert.equal(created.state.handHistory?.length, 1);
  assert.equal(created.state.actionLog?.[0].text, '第 2 手开始');
});
