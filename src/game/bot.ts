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

// Detecta si hay 2 cartas reveladas iguales al valor buscado en una columna
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

// Devuelve los índices de cartas que ya forman pareja en una columna para no romperlas jamás
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

// Busca la carta visible más alta evitando romper parejas
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

  return bestIdx;
}

// Busca si la carta robada puede hacer pareja con una carta suelta en una columna con cartas ocultas
function findPairOpportunity(board: Board, value: number, state: GameState): number | null {
  // Solo merece la pena buscar pareja si el valor no es negativo (en negativos ya suman bien)
  if (value < 0) return null;

  const seenOnTable = state.discardCounts[value] || 0;
  const totalOfValue = value === 0 ? 15 : 10;
  if (totalOfValue - seenOnTable <= 1) return null;

  for (let col = 0; col < 4; col++) {
    const cells = [col, col + 4, col + 8];
    if (cells.some(i => board[i].eliminated)) continue;

    const revealed = cells.filter(i => board[i].revealed && board[i].card !== null);
    const hidden = cells.filter(i => !board[i].revealed);

    // Si hay exactamente 1 revelada igual a nuestra carta y al menos 1 oculta, ponemos la pareja en una oculta
    if (revealed.length === 1 && hidden.length >= 1 && board[revealed[0]].card!.value === value) {
      return hidden[0];
    }
  }
  return null;
}

// Detecta una columna que ya tiene 2 cartas iguales boca arriba y la 3ª boca abajo
function findColumnWithTwoSameVisible(board: Board): { col: number; flipIdx: number; pairValue: number } | null {
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
    if (!valid || vals.length !== 2 || hiddenIdx === null) continue;
    if (vals[0] === vals[1]) {
      return { col, flipIdx: hiddenIdx, pairValue: vals[0] };
    }
  }
  return null;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// EASY: juega relajado pero sin hacer cambios absurdos de 1 punto
function decideEasyMove(board: Board, topDiscard: Card | null): BotDecision {
  if (topDiscard) {
    const compIdx = findColumnCompletion(board, topDiscard.value);
    if (compIdx !== null && Math.random() < 0.75) {
      return { source: 'discard', placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
    }
    if (topDiscard.value <= 3 && Math.random() < 0.45) {
      const hi = safeHighestVisibleIndex(board);
      const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
      if (hi !== null && hiVal !== null && hiVal >= 6 && hiVal - topDiscard.value >= 4) {
        return { source: 'discard', placeIndex: hi, flipIndex: null, reason: 'Coge descarte' };
      }
    }
  }
  return { source: 'deck', placeIndex: null, flipIndex: null, reason: 'Roba del mazo' };
}

function decideEasyPlacement(board: Board, drawnValue: number): BotPlacement {
  const compIdx = findColumnCompletion(board, drawnValue);
  if (compIdx !== null && Math.random() < 0.8) {
    return { place: true, placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
  }
  if (drawnValue <= 3) {
    const hi = safeHighestVisibleIndex(board);
    const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
    // No cambia cartas ya buenas (<= 4) ni hace cambios de 1 punto
    if (hi !== null && hiVal !== null && hiVal >= 5 && hiVal - drawnValue >= 3) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Sustituye alta' };
    }
  }
  const hidden = hiddenIndices(board);
  if (hidden.length > 0) {
    return { place: false, placeIndex: null, flipIndex: pickRandom(hidden), reason: 'Descarta, voltea' };
  }
  const hi = safeHighestVisibleIndex(board) ?? highestVisibleIndex(board);
  if (hi !== null) return { place: true, placeIndex: hi, flipIndex: null, reason: 'Forzado' };
  const rev = revealedIndices(board);
  return rev.length > 0 ? { place: true, placeIndex: rev[0], flipIndex: null, reason: 'Forzado' } : { place: false, placeIndex: null, flipIndex: null, reason: 'Sin acción' };
}

// HARD: protege cartas <= 4, exige ganancia real (>= 4 pts) y prioriza columnas
function decideHardMove(board: Board, topDiscard: Card | null, state: GameState, mem: AdaptiveMemory | null): BotDecision {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;
  const willingToClose = !canCloseNow || !bot || shouldCloseRound(bot, state, mem);

  if (topDiscard) {
    const v = topDiscard.value;
    // 1. Si el descarte completa una columna de 3 iguales, cogerlo siempre (salvo cierre suicida de columna de 0s)
    const compIdx = findColumnCompletion(board, v);
    if (compIdx !== null) {
      const pointsSaved = v * 2;
      if (!canCloseNow || willingToClose || pointsSaved >= 6) {
        return { source: 'discard', placeIndex: compIdx, flipIndex: null, reason: 'Completa columna con descarte' };
      }
    }

    // 2. Si el descarte forma una pareja con una carta suelta (ej. otro 7 o 0) en columna con ocultas
    if (hidden.length > 1 || willingToClose) {
      const pairIdx = findPairOpportunity(board, v, state);
      if (pairIdx !== null && v <= 5) {
        return { source: 'discard', placeIndex: pairIdx, flipIndex: null, reason: 'Forma pareja con descarte' };
      }
    }

    // 3. Solo coger del descarte para bajar puntos si la carta es <= 2 y quita una carta de al menos 6 puntos (ganancia >= 4)
    const threshold = mem ? Math.min(mem.stealThreshold, 2) : 2;
    if (v <= threshold) {
      const hi = safeHighestVisibleIndex(board);
      const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
      const minGain = hidden.length > 0 ? 4 : 1;
      if (hi !== null && hiVal !== null && (hidden.length === 0 || hiVal >= 5) && hiVal - v >= minGain) {
        return { source: 'discard', placeIndex: hi, flipIndex: null, reason: 'Coge descarte barato, quita alta' };
      }
      const visVals = getVisibleValues(board);
      if (visVals.every(val => val <= 3) && hidden.length > 0 && willingToClose && v <= 1) {
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

  // 1. Prioridad máxima: completar columna de 3 iguales
  const compIdx = findColumnCompletion(board, drawnValue);
  if (compIdx !== null) {
    return { place: true, placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
  }

  // 2. Si estamos a 1 carta de cerrar pero aún no conviene cerrar, sustituir una visible alta sin voltear la última oculta
  if (canCloseNow && !willingToClose) {
    const hi = safeHighestVisibleIndex(board) ?? highestVisibleIndex(board);
    if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > drawnValue) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Evita cerrar todavía, baja puntos' };
    }
  }

  // 3. Si es una carta negativa (-2 o -1), sí merece la pena cambiar incluso un 3 o 4
  if (drawnValue <= -1) {
    const hi = safeHighestVisibleIndex(board);
    const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
    if (hi !== null && hiVal !== null && hiVal >= 3) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Coloca negativa por carta media/alta' };
    }
    if (hidden.length > 0 && willingToClose) {
      return { place: true, placeIndex: hidden[0], flipIndex: null, reason: 'Coloca negativa en oculta' };
    }
  }

  // 4. Para cartas bajas (0, 1, 2, 3): NO tocar cartas que ya sean <= 4 (como cambiar un 4 por un 3)
  // Solo sustituir cartas >= 5 con una ganancia mínima de 4 puntos (ej. cambiar un 7 por un 3, o un 6 por un 2)
  if (drawnValue <= 3) {
    const hi = safeHighestVisibleIndex(board);
    const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
    const minGain = hidden.length > 0 ? 4 : 1;

    if (hi !== null && hiVal !== null && (hidden.length === 0 || hiVal >= 5) && hiVal - drawnValue >= minGain) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Sustituye alta visible con margen' };
    }

    // Si tiene una pareja pendiente en una columna, priorizar descartar y voltear esa columna antes que gastar un 2 o 3 en una oculta al azar
    const twoSame = findColumnWithTwoSameVisible(board);
    if (twoSame && drawnValue >= 1 && (hidden.length > 1 || willingToClose)) {
      return { place: false, placeIndex: null, flipIndex: twoSame.flipIdx, reason: 'Descarta para intentar cerrar columna' };
    }

    if (hidden.length > 0 && willingToClose && drawnValue <= 1) {
      return { place: true, placeIndex: hidden[0], flipIndex: null, reason: 'Coloca 0 o 1 en oculta' };
    }
  }

  // 5. Formar pareja de columna (incluso con 0, 1, 2, 3, 4, 5, 6, 7) si hay ocultas en esa columna
  if (hidden.length > 1 || willingToClose) {
    const pairIdx = findPairOpportunity(board, drawnValue, state);
    if (pairIdx !== null && drawnValue <= 7) {
      return { place: true, placeIndex: pairIdx, flipIndex: null, reason: 'Forma pareja para columna' };
    }
  }

  // 6. Descartar la robada y voltear una carta oculta estratégicamente
  if (hidden.length > 0) {
    if (canCloseNow && !willingToClose) {
      const hi = safeHighestVisibleIndex(board) ?? highestVisibleIndex(board);
      if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > drawnValue) {
        return { place: true, placeIndex: hi, flipIndex: null, reason: 'Retrasa cierre cambiando visible' };
      }
    }

    // Prioridad absoluta al voltear: destapar la 3ª carta de una columna que ya tiene pareja
    const twoSame = findColumnWithTwoSameVisible(board);
    if (twoSame && (hidden.length > 1 || willingToClose)) {
      return { place: false, placeIndex: null, flipIndex: twoSame.flipIdx, reason: 'Descarta, voltea columna con pareja' };
    }

    // Si no hay pareja, voltear en la columna que tenga la carta visible más alta (por si sale igual o para saber qué cambiar)
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

  // 7. Si ya no quedan cartas ocultas (último turno forzado)
  const hi = safeHighestVisibleIndex(board) ?? highestVisibleIndex(board);
  if (hi !== null) return { place: true, placeIndex: hi, flipIndex: null, reason: 'Forzado' };
  const rev = revealedIndices(board);
  return rev.length > 0 ? { place: true, placeIndex: rev[0], flipIndex: null, reason: 'Forzado' } : { place: false, placeIndex: null, flipIndex: null, reason: 'Sin acción' };
}

// ADAPTIVE: usa la misma protección de cartas <= 4 y columnas, ajustando umbral y riesgo con memoria
function decideAdaptiveMove(board: Board, topDiscard: Card | null, state: GameState, mem: AdaptiveMemory): BotDecision {
  return decideHardMove(board, topDiscard, state, mem);
}

function decideAdaptivePlacement(board: Board, drawnValue: number, state: GameState, mem: AdaptiveMemory): BotPlacement {
  return decideHardPlacement(board, drawnValue, state, mem);
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