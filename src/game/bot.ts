import { Board, Card, GameState, Player, AILevel, AdaptiveMemory } from './types';
import {
  visibleCardValueAt, highestVisibleIndex, hiddenIndices,
  revealedIndices, getVisibleValues, getVisibleScore, isStarAt, getFullScore,
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

export interface BotActionExecution {
  useAction: boolean;
  ownIndex?: number;
  secondOwnIndex?: number;
  targetPlayerId?: string;
  targetIndex?: number;
  ownCol?: number;
  targetCol?: number;
  chosenDrawTwoIndex?: number;
  reason: string;
}

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

// Detecta si hay 2 cartas reveladas iguales (o 1 número + 1 Estrella) en una columna para completarla
function findColumnCompletion(board: Board, card: Card): number | null {
  if (card.kind === 'action') return null;
  const isStar = card.kind === 'star';
  if (!isStar && card.value <= 0) return null;

  for (let col = 0; col < 4; col++) {
    const cells = [col, col + 4, col + 8];
    if (cells.some(i => board[i].eliminated)) continue;

    const revCards = cells
      .filter(i => board[i].revealed && board[i].card !== null)
      .map(i => ({ idx: i, card: board[i].card! }));

    if (revCards.some(r => r.card.kind === 'action')) continue;

    if (isStar) {
      // Estrella completa si hay 2 cartas iguales >= 1 (o 1 carta >= 4 + 1 Estrella)
      if (revCards.length === 2) {
        const [a, b] = revCards;
        const targetIdx = cells.find(i => i !== a.idx && i !== b.idx)!;
        if (a.card.kind !== 'star' && b.card.kind !== 'star' && a.card.value === b.card.value && a.card.value >= 1) {
          return targetIdx;
        }
        if (a.card.kind === 'star' && b.card.kind !== 'star' && b.card.value >= 3) return targetIdx;
        if (b.card.kind === 'star' && a.card.kind !== 'star' && a.card.value >= 3) return targetIdx;
      }
      // Si ya hay 2 iguales en los 3 huecos y el 3º tiene otra carta revelada diferente >= 4, sustituirla
      if (revCards.length === 3) {
        for (let t = 0; t < 3; t++) {
          const others = revCards.filter((_, idx) => idx !== t);
          if (
            others[0].card.kind !== 'star' &&
            others[1].card.kind !== 'star' &&
            others[0].card.value === others[1].card.value &&
            others[0].card.value >= 2 &&
            revCards[t].card.value >= 3
          ) {
            return revCards[t].idx;
          }
        }
      }
      continue;
    }

    // Carta numérica normal (>= 1): busca 2 iguales o 1 igual + 1 Estrella
    let matches = 0;
    let targetIdx: number | null = null;
    for (const i of cells) {
      const c = board[i];
      if (c.revealed && c.card && (c.card.value === card.value || c.card.kind === 'star')) {
        matches++;
      } else {
        targetIdx = i;
      }
    }
    if (matches === 2 && targetIdx !== null) {
      return targetIdx;
    }
  }
  return null;
}

// Protege parejas iguales y cartas Estrella ya colocadas para no romperlas jamás
function getProtectedIndices(board: Board): Set<number> {
  const protectedSet = new Set<number>();
  for (let i = 0; i < board.length; i++) {
    if (isStarAt(board, i)) protectedSet.add(i);
  }
  for (let col = 0; col < 4; col++) {
    const cells = [col, col + 4, col + 8];
    if (cells.some(i => board[i].eliminated)) continue;

    const revealed = cells.filter(i => board[i].revealed && board[i].card !== null);
    if (revealed.length >= 2) {
      for (let a = 0; a < revealed.length; a++) {
        for (let b = a + 1; b < revealed.length; b++) {
          const ca = board[revealed[a]].card!;
          const cb = board[revealed[b]].card!;
          if (ca.value === cb.value || ca.kind === 'star' || cb.kind === 'star') {
            protectedSet.add(revealed[a]);
            protectedSet.add(revealed[b]);
          }
        }
      }
    }
  }
  return protectedSet;
}

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

function findPairOpportunity(board: Board, value: number, state: GameState): number | null {
  if (value <= 0) return null;

  const seenOnTable = state.discardCounts[value] || 0;
  const totalOfValue = value === 0 ? 15 : 10;
  if (totalOfValue - seenOnTable <= 1) return null;

  for (let col = 0; col < 4; col++) {
    const cells = [col, col + 4, col + 8];
    if (cells.some(i => board[i].eliminated)) continue;

    const revealed = cells.filter(i => board[i].revealed && i.card !== null);
    const hidden = cells.filter(i => !i.revealed);

    if (revealed.length === 1 && hidden.length >= 1 && board[revealed[0]].card!.value === value) {
      return hidden[0];
    }
  }
  return null;
}

function findColumnWithTwoSameVisible(board: Board): { col: number; flipIdx: number; pairValue: number } | null {
  for (let col = 0; col < 4; col++) {
    const cells = [col, col + 4, col + 8];
    const cards: Card[] = [];
    let hiddenIdx: number | null = null;
    let valid = true;
    for (const i of cells) {
      const c = board[i];
      if (c.eliminated) { valid = false; break; }
      if (!c.revealed || !c.card) { if (hiddenIdx === null) hiddenIdx = i; continue; }
      cards.push(c.card);
    }
    if (!valid || cards.length !== 2 || hiddenIdx === null) continue;
    const [a, b] = cards;
    if (a.kind === 'star' && b.kind !== 'star' && b.value >= 1) {
      return { col, flipIdx: hiddenIdx, pairValue: b.value };
    }
    if (b.kind === 'star' && a.kind !== 'star' && a.value >= 1) {
      return { col, flipIdx: hiddenIdx, pairValue: a.value };
    }
    if (a.value === b.value && a.value >= 1) {
      return { col, flipIdx: hiddenIdx, pairValue: a.value };
    }
  }
  return null;
}

function findSafeHiddenIndexForLowCard(board: Board, cardValue: number): number | null {
  const hidden = hiddenIndices(board);
  if (hidden.length === 0) return null;

  const safe = hidden.filter(h => {
    const col = h % 4;
    const otherVals = [col, col + 4, col + 8]
      .filter(i => i !== h && !board[i].eliminated && board[i].revealed && board[i].card !== null)
      .map(i => board[i].card!.value);
    return !(otherVals.length === 2 && otherVals[0] === cardValue && otherVals[1] === cardValue);
  });

  return safe.length > 0 ? safe[0] : hidden[0];
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

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

  const myHiddenEstimate =
    knownClosingCardValue !== undefined
      ? knownClosingCardValue + (hidden.length - 1) * deckAvg
      : hidden.length * (deckAvg + 2.5);

  const myProjected = myVisible + myHiddenEstimate;

  if (myProjected <= 0) return true;

  const tolerance = mem ? mem.closeRiskTolerance : 0.25;
  const safetyBuffer = tolerance < 0.35 ? 6 : tolerance < 0.6 ? 4.5 : 3;

  const opponents = state.players.filter(p => p.id !== bot.id);
  for (const opp of opponents) {
    const oppVisible = getVisibleScore(opp.board);
    const oppHidden = hiddenIndices(opp.board).length;
    const oppLastTurnDiscount = oppHidden > 0 ? 3 : 1.5;
    const oppEstimate = oppVisible + oppHidden * deckAvg - oppLastTurnDiscount;

    if (myProjected + safetyBuffer >= oppEstimate) {
      return false;
    }
  }

  return true;
}

// Decide cómo ejecuta el bot una carta de Acción en modo expansión
export function decideBotAction(
  bot: Player,
  actionCard: Card,
  state: GameState,
  level: AILevel,
  mem: AdaptiveMemory | null
): BotActionExecution {
  const actionType = actionCard.actionType;
  if (!actionType) return { useAction: false, reason: 'Sin acción' };

  const opponents = state.players.filter(p => p.id !== bot.id);
  const deckAvg = getRemainingDeckAverage(state);

  // 1. +1 Turno: siempre interesa jugarla salvo si va a cerrar mal
  if (actionType === 'extra_turn') {
    return { useAction: true, reason: 'Juega turno extra' };
  }

  // 2. Espiar: siempre útil si quedan cartas ocultas
  if (actionType === 'peek') {
    const anyHidden = state.players.some(p => hiddenIndices(p.board).length > 0);
    return { useAction: anyHidden, reason: 'Espía cartas ocultas' };
  }

  // 3. Robar 2 y elegir 1: siempre interesa salvo en el último turno si ya tiene todo bajo
  if (actionType === 'draw_two') {
    return { useAction: true, reason: 'Roba 2 cartas para elegir la mejor' };
  }

  // 4. Intercambiar 2 cartas propias: busca juntar 2 cartas iguales en la misma columna
  if (actionType === 'swap_own') {
    const rev = revealedIndices(bot.board);
    for (let a = 0; a < rev.length; a++) {
      for (let b = a + 1; b < rev.length; b++) {
        const idxA = rev[a];
        const idxB = rev[b];
        const colA = idxA % 4;
        const colB = idxB % 4;
        if (colA === colB) continue;
        const cardA = bot.board[idxA].card!;
        const cardB = bot.board[idxB].card!;
        if (cardA.value < 1 && cardA.kind !== 'star') continue;

        // Comprueba si llevar cardA a colB junta pareja o trío
        const colBCells = [colB, colB + 4, colB + 8].filter(i => i !== idxB && !bot.board[i].eliminated);
        const matchesInB = colBCells.filter(
          i => bot.board[i].revealed && bot.board[i].card && (bot.board[i].card!.value === cardA.value || bot.board[i].card!.kind === 'star')
        );
        if (matchesInB.length >= 1 && cardB.value !== cardA.value) {
          return {
            useAction: true,
            ownIndex: idxA,
            secondOwnIndex: idxB,
            reason: 'Junta cartas iguales en columna',
          };
        }
      }
    }
    return { useAction: false, reason: 'No mejora columnas propias' };
  }

  // 5. Intercambiar 1 carta propia por 1 de un rival
  if (actionType === 'swap_opponent') {
    const myHighIdx = safeHighestVisibleIndex(bot.board) ?? highestVisibleIndex(bot.board);
    const myHighVal = myHighIdx !== null ? visibleCardValueAt(bot.board, myHighIdx) : null;
    if (myHighIdx === null || myHighVal === null || myHighVal < (level === 'easy' ? 7 : 5)) {
      return { useAction: false, reason: 'No tiene carta alta que soltar' };
    }

    let bestOppId: string | null = null;
    let bestOppIdx: number | null = null;
    let bestGain = level === 'easy' ? 4 : 5;

    for (const opp of opponents) {
      for (let i = 0; i < 12; i++) {
        const cell = opp.board[i];
        if (cell.eliminated || !cell.revealed || !cell.card) continue;
        const oppVal = cell.card.kind === 'star' ? 0 : cell.card.value;
        const gain = myHighVal - oppVal;
        if (gain >= bestGain) {
          bestGain = gain;
          bestOppId = opp.id;
          bestOppIdx = i;
        }
      }
    }

    if (bestOppId && bestOppIdx !== null) {
      return {
        useAction: true,
        ownIndex: myHighIdx,
        targetPlayerId: bestOppId,
        targetIndex: bestOppIdx,
        reason: 'Intercambia carta alta por carta baja del rival',
      };
    }
    return { useAction: false, reason: 'Sin objetivo rentable en rivales' };
  }

  // 6. Intercambiar una columna entera por una del rival
  if (actionType === 'swap_column') {
    let worstMyCol = -1;
    let worstMyScore = -Infinity;
    for (let col = 0; col < 4; col++) {
      const cells = [col, col + 4, col + 8];
      if (cells.some(i => bot.board[i].eliminated)) continue;
      const colEst = cells.reduce((sum, i) => {
        const c = bot.board[i];
        return sum + (c.revealed && c.card ? (c.card.kind === 'star' ? 0 : c.card.value) : deckAvg);
      }, 0);
      if (colEst > worstMyScore) {
        worstMyScore = colEst;
        worstMyCol = col;
      }
    }

    let bestOppId: string | null = null;
    let bestOppCol = -1;
    let bestGain = mem ? 9 : 10;

    for (const opp of opponents) {
      for (let col = 0; col < 4; col++) {
        const cells = [col, col + 4, col + 8];
        if (cells.some(i => opp.board[i].eliminated)) continue;
        const oppEst = cells.reduce((sum, i) => {
          const c = opp.board[i];
          return sum + (c.revealed && c.card ? (c.card.kind === 'star' ? 0 : c.card.value) : deckAvg);
        }, 0);
        const gain = worstMyScore - oppEst;
        if (gain >= bestGain) {
          bestGain = gain;
          bestOppId = opp.id;
          bestOppCol = col;
        }
      }
    }

    if (worstMyCol !== -1 && bestOppId && bestOppCol !== -1 && getFullScore(bot.board) > 12) {
      return {
        useAction: true,
        ownCol: worstMyCol,
        targetPlayerId: bestOppId,
        targetCol: bestOppCol,
        reason: 'Intercambia columna mala por mejor columna rival',
      };
    }
    return { useAction: false, reason: 'Ninguna columna mejora lo suficiente' };
  }

  return { useAction: false, reason: 'Descarta acción' };
}

function decideEasyMove(board: Board, topDiscard: Card | null, state: GameState): BotDecision {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;

  if (topDiscard && topDiscard.kind !== 'action') {
    const compIdx = findColumnCompletion(board, topDiscard);
    if (compIdx !== null) {
      const closes = hidden.includes(compIdx) && canCloseNow;
      if (!closes || !bot || shouldCloseRound(bot, state, null, 0)) {
        return { source: 'discard', placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
      }
    }
    const effVal = topDiscard.kind === 'star' ? 0 : topDiscard.value;
    if (effVal <= 3 && Math.random() < 0.45) {
      const hi = safeHighestVisibleIndex(board);
      const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
      if (hi !== null && hiVal !== null && hiVal >= 6 && hiVal - effVal >= 4) {
        return { source: 'discard', placeIndex: hi, flipIndex: null, reason: 'Coge descarte' };
      }
    }
  }
  return { source: 'deck', placeIndex: null, flipIndex: null, reason: 'Roba del mazo' };
}

function decideEasyPlacement(board: Board, drawnCard: Card, state: GameState): BotPlacement {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;
  const drawnValue = drawnCard.kind === 'star' ? 0 : drawnCard.value;

  const compIdx = findColumnCompletion(board, drawnCard);
  if (compIdx !== null) {
    const closes = hidden.includes(compIdx) && canCloseNow;
    if (!closes || !bot || shouldCloseRound(bot, state, null, 0)) {
      return { place: true, placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
    }
  }

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

function decideHardMove(board: Board, topDiscard: Card | null, state: GameState, mem: AdaptiveMemory | null): BotDecision {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;

  // Las cartas de acción en el descarte no se pueden reactivar, así que el bot las ignora allí
  if (topDiscard && topDiscard.kind !== 'action') {
    const isStar = topDiscard.kind === 'star';
    const v = isStar ? 0 : topDiscard.value;

    const compIdx = findColumnCompletion(board, topDiscard);
    if (compIdx !== null) {
      const closesRound = hidden.includes(compIdx) && canCloseNow;
      if (!closesRound || !bot || shouldCloseRound(bot, state, mem, 0)) {
        return { source: 'discard', placeIndex: compIdx, flipIndex: null, reason: 'Completa columna con descarte' };
      }
    }

    if (!isStar) {
      const pairIdx = findPairOpportunity(board, v, state);
      if (pairIdx !== null && v <= 5) {
        const closesRound = hidden.includes(pairIdx) && canCloseNow;
        if (!closesRound || !bot || shouldCloseRound(bot, state, mem, v)) {
          return { source: 'discard', placeIndex: pairIdx, flipIndex: null, reason: 'Forma pareja con descarte' };
        }
      }
    }

    const threshold = mem ? Math.min(mem.stealThreshold, 3) : 3;
    if (v <= threshold || isStar) {
      const hi = safeHighestVisibleIndex(board);
      const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
      const minGain = isStar ? 3 : canCloseNow ? 2 : hidden.length > 0 ? 4 : 1;
      if (hi !== null && hiVal !== null && (hidden.length === 0 || hiVal >= 5 || (v <= -1 && hiVal >= 3) || isStar || canCloseNow) && hiVal - v >= minGain) {
        return { source: 'discard', placeIndex: hi, flipIndex: null, reason: 'Coge descarte barato, baja visible' };
      }

      const visVals = getVisibleValues(board);
      const safeHidden = findSafeHiddenIndexForLowCard(board, v);
      if (
        visVals.every(val => val <= 3) &&
        safeHidden !== null &&
        v <= 1 &&
        (!canCloseNow || !bot || shouldCloseRound(bot, state, mem, v))
      ) {
        return { source: 'discard', placeIndex: safeHidden, flipIndex: null, reason: 'Coge descarte, revela oculta' };
      }
    }
  }
  return { source: 'deck', placeIndex: null, flipIndex: null, reason: 'Roba del mazo' };
}

function decideHardPlacement(board: Board, drawnCard: Card, state: GameState, mem: AdaptiveMemory | null): BotPlacement {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;
  const isStar = drawnCard.kind === 'star';
  const drawnValue = isStar ? 0 : drawnCard.value;
  const willingToCloseBlind = !canCloseNow || !bot || shouldCloseRound(bot, state, mem);
  const willingToCloseWithCard = !canCloseNow || !bot || shouldCloseRound(bot, state, mem, drawnValue);

  // 1. Completar columna de 3 iguales (incluye Estrella comodín)
  const compIdx = findColumnCompletion(board, drawnCard);
  if (compIdx !== null) {
    const closesRound = hidden.includes(compIdx) && canCloseNow;
    if (!closesRound || !bot || shouldCloseRound(bot, state, mem, 0)) {
      return { place: true, placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
    }
  }

  // Si es una Estrella que no cierra columna aún, intenta colocarla en una columna con 1 carta >= 4 y 1 oculta, o quitar una carta alta
  if (isStar) {
    for (let col = 0; col < 4; col++) {
      const cells = [col, col + 4, col + 8];
      if (cells.some(i => board[i].eliminated)) continue;
      const rev = cells.filter(i => board[i].revealed && board[i].card);
      const hid = cells.filter(i => !board[i].revealed);
      if (rev.length === 2 && hid.length === 1) {
        const highInCol = rev.find(i => board[i].card!.value >= 6);
        const partnerInCol = rev.find(i => i !== highInCol && board[i].card!.value >= 3);
        if (highInCol !== undefined && partnerInCol !== undefined) {
          return { place: true, placeIndex: highInCol, flipIndex: null, reason: 'Prepara columna con Estrella' };
        }
      }
    }
    const hi = safeHighestVisibleIndex(board);
    const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
    if (hi !== null && hiVal !== null && hiVal >= 4) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Coloca Estrella por carta media/alta' };
    }
    const safeHidden = findSafeHiddenIndexForLowCard(board, 0);
    if (safeHidden !== null && willingToCloseWithCard) {
      return { place: true, placeIndex: safeHidden, flipIndex: null, reason: 'Coloca Estrella en oculta' };
    }
  }

  // 2. Si le queda 1 sola carta oculta y NO le renta cerrar (riesgo de duplicar x2)
  if (canCloseNow && !willingToCloseBlind) {
    if (willingToCloseWithCard && drawnValue <= 1) {
      const safeHidden = findSafeHiddenIndexForLowCard(board, drawnValue) ?? hidden[0];
      return { place: true, placeIndex: safeHidden, flipIndex: null, reason: 'Cierra con carta muy baja segura' };
    }

    const hi = safeHighestVisibleIndex(board) ?? highestVisibleIndex(board);
    const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
    if (hi !== null && hiVal !== null && hiVal >= drawnValue) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Baja puntos sin cerrar (evita x2)' };
    }
    if (hi !== null && hiVal !== null && drawnValue <= 5 && drawnValue - hiVal <= 2) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Retrasa cierre para no duplicar' };
    }
  }

  // 3. Carta negativa (-2 o -1)
  if (drawnValue <= -1) {
    const hi = safeHighestVisibleIndex(board);
    const hiVal = hi !== null ? visibleCardValueAt(board, hi) : null;
    if (hi !== null && hiVal !== null && hiVal >= 3) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Coloca negativa por carta media/alta' };
    }
    const safeHidden = findSafeHiddenIndexForLowCard(board, drawnValue);
    if (safeHidden !== null && willingToCloseWithCard) {
      return { place: true, placeIndex: safeHidden, flipIndex: null, reason: 'Coloca negativa en oculta' };
    }
  }

  // 4. Cartas bajas (0, 1, 2, 3)
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

    const safeHidden = findSafeHiddenIndexForLowCard(board, drawnValue);
    if (safeHidden !== null && willingToCloseWithCard && drawnValue <= 1) {
      return { place: true, placeIndex: safeHidden, flipIndex: null, reason: 'Coloca 0 o 1 en oculta' };
    }
  }

  // 5. Formar pareja de columna si hay ocultas (solo valores >= 1)
  const pairIdx = findPairOpportunity(board, drawnValue, state);
  if (pairIdx !== null && drawnValue <= 7) {
    const closesRound = hidden.includes(pairIdx) && canCloseNow;
    if (!closesRound || willingToCloseWithCard) {
      return { place: true, placeIndex: pairIdx, flipIndex: null, reason: 'Forma pareja para columna' };
    }
  }

  // 6. Descartar la robada y voltear una carta oculta estratégicamente
  if (hidden.length > 0) {
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

  // 7. Último turno forzado
  const hi = safeHighestVisibleIndex(board) ?? highestVisibleIndex(board);
  if (hi !== null) return { place: true, placeIndex: hi, flipIndex: null, reason: 'Forzado' };
  const rev = revealedIndices(board);
  return rev.length > 0 ? { place: true, placeIndex: rev[0], flipIndex: null, reason: 'Forzado' } : { place: false, placeIndex: null, flipIndex: null, reason: 'Sin acción' };
}

export function decideBotMove(
  board: Board,
  topDiscard: Card | null,
  state: GameState,
  level: AILevel,
  mem: AdaptiveMemory | null
): BotDecision {
  if (level === 'easy') return decideEasyMove(board, topDiscard, state);
  return decideHardMove(board, topDiscard, state, mem);
}

export function decideBotPlacement(
  board: Board,
  drawnCardOrValue: Card | number,
  state: GameState,
  level: AILevel,
  mem: AdaptiveMemory | null
): BotPlacement {
  const card: Card =
    typeof drawnCardOrValue === 'number'
      ? { id: 'tmp', value: drawnCardOrValue, kind: 'number' }
      : drawnCardOrValue;
  if (level === 'easy') return decideEasyPlacement(board, card, state);
  return decideHardPlacement(board, card, state, mem);
}