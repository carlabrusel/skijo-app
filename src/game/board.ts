import { Board, Card, Cell } from './types';

export function emptyBoard(): Board {
  return Array.from({ length: 12 }, () => ({ card: null, revealed: false, eliminated: false }));
}

export function dealCardsToBoard(board: Board, cards: Card[]): Board {
  const b = board.map(c => ({ ...c }));
  for (let i = 0; i < 12 && i < cards.length; i++) {
    b[i] = { card: cards[i], revealed: false, eliminated: false };
  }
  return b;
}

export function allRevealed(board: Board): boolean {
  return board.every(c => c.revealed || c.eliminated);
}

export function effectiveCardPoints(card: Card | null): number {
  if (!card) return 0;
  if (card.kind === 'star' || card.kind === 'action') return 0;
  return card.value;
}

export function getVisibleScore(board: Board): number {
  return board.reduce((sum, c) => {
    if (c.eliminated || !c.revealed) return sum;
    return sum + effectiveCardPoints(c.card);
  }, 0);
}

export function getFullScore(board: Board): number {
  return board.reduce((sum, c) => {
    if (c.eliminated) return sum;
    return sum + effectiveCardPoints(c.card);
  }, 0);
}

export function countEliminated(board: Board): number {
  return board.filter(c => c.eliminated).length;
}

export function findEliminableColumns(board: Board): number[] {
  const cols: number[] = [];
  for (let col = 0; col < 4; col++) {
    const cells = [col, col + 4, col + 8];
    const allRevealedCol = cells.every(i => {
      const c = board[i];
      return c.revealed && c.card !== null && !c.eliminated;
    });
    if (!allRevealedCol) continue;

    const cards = cells.map(i => board[i].card!);
    // Cartas de acción nunca forman columna
    if (cards.some(c => c.kind === 'action')) continue;

    const nonStars = cards.filter(c => c.kind !== 'star');
    if (nonStars.length === 0) {
      // 3 estrellas juntas eliminan columna
      cols.push(col);
      continue;
    }
    const targetVal = nonStars[0].value;
    if (nonStars.every(c => c.value === targetVal)) {
      cols.push(col);
    }
  }
  return cols;
}

export function eliminateColumns(board: Board, cols: number[]): { board: Board; eliminatedCards: Cell[] } {
  const b = board.map(c => ({ ...c }));
  const eliminatedCards: Cell[] = [];
  for (const col of cols) {
    for (const i of [col, col + 4, col + 8]) {
      if (b[i].card && !b[i].eliminated) {
        eliminatedCards.push({ ...b[i] });
        b[i] = { card: null, revealed: false, eliminated: true };
      }
    }
  }
  return { board: b, eliminatedCards };
}

export function visibleCardValueAt(board: Board, idx: number): number | null {
  const c = board[idx];
  if (!c.revealed || !c.card || c.eliminated) return null;
  return effectiveCardPoints(c.card);
}

export function isStarAt(board: Board, idx: number): boolean {
  const c = board[idx];
  return Boolean(c.revealed && c.card && !c.eliminated && c.card.kind === 'star');
}

export function highestVisibleIndex(board: Board): number | null {
  let best: number | null = null;
  let bestVal = -Infinity;
  for (let i = 0; i < 12; i++) {
    const v = visibleCardValueAt(board, i);
    if (v !== null && v > bestVal) {
      bestVal = v;
      best = i;
    }
  }
  return best;
}

export function hiddenIndices(board: Board): number[] {
  const r: number[] = [];
  for (let i = 0; i < 12; i++) {
    if (!board[i].eliminated && !board[i].revealed && board[i].card) r.push(i);
  }
  return r;
}

export function revealedIndices(board: Board): number[] {
  const r: number[] = [];
  for (let i = 0; i < 12; i++) {
    if (!board[i].eliminated && board[i].revealed && board[i].card) r.push(i);
  }
  return r;
}

export function getVisibleValues(board: Board): number[] {
  return revealedIndices(board).map(i => visibleCardValueAt(board, i)!);
}