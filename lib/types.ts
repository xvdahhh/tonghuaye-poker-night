export type Phase = 'lobby' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type ActionKind = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export type ActionLogEntry = {
  id: string;
  handNo: number;
  at: number;
  text: string;
};

export type Player = {
  id: string;
  token: string;
  reconnectCode?: string;
  name: string;
  stack: number;
  hole: string[];
  folded: boolean;
  allIn: boolean;
  leaving?: boolean;
  waitingForNextHand?: boolean;
  bet: number;
  totalBet: number;
};

export type Winner = {
  playerId: string;
  amount: number;
  hand: string;
};

export type RoomState = {
  code: string;
  phase: Phase;
  handNo: number;
  hostId: string;
  players: Player[];
  dealerIndex: number;
  actorIndex: number;
  deck: string[];
  community: string[];
  pot: number;
  currentBet: number;
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  pending: string[];
  raiseRights?: string[];
  winners: Winner[];
  message: string;
  turnDurationMs?: number;
  turnDeadlineAt?: number;
  actionLog?: ActionLogEntry[];
};

export type ClientPlayer = Omit<Player, 'token' | 'reconnectCode'> & {
  online: boolean;
};

export type ClientRoom = Omit<RoomState, 'deck' | 'players'> & {
  players: ClientPlayer[];
  version: number;
  meId: string;
  myReconnectCode: string;
  turnDurationMs: number;
  turnDeadlineAt?: number;
  actionLog: ActionLogEntry[];
};
