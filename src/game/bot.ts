import { Board, Card, GameState, Player, AILevel, AdaptiveMemory } from './types';
import {
  visibleCardValueAt, highestVisibleIndex, hiddenIndices,
  revealedIndices, getVisibleValues, getVisibleScore,
} from './board';

export interface BotDecision {
  source: 'discard' | 'deck';
  placeIndex: number | null;
  flipIndex: number | null;
  reason: string;
}

export interface BotPlacement {
  place: boolean;
  placeIndex: number | null;
  flipIndex: number | null;
  reason: string;
}

// Calcula la media real de puntos de las cartas que quedan sin revelar en la partida
function getRemainingDeckAverage(state: GameState): number {
  const counts: Record<number, number> = {
    [-2]: 5, [-1]: 10, [0]: 15,
    [1]: 10, [2]: 10, [3]: 10, [4]: 10, [5]: 10, [6]: 10,
    [7]: 10, [8]: 10, [9]: 10, [10]: 10, [11]: 10, [12]: 10,
  };

  for (const [valStr, seen] of Object.entries(state.discardCounts || {})) {
    const val = Number(valStr);
    if (counts[val] !== undefined) {
      counts[val] = Math.max(0, counts[val] - seen);
    }
  }

  let totalCards = 0;
  let totalPoints = 0;
  for (const [valStr, rem] of Object.entries(counts)) {
    totalCards += rem;
    totalPoints += Number(valStr) * rem;
  }

  return totalCards > 0 ? totalPoints / totalCards : 5.3;
}

// Detecta si hay 2 cartas reveladas iguales al valor buscado en una columna,
// sin importar si la 3ª carta está boca abajo O boca arriba con otro número
function findColumnCompletion(board: Board, value: number): number | null {
  for (let col = 0; col < 4; col++) {
    const cells = [col, col + 4, col + 8];
    let matches = 0;
    let targetIdx: number | null = null;
    let valid = true;

    for (const i of cells) {
      const c = board[i];
      if (c.eliminated) {
        valid = false;
        break;
      }
      if (c.revealed && c.card && c.card.value === value) {
        matches++;
      } else {
        targetIdx = i;
      }
    }

    if (valid && matches === 2 && targetIdx !== null) {
      return targetIdx;
    }
  }
  return null;
}

// Devuelve los índices de cartas que ya forman pareja en una columna para no romperlas
function getProtectedIndices(board: Board): Set<number> {
  const protectedSet = new Set<number>();
  for (let col = 0; col < 4; col++) {
    const cells = [col, col + 4, col + 8];
    if (cells.some(i => board[i].eliminated)) continue;

    const revealed = cells.filter(i => board[i].revealed && board[i].card !== null);
    if (revealed.length >= 2) {
      for (let a = 0; a < revealed.length; a++) {
        for (let b = a + 1; b < revealed.length; b++) {
          if (board[revealed[a]].card!.value === board[revealed[b]].card!.value) {
            protectedSet.add(revealed[a]);
            protectedSet.add(revealed[b]);
          }
        }
      }
    }
  }
  return protectedSet;
}

// Busca la carta visible más alta evitando romper parejas (salvo si no queda otra opción)
function safeHighestVisibleIndex(board: Board): number | null {
  const protectedSet = getProtectedIndices(board);
  let bestIdx: number | null = null;
  let bestVal = -Infinity;

  for (let i = 0; i < board.length; i++) {
    const c = board[i];
    if (!c.eliminated && c.revealed && c.card && !protectedSet.has(i)) {
      if (c.card.value > bestVal) {
        bestVal = c.card.value;
        bestIdx = i;
      }
    }
  }

  if (bestIdx !== null) return bestIdx;
  return highestVisibleIndex(board);
}

// Busca si la carta robada puede hacer pareja con una carta alta/media suelta en una columna con cartas ocultas
function findPairOpportunity(board: Board, value: number, state: GameState): number | null {
  if (value < 4) return null;

  const seenOnTable = state.discardCounts[value] || 0;
  const totalOfValue = value <= -1 ? (value === -2 ? 5 : 10) : value === 0 ? 15 : 10;
  if (totalOfValue - seenOnTable <= 1) return null;

  for (let col = 0; col < 4; col++) {
    const cells = [col, col + 4, col + 8];
    if (cells.some(i => board[i].eliminated)) continue;

    const revealed = cells.filter(i => board[i].revealed && board[i].card !== null);
    const hidden = cells.filter(i => !board[i].revealed);

    if (revealed.length === 1 && hidden.length >= 1 && board[revealed[0]].card!.value === value) {
      return hidden[0];
    }
  }
  return null;
}

function findColumnWithTwoSameVisible(board: Board): { col: number; flipIdx: number } | null {
  for (let col = 0; col < 4; col++) {
    const cells = [col, col + 4, col + 8];
    const vals: number[] = [];
    let hiddenIdx: number | null = null;
    let valid = true;
    for (const i of cells) {
      const c = board[i];
      if (c.eliminated) { valid = false; break; }
      if (!c.revealed || !c.card) { if (hiddenIdx === null) hiddenIdx = i; continue; }
      vals.push(c.card.value);
    }
    if (!valid) continue;
    const counts: Record<number, number> = {};
    for (const v of vals) counts[v] = (counts[v] || 0) + 1;
    if (Object.values(counts).some(c => c >= 2) && hiddenIdx !== null) {
      return { col, flipIdx: hiddenIdx };
    }
  }
  return null;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// EASY: relaxed, sometimes takes high cards, random flips
function decideEasyMove(board: Board, topDiscard: Card | null): BotDecision {
  if (topDiscard) {
    if (topDiscard.value <= 5 && Math.random() < 0.5) {
      const hi = highestVisibleIndex(board);
      if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > topDiscard.value) {
        return { source: 'discard', placeIndex: hi, flipIndex: null, reason: 'Coge descarte' };
      }
      const hidden = hiddenIndices(board);
      if (hidden.length > 0) {
        return { source: 'discard', placeIndex: pickRandom(hidden), flipIndex: null, reason: 'Coge descarte, cambia oculta' };
      }
    }
  }
  return { source: 'deck', placeIndex: null, flipIndex: null, reason: 'Roba del mazo' };
}

function decideEasyPlacement(board: Board, drawnValue: number): BotPlacement {
  const compIdx = findColumnCompletion(board, drawnValue);
  if (compIdx !== null && Math.random() < 0.7) {
    return { place: true, placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
  }
  if (drawnValue <= 5) {
    const hi = highestVisibleIndex(board);
    if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > drawnValue) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Sustituye alta' };
    }
    const hidden = hiddenIndices(board);
    if (hidden.length > 0 && Math.random() < 0.6) {
      return { place: true, placeIndex: pickRandom(hidden), flipIndex: null, reason: 'En oculta' };
    }
  }
  const hidden = hiddenIndices(board);
  if (hidden.length > 0) {
    return { place: false, placeIndex: null, flipIndex: pickRandom(hidden), reason: 'Descarta, voltea' };
  }
  const hi = highestVisibleIndex(board);
  if (hi !== null) return { place: true, placeIndex: hi, flipIndex: null, reason: 'Forzado' };
  const rev = revealedIndices(board);
  return rev.length > 0 ? { place: true, placeIndex: rev[0], flipIndex: null, reason: 'Forzado' } : { place: false, placeIndex: null, flipIndex: null, reason: 'Sin acción' };
}

// HARD: strategic with card counting, minimum point gain and closing protection
function decideHardMove(board: Board, topDiscard: Card | null, state: GameState, mem: AdaptiveMemory | null): BotDecision {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;
  const willingToClose = !canCloseNow || !bot || shouldCloseRound(bot, state, mem);

  if (topDiscard) {
    const v = topDiscard.value;
    const compIdx = findColumnCompletion(board, v);
    if (compIdx !== null) {
      const pointsSaved = v * 2;
      if (!canCloseNow || willingToClose || pointsSaved >= 8) {
        return { source: 'discard', placeIndex: compIdx, flipIndex: null, reason: 'Completa columna con descarte' };
      }
    }

    const threshold = mem ? mem.stealThreshold : 3;
    const minGain = hidden.length > 0 ? (v <= 1 ? 2 : 3) : 1;

    if (v <= threshold) {
      const hi = safeHighestVisibleIndex(board);
      const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
      if (hi !== null && hiVal !== null && hiVal - v >= minGain) {
        return { source: 'discard', placeIndex: hi, flipIndex: null, reason: 'Coge descarte barato, quita alta' };
      }
      const visVals = getVisibleValues(board);
      if (visVals.every(val => val <= threshold) && hidden.length > 0 && willingToClose) {
        return { source: 'discard', placeIndex: hidden[0], flipIndex: null, reason: 'Coge descarte, revela oculta' };
      }
    }
  }
  return { source: 'deck', placeIndex: null, flipIndex: null, reason: 'Roba del mazo' };
}

function decideHardPlacement(board: Board, drawnValue: number, state: GameState, mem: AdaptiveMemory | null): BotPlacement {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;
  const willingToClose = !canCloseNow || !bot || shouldCloseRound(bot, state, mem);

  const compIdx = findColumnCompletion(board, drawnValue);
  if (compIdx !== null) {
    return { place: true, placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
  }

  if (canCloseNow && !willingToClose) {
    const hi = safeHighestVisibleIndex(board);
    if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > drawnValue) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Evita cerrar todavía, baja puntos' };
    }
  }

  const minGain = hidden.length > 0 ? (drawnValue <= 2 ? 2 : 3) : 1;

  if (drawnValue <= 4) {
    const hi = safeHighestVisibleIndex(board);
    const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
    if (hi !== null && hiVal !== null && hiVal - drawnValue >= minGain) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Sustituye alta visible' };
    }
    if (hidden.length > 0 && willingToClose && (drawnValue <= 2 || (hiVal !== null && hiVal <= 4))) {
      return { place: true, placeIndex: hidden[0], flipIndex: null, reason: 'Coloca carta baja en oculta' };
    }
    if (hi !== null && hiVal !== null && hiVal > drawnValue && hidden.length === 0) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Coloca en visible' };
    }
  }

  if (hidden.length > 1 || willingToClose) {
    const pairIdx = findPairOpportunity(board, drawnValue, state);
    if (pairIdx !== null && drawnValue <= 8) {
      return { place: true, placeIndex: pairIdx, flipIndex: null, reason: 'Forma pareja para columna' };
    }
  }

  if (hidden.length > 0) {
    if (canCloseNow && !willingToClose) {
      const hi = highestVisibleIndex(board);
      if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > drawnValue) {
        return { place: true, placeIndex: hi, flipIndex: null, reason: 'Retrasa cierre cambiando visible' };
      }
    }

    const twoSame = findColumnWithTwoSameVisible(board);
    if (twoSame && (hidden.length > 1 || willingToClose)) {
      return { place: false, placeIndex: null, flipIndex: twoSame.flipIdx, reason: 'Descarta, voltea columna prometedora' };
    }
    let bestFlip = hidden[0];
    let bestColHigh = -1;
    for (const h of hidden) {
      const col = h % 4;
      const colVals = [col, col + 4, col + 8]
        .filter(i => i !== h)
        .map(i => visibleCardValueAt(board, i))
        .filter(v => v !== null) as number[];
      if (colVals.length > 0) {
        const maxCol = Math.max(...colVals);
        if (maxCol > bestColHigh) { bestColHigh = maxCol; bestFlip = h; }
      }
    }
    return { place: false, placeIndex: null, flipIndex: bestFlip, reason: 'Descarta, voltea estratégico' };
  }

  const hi = safeHighestVisibleIndex(board);
  if (hi !== null) return { place: true, placeIndex: hi, flipIndex: null, reason: 'Forzado' };
  const rev = revealedIndices(board);
  return rev.length > 0 ? { place: true, placeIndex: rev[0], flipIndex: null, reason: 'Forzado' } : { place: false, placeIndex: null, flipIndex: null, reason: 'Sin acción' };
}

// ADAPTIVE: aprende del estilo del jugador, controla riesgo de cierre y exige ganancia real al cambiar
function decideAdaptiveMove(board: Board, topDiscard: Card | null, state: GameState, mem: AdaptiveMemory): BotDecision {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;
  const willingToClose = !canCloseNow || !bot || shouldCloseRound(bot, state, mem);

  if (topDiscard) {
    const v = topDiscard.value;
    const compIdx = findColumnCompletion(board, v);
    if (compIdx !== null) {
      const pointsSaved = v * 2;
      if (!canCloseNow || willingToClose || pointsSaved >= 8) {
        return { source: 'discard', placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
      }
    }

    const effectiveThreshold = mem.playerColumnFocus >= 2 ? Math.max(mem.stealThreshold, 3.5) : mem.stealThreshold;
    const minGain = hidden.length > 0 ? (v <= 1 ? 2 : 3) : 1;

    if (v <= effectiveThreshold) {
      const hi = safeHighestVisibleIndex(board);
      const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
      if (hi !== null && hiVal !== null && hiVal - v >= minGain) {
        return { source: 'discard', placeIndex: hi, flipIndex: null, reason: 'Coge descarte adaptado' };
      }
      if (hidden.length > 0 && willingToClose && mem.level >= 2 && v <= 2) {
        return { source: 'discard', placeIndex: hidden[0], flipIndex: null, reason: 'Cierra o avanza con carta baja' };
      }
    }
  }
  return { source: 'deck', placeIndex: null, flipIndex: null, reason: 'Roba del mazo' };
}

function decideAdaptivePlacement(board: Board, drawnValue: number, state: GameState, mem: AdaptiveMemory): BotPlacement {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;
  const willingToClose = !canCloseNow || !bot || shouldCloseRound(bot, state, mem);

  const compIdx = findColumnCompletion(board, drawnValue);
  if (compIdx !== null) {
    return { place: true, placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
  }

  if (canCloseNow && !willingToClose) {
    const hi = safeHighestVisibleIndex(board);
    if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > drawnValue) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Evita cerrar todavía, baja puntos' };
    }
  }

  const minGain = hidden.length > 0 ? (drawnValue <= 2 ? 2 : 3) : 1;
  const maxAcceptable = mem.level >= 3 ? 4 : 5;

  if (drawnValue <= maxAcceptable) {
    const hi = safeHighestVisibleIndex(board);
    const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
    if (hi !== null && hiVal !== null && hiVal - drawnValue >= minGain) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Sustituye alta con buen margen' };
    }
    if (hidden.length > 0 && willingToClose && (drawnValue <= 2 || (hiVal !== null && hiVal <= 4))) {
      return { place: true, placeIndex: hidden[0], flipIndex: null, reason: 'Coloca carta baja en oculta' };
    }
    if (hi !== null && hiVal !== null && hiVal > drawnValue && hidden.length === 0) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Sustituye visible' };
    }
  }

  if (mem.level >= 2 && (hidden.length > 1 || willingToClose)) {
    const pairIdx = findPairOpportunity(board, drawnValue, state);
    if (pairIdx !== null && drawnValue <= 8) {
      return { place: true, placeIndex: pairIdx, flipIndex: null, reason: 'Busca pareja para columna' };
    }
  }

  if (hidden.length > 0) {
    if (canCloseNow && !willingToClose) {
      const hi = highestVisibleIndex(board);
      if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > drawnValue) {
        return { place: true, placeIndex: hi, flipIndex: null, reason: 'Retrasa cierre cambiando visible' };
      }
    }

    const twoSame = findColumnWithTwoSameVisible(board);
    if (twoSame && (hidden.length > 1 || willingToClose)) {
      return { place: false, placeIndex: null, flipIndex: twoSame.flipIdx, reason: 'Voltea columna prometedora' };
    }
    if (mem.level >= 2) {
      let bestFlip = hidden[0];
      let bestColHigh = -1;
      for (const h of hidden) {
        const col = h % 4;
        const colVals = [col, col + 4, col + 8]
          .filter(i => i !== h)
          .map(i => visibleCardValueAt(board, i))
          .filter(v => v !== null) as number[];
        if (colVals.length > 0) {
          const maxCol = Math.max(...colVals);
          if (maxCol > bestColHigh) { bestColHigh = maxCol; bestFlip = h; }
        }
      }
      return { place: false, placeIndex: null, flipIndex: bestFlip, reason: 'Descarta, voltea estratégico' };
    }
    return { place: false, placeIndex: null, flipIndex: pickRandom(hidden), reason: 'Descarta, voltea' };
  }

  const hi = safeHighestVisibleIndex(board);
  if (hi !== null) return { place: true, placeIndex: hi, flipIndex: null, reason: 'Forzado' };
  const rev = revealedIndices(board);
  return rev.length > 0 ? { place: true, placeIndex: rev[0], flipIndex: null, reason: 'Forzado' } : { place: false, placeIndex: null, flipIndex: null, reason: 'Sin acción' };
}

export function shouldCloseRound(
  bot: Player,
  state: GameState,
  mem: AdaptiveMemory | null
): boolean {
  const myVisible = getVisibleScore(bot.board);
  const myHidden = hiddenIndices(bot.board).length;
  if (myHidden === 0) return true;

  const deckAvg = getRemainingDeckAverage(state);
  const estimatedTotal = myVisible + myHidden * deckAvg;

  const tolerance = mem ? mem.closeRiskTolerance : 0.3;
  const safetyBuffer = tolerance < 0.35 ? 4 : tolerance < 0.6 ? 2.5 : 1.5;

  const opponents = state.players.filter(p => p.id !== bot.id);
  for (const opp of opponents) {
    const oppVisible = getVisibleScore(opp.board);
    const oppHidden = hiddenIndices(opp.board).length;
    const oppEstimate = oppVisible + oppHidden * deckAvg;

    if (estimatedTotal + safetyBuffer >= oppEstimate) {
      return false;
    }
  }

  return true;
}

export function decideBotMove(
  board: Board,
  topDiscard: Card | null,
  state: GameState,
  level: AILevel,
  mem: AdaptiveMemory | null
): BotDecision {
  if (level === 'easy') return decideEasyMove(board, topDiscard);
  if (level === 'hard') return decideHardMove(board, topDiscard, state, mem);
  return decideAdaptiveMove(board, topDiscard, state, mem!);
}

export function decideBotPlacement(
  board: Board,
  drawnValue: number,
  state: GameState,
  level: AILevel,
  mem: AdaptiveMemory | null
): BotPlacement {
  if (level === 'easy') return decideEasyPlacement(board, drawnValue);
  if (level === 'hard') return decideHardPlacement(board, drawnValue, state, mem);
  return decideAdaptivePlacement(board, drawnValue, state, mem!);
}