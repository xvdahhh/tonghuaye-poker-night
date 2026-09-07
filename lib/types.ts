export type Phase = 'lobby' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type ActionKind = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export type ActionLogEntry = {
  id: string;
  handNo: number;
  at: number;
  text: string;
};

export type TableSettings = {
  buyIn: number;
  smallBlind: number;
  bigBlind: number;
  turnDurationMs: number;
};

export type HandHistoryPlayer = {
  id: string;
  name: string;
  hole: string[];
  folded: boolean;
  totalBet: number;
};

export type HandHistoryEntry = {
  handNo: number;
  startedAt: number;
  completedAt: number;
  dealerId: string;
  community: string[];
  pot: number;
  players: HandHistoryPlayer[];
  winners: Winner[];
  actions: ActionLogEntry[];
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
  sittingOut?: boolean;
  sittingOutNextHand?: boolean;
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
  buyIn?: number;
  smallBlind: number;
  bigBlind: number;
  pending: string[];
  raiseRights?: string[];
  winners: Winner[];
  message: string;
  turnDurationMs?: number;
  turnDeadlineAt?: number;
  actionLog?: ActionLogEntry[];
  handStartedAt?: number;
  handHistory?: HandHistoryEntry[];
};

export type ClientPlayer = Omit<Player, 'token' | 'reconnectCode'> & {
  online: boolean;
};

export type ClientRoom = Omit<RoomState, 'deck' | 'players'> & {
  players: ClientPlayer[];
  version: number;
  meId: string;
  myReconnectCode: string;
  buyIn: number;
  turnDurationMs: number;
  turnDeadlineAt?: number;
  actionLog: ActionLogEntry[];
  handHistory: HandHistoryEntry[];
};
