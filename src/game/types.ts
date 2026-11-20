export type AILevel = 'easy' | 'hard' | 'adaptive';

export interface GameConfig {
  playerCount: number; // 2, 3, 4
  aiLevel: AILevel;
}

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  board: Board;
  score: number; // cumulative game score
}

export type Phase =
  | 'reveal_initial'
  | 'playing'
  | 'end_routine'
  | 'game_over';

export type Stage =
  | 'choose_source'
  | 'must_place'
  | 'discard_then_flip'
  | 'bot_thinking'
  | 'idle';

export type Direction = 'from_descarte' | 'from_mazo';

export interface Card {
  id: string;
  value: number;
}

export interface Cell {
  card: Card | null;
  revealed: boolean;
  eliminated: boolean;
}

export type Board = Cell[]; // 12 cells (3 rows x 4 cols)

export interface PendingDraw {
  card: Card;
  source: Direction;
}

export interface BotHighlight {
  player: string;
  index: number;
  action: 'take' | 'place' | 'flip';
}

export interface GameState {
  config: GameConfig;
  players: Player[];
  deck: Card[];
  discard: Card[];
  phase: Phase;
  stage: Stage;
  currentPlayerIndex: number;
  pendingDraw: PendingDraw | null;
  lastAction: string;
  lastRoundTriggered: boolean;
  lastRoundCloser: string | null;
  lastRoundRemaining: string[]; // who still plays
  remainingFinalTurns: number; // explicit counter of final turns left
  initialRevealed: Record<string, number>;
  pendingHighlight: BotHighlight | null;
  roundNumber: number;
  turnOrder: string[]; // player ids in order
  discardCounts: Record<number, number>; // value -> count seen on table
  discardPulse: boolean; // brief animation flag when a card is discarded
}

export interface RoundPlayerResult {
  id: string;
  name: string;
  isBot: boolean;
  roundScore: number;
  finalScore: number;
  doubled: boolean;
  eliminated: number;
  closed: boolean;
}

export interface RoundResult {
  players: RoundPlayerResult[];
  closer: string;
  isFinal: boolean;
  winner: string | null;
}

export interface AdaptiveMemory {
  level: number;
  roundsPlayed: number;
  playerClosesEarly: number; // count
  playerClosesLate: number;
  playerColumnFocus: number; // times player eliminated columns
  stealThreshold: number; // dynamic: discard take threshold
  closeRiskTolerance: number; // dynamic
  gamesPlayed: number;
}

export const BOT_NAMES = ['Ana', 'Leo', 'Max'];
export const BOT_IDS = ['bot_ana', 'bot_leo', 'bot_max'];
export const PLAYER_ID = 'player';
