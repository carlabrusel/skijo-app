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

    const revealed = cells.filter(i => i.revealed && i.card !== null);
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
  if (value < 0) return null;

  const seenOnTable = state.discardCounts[value] || 0;
  const totalOfValue = value === 0 ? 15 : 10;
  if (totalOfValue - seenOnTable <= 1) return null;

  for (let col = 0; col < 4; col++) {
    const cells = [col, col + 4, col + 8];
    if (cells.some(i => board[i].eliminated)) continue;

    const revealed = cells.filter(i => i.revealed && i.card !== null);
    const hidden = cells.filter(i => !i.revealed);

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

// Evalúa si al bot le renta cerrar o si corre riesgo de duplicar (x2) por tener más puntos que el rival
export function shouldCloseRound(
  bot: Player,
  state: GameState,
  mem: AdaptiveMemory | null,
  knownClosingCardValue?: number
): boolean {
  const hidden = hiddenIndices(bot.board);
  if (hidden.length === 0) return true;

  const myVisible = getVisibleScore(bot.board);
  const deckAvg = getRemainingDeckAverage(state);

  // Si ya conocemos la carta con la que cerraría (p.ej. colocando en la última oculta), usamos su valor exacto;
  // si va a voltear a ciegas, asumimos un colchón pesimista por si sale una carta media-alta (deckAvg + 2.5)
  const myHiddenEstimate =
    knownClosingCardValue !== undefined
      ? knownClosingCardValue + (hidden.length - 1) * deckAvg
      : hidden.length * (deckAvg + 2.5);

  const myProjected = myVisible + myHiddenEstimate;

  // Si cierra con 0 o menos puntos, duplicar es 0 o negativo (nunca le perjudica)
  if (myProjected <= 0) return true;

  const tolerance = mem ? mem.closeRiskTolerance : 0.25;
  // Margen de seguridad: el rival aún tiene 1 turno extra tras el cierre para bajar ~3-4 puntos
  const safetyBuffer = tolerance < 0.35 ? 6 : tolerance < 0.6 ? 4.5 : 3;

  const opponents = state.players.filter(p => p.id !== bot.id);
  for (const opp of opponents) {
    const oppVisible = getVisibleScore(opp.board);
    const oppHidden = hiddenIndices(opp.board).length;
    // El rival tiene 1 turno extra para mejorar su tablero antes de contar
    const oppLastTurnDiscount = oppHidden > 0 ? 3 : 1.5;
    const oppEstimate = oppVisible + oppHidden * deckAvg - oppLastTurnDiscount;

    // Si mis puntos proyectados + margen son mayores o iguales que los del rival, NO cerrar (riesgo de x2)
    if (myProjected + safetyBuffer >= oppEstimate) {
      return false;
    }
  }

  return true;
}

// EASY: juega relajado pero tampoco cierra a lo loco si va perdiendo claramente
function decideEasyMove(board: Board, topDiscard: Card | null, state: GameState): BotDecision {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;

  if (topDiscard) {
    const compIdx = findColumnCompletion(board, topDiscard.value);
    if (compIdx !== null) {
      const closes = hidden.includes(compIdx) && canCloseNow;
      if (!closes || !bot || shouldCloseRound(bot, state, null, 0)) {
        return { source: 'discard', placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
      }
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

function decideEasyPlacement(board: Board, drawnValue: number, state: GameState): BotPlacement {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;

  const compIdx = findColumnCompletion(board, drawnValue);
  if (compIdx !== null) {
    const closes = hidden.includes(compIdx) && canCloseNow;
    if (!closes || !bot || shouldCloseRound(bot, state, null, 0)) {
      return { place: true, placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
    }
  }

  // Si le queda 1 sola oculta y NO le renta cerrar, evita voltearla colocando sobre una visible
  if (canCloseNow && bot && !shouldCloseRound(bot, state, null)) {
    const hi = safeHighestVisibleIndex(board) ?? highestVisibleIndex(board);
    if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) >= drawnValue) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Evita cerrar con riesgo de x2' };
    }
  }

  if (drawnValue <= 3) {
    const hi = safeHighestVisibleIndex(board);
    const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
    if (hi !== null && hiVal !== null && hiVal >= 5 && hiVal - drawnValue >= 3) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Sustituye alta' };
    }
  }
  if (hidden.length > 0) {
    return { place: false, placeIndex: null, flipIndex: pickRandom(hidden), reason: 'Descarta, voltea' };
  }
  const hi = safeHighestVisibleIndex(board) ?? highestVisibleIndex(board);
  if (hi !== null) return { place: true, placeIndex: hi, flipIndex: null, reason: 'Forzado' };
  const rev = revealedIndices(board);
  return rev.length > 0 ? { place: true, placeIndex: rev[0], flipIndex: null, reason: 'Forzado' } : { place: false, placeIndex: null, flipIndex: null, reason: 'Sin acción' };
}

// HARD: protege cartas <= 4, exige ganancia real (>= 4 pts), prioriza columnas y evita cerrar si va a duplicar
function decideHardMove(board: Board, topDiscard: Card | null, state: GameState, mem: AdaptiveMemory | null): BotDecision {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;

  if (topDiscard) {
    const v = topDiscard.value;

    // 1. Si el descarte completa una columna de 3 iguales:
    // Si esa casilla era su última oculta, solo cierra si le renta (no duplica) o si elimina muchos puntos
    const compIdx = findColumnCompletion(board, v);
    if (compIdx !== null) {
      const closesRound = hidden.includes(compIdx) && canCloseNow;
      if (!closesRound || !bot || shouldCloseRound(bot, state, mem, 0)) {
        return { source: 'discard', placeIndex: compIdx, flipIndex: null, reason: 'Completa columna con descarte' };
      }
    }

    // 2. Si el descarte forma una pareja con una carta suelta en columna con ocultas
    const pairIdx = findPairOpportunity(board, v, state);
    if (pairIdx !== null && v <= 5) {
      const closesRound = hidden.includes(pairIdx) && canCloseNow;
      if (!closesRound || !bot || shouldCloseRound(bot, state, mem, v)) {
        return { source: 'discard', placeIndex: pairIdx, flipIndex: null, reason: 'Forma pareja con descarte' };
      }
    }

    // 3. Coger del descarte para bajar una carta visible alta (NO cierra la ronda, ayuda a bajar puntos antes de cerrar)
    const threshold = mem ? Math.min(mem.stealThreshold, 3) : 3;
    if (v <= threshold) {
      const hi = safeHighestVisibleIndex(board);
      const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
      // Si está esperando para poder cerrar sin duplicar, acepta incluso bajar 2 puntos de una visible
      const minGain = canCloseNow ? 2 : hidden.length > 0 ? 4 : 1;
      if (hi !== null && hiVal !== null && (hidden.length === 0 || hiVal >= 5 || canCloseNow) && hiVal - v >= minGain) {
        return { source: 'discard', placeIndex: hi, flipIndex: null, reason: 'Coge descarte barato, baja visible' };
      }

      const visVals = getVisibleValues(board);
      if (
        visVals.every(val => val <= 3) &&
        hidden.length > 0 &&
        v <= 1 &&
        (!canCloseNow || !bot || shouldCloseRound(bot, state, mem, v))
      ) {
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
  const willingToCloseBlind = !canCloseNow || !bot || shouldCloseRound(bot, state, mem);
  const willingToCloseWithCard = !canCloseNow || !bot || shouldCloseRound(bot, state, mem, drawnValue);

  // 1. Prioridad máxima: completar columna de 3 iguales
  const compIdx = findColumnCompletion(board, drawnValue);
  if (compIdx !== null) {
    const closesRound = hidden.includes(compIdx) && canCloseNow;
    if (!closesRound || !bot || shouldCloseRound(bot, state, mem, 0)) {
      return { place: true, placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
    }
  }

  // 2. Si le queda 1 sola carta oculta y NO le renta cerrar (riesgo de duplicar x2):
  // Debe evitar a toda costa descartar y voltear la última oculta.
  // Para NO cerrar la ronda, sustituye una carta ya visible si mejora o empata (o si la robada es razonable <= 6).
  if (canCloseNow && !willingToCloseBlind) {
    // ¿Puede cerrar colocando esta carta concreta en la última oculta porque es muy baja (ej. -2, -1, 0)?
    if (willingToCloseWithCard && drawnValue <= 1) {
      return { place: true, placeIndex: hidden[0], flipIndex: null, reason: 'Cierra con carta muy baja segura' };
    }

    const hi = safeHighestVisibleIndex(board) ?? highestVisibleIndex(board);
    const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
    if (hi !== null && hiVal !== null && hiVal >= drawnValue) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Baja puntos sin cerrar (evita x2)' };
    }
    // Incluso si la robada es <= 5 y todas sus visibles son <= 4, prefiere cambiar una visible que cerrar y duplicar
    if (hi !== null && hiVal !== null && drawnValue <= 5 && drawnValue - hiVal <= 2) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Retrasa cierre para no duplicar' };
    }
  }

  // 3. Si es una carta negativa (-2 o -1), merece la pena cambiar incluso un 3 o 4
  if (drawnValue <= -1) {
    const hi = safeHighestVisibleIndex(board);
    const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
    if (hi !== null && hiVal !== null && hiVal >= 3) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Coloca negativa por carta media/alta' };
    }
    if (hidden.length > 0 && willingToCloseWithCard) {
      return { place: true, placeIndex: hidden[0], flipIndex: null, reason: 'Coloca negativa en oculta' };
    }
  }

  // 4. Para cartas bajas (0, 1, 2, 3): NO tocar cartas que ya sean <= 4 (como cambiar un 4 por un 3)
  if (drawnValue <= 3) {
    const hi = safeHighestVisibleIndex(board);
    const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
    const minGain = hidden.length > 0 ? 4 : 1;

    if (hi !== null && hiVal !== null && (hidden.length === 0 || hiVal >= 5) && hiVal - drawnValue >= minGain) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Sustituye alta visible con margen' };
    }

    const twoSame = findColumnWithTwoSameVisible(board);
    if (twoSame && drawnValue >= 1 && (hidden.length > 1 || willingToCloseBlind)) {
      return { place: false, placeIndex: null, flipIndex: twoSame.flipIdx, reason: 'Descarta para intentar cerrar columna' };
    }

    if (hidden.length > 0 && willingToCloseWithCard && drawnValue <= 1) {
      return { place: true, placeIndex: hidden[0], flipIndex: null, reason: 'Coloca 0 o 1 en oculta' };
    }
  }

  // 5. Formar pareja de columna si hay ocultas
  const pairIdx = findPairOpportunity(board, drawnValue, state);
  if (pairIdx !== null && drawnValue <= 7) {
    const closesRound = hidden.includes(pairIdx) && canCloseNow;
    if (!closesRound || willingToCloseWithCard) {
      return { place: true, placeIndex: pairIdx, flipIndex: null, reason: 'Forma pareja para columna' };
    }
  }

  // 6. Descartar la robada y voltear una carta oculta estratégicamente
  if (hidden.length > 0) {
    // Último freno anti-cierre suicida: si solo queda 1 oculta y no conviene cerrar, intenta cambiar cualquier visible antes que voltear
    if (canCloseNow && !willingToCloseBlind) {
      const hi = safeHighestVisibleIndex(board) ?? highestVisibleIndex(board);
      const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
      if (hi !== null && hiVal !== null && drawnValue <= hiVal + 2) {
        return { place: true, placeIndex: hi, flipIndex: null, reason: 'Evita voltear última carta con riesgo de x2' };
      }
    }

    const twoSame = findColumnWithTwoSameVisible(board);
    if (twoSame && (hidden.length > 1 || willingToCloseBlind)) {
      return { place: false, placeIndex: null, flipIndex: twoSame.flipIdx, reason: 'Descarta, voltea columna con pareja' };
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

  // 7. Si ya no quedan cartas ocultas (último turno forzado)
  const hi = safeHighestVisibleIndex(board) ?? highestVisibleIndex(board);
  if (hi !== null) return { place: true, placeIndex: hi, flipIndex: null, reason: 'Forzado' };
  const rev = revealedIndices(board);
  return rev.length > 0 ? { place: true, placeIndex: rev[0], flipIndex: null, reason: 'Forzado' } : { place: false, placeIndex: null, flipIndex: null, reason: 'Sin acción' };
}

function decideAdaptiveMove(board: Board, topDiscard: Card | null, state: GameState, mem: AdaptiveMemory): BotDecision {
  return decideHardMove(board, topDiscard, state, mem);
}

function decideAdaptivePlacement(board: Board, drawnValue: number, state: GameState, mem: AdaptiveMemory): BotPlacement {
  return decideHardPlacement(board, drawnValue, state, mem);
}

export function decideBotMove(
  board: Board,
  topDiscard: Card | null,
  state: GameState,
  level: AILevel,
  mem: AdaptiveMemory | null
): BotDecision {
  if (level === 'easy') return decideEasyMove(board, topDiscard, state);
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
  if (level === 'easy') return decideEasyPlacement(board, drawnValue, state);
  if (level === 'hard') return decideHardPlacement(board, drawnValue, state, mem);
  return decideAdaptivePlacement(board, drawnValue, state, mem!);
}