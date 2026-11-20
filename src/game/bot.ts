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

function findColumnCompletion(board: Board, value: number): number | null {
  for (let col = 0; col < 4; col++) {
    const cells = [col, col + 4, col + 8];
    let matches = 0;
    let placeIdx: number | null = null;
    let valid = true;
    for (const i of cells) {
      const c = board[i];
      if (c.eliminated) { valid = false; break; }
      if (!c.revealed || !c.card) { if (placeIdx === null) placeIdx = i; continue; }
      if (c.card.value === value) matches++;
    }
    if (valid && matches >= 2 && placeIdx !== null) return placeIdx;
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

// HARD: strategic with card counting
function decideHardMove(board: Board, topDiscard: Card | null, state: GameState, mem: AdaptiveMemory | null): BotDecision {
  if (topDiscard) {
    const v = topDiscard.value;
    const compIdx = findColumnCompletion(board, v);
    if (compIdx !== null) {
      return { source: 'discard', placeIndex: compIdx, flipIndex: null, reason: 'Completa columna con descarte' };
    }
    const threshold = mem ? mem.stealThreshold : 3;
    if (v <= threshold) {
      const hi = highestVisibleIndex(board);
      if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > v) {
        return { source: 'discard', placeIndex: hi, flipIndex: null, reason: 'Coge descarte barato, quita alta' };
      }
      const visVals = getVisibleValues(board);
      if (visVals.every(val => val <= threshold) && hiddenIndices(board).length > 0) {
        const hidden = hiddenIndices(board);
        return { source: 'discard', placeIndex: hidden[0], flipIndex: null, reason: 'Coge descarte, revela oculta' };
      }
    }
  }
  return { source: 'deck', placeIndex: null, flipIndex: null, reason: 'Roba del mazo' };
}

function decideHardPlacement(board: Board, drawnValue: number, state: GameState, mem: AdaptiveMemory | null): BotPlacement {
  const compIdx = findColumnCompletion(board, drawnValue);
  if (compIdx !== null) {
    return { place: true, placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
  }

  const seenOnTable = state.discardCounts[drawnValue] || 0;
  const totalOfValue = drawnValue <= -1 ? (drawnValue === -2 ? 5 : 10) : drawnValue === 0 ? 15 : 10;
  const remaining = totalOfValue - seenOnTable;
  void remaining;

  if (drawnValue <= 4) {
    const hi = highestVisibleIndex(board);
    if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > drawnValue) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Sustituye alta visible' };
    }
    const visVals = getVisibleValues(board);
    const hasHighVisible = visVals.some(v => v > 4);
    if (!hasHighVisible) {
      const hidden = hiddenIndices(board);
      if (hidden.length > 0) {
        return { place: true, placeIndex: hidden[0], flipIndex: null, reason: 'Sustituye oculta' };
      }
    }
    const hidden = hiddenIndices(board);
    if (hidden.length > 0) {
      return { place: true, placeIndex: hidden[0], flipIndex: null, reason: 'Coloca en oculta' };
    }
    if (hi !== null) return { place: true, placeIndex: hi, flipIndex: null, reason: 'Coloca en visible' };
  }

  const hidden = hiddenIndices(board);
  if (hidden.length > 0) {
    const twoSame = findColumnWithTwoSameVisible(board);
    if (twoSame) {
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

  const hi = highestVisibleIndex(board);
  if (hi !== null) return { place: true, placeIndex: hi, flipIndex: null, reason: 'Forzado' };
  const rev = revealedIndices(board);
  return rev.length > 0 ? { place: true, placeIndex: rev[0], flipIndex: null, reason: 'Forzado' } : { place: false, placeIndex: null, flipIndex: null, reason: 'Sin acción' };
}

// ADAPTIVE: aprende del estilo del jugador, controla riesgo de cierre y escala con el nivel
function decideAdaptiveMove(board: Board, topDiscard: Card | null, state: GameState, mem: AdaptiveMemory): BotDecision {
  const bot = state.players[state.currentPlayerIndex];
  const hidden = hiddenIndices(board);
  const canCloseNow = hidden.length === 1;
  const willingToClose = !canCloseNow || !bot || shouldCloseRound(bot, state, mem);

  if (topDiscard) {
    const v = topDiscard.value;
    const compIdx = findColumnCompletion(board, v);
    if (compIdx !== null) {
      return { source: 'discard', placeIndex: compIdx, flipIndex: null, reason: 'Completa columna' };
    }

    // Si el jugador se centra en eliminar columnas, el bot roba cartas repetidas potenciales (<= 2)
    const effectiveThreshold = mem.playerColumnFocus >= 2 ? Math.max(mem.stealThreshold, 3.5) : mem.stealThreshold;

    if (v <= effectiveThreshold) {
      const hi = highestVisibleIndex(board);
      if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > v) {
        return { source: 'discard', placeIndex: hi, flipIndex: null, reason: 'Coge descarte adaptado' };
      }
      if (hidden.length > 0 && willingToClose && mem.level >= 2) {
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

  // Si al bot solo le queda 1 carta oculta y NO le conviene cerrar (va perdiendo y le duplicarían),
  // prefiere sustituir una carta alta visible antes que descubrir su última oculta.
  if (canCloseNow && !willingToClose) {
    const hi = highestVisibleIndex(board);
    if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > drawnValue) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Evita cerrar todavía, baja puntos' };
    }
  }

  const maxAcceptable = mem.level >= 3 ? 4 : 5;
  if (drawnValue <= maxAcceptable) {
    const hi = highestVisibleIndex(board);
    if (hi !== null && (visibleCardValueAt(board, hi) ?? 0) > drawnValue) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Sustituye alta' };
    }
    if (hidden.length > 0 && willingToClose) {
      return { place: true, placeIndex: hidden[0], flipIndex: null, reason: 'Coloca en oculta' };
    }
    if (hi !== null) {
      return { place: true, placeIndex: hi, flipIndex: null, reason: 'Sustituye visible' };
    }
  }

  if (hidden.length > 0) {
    const twoSame = findColumnWithTwoSameVisible(board);
    if (twoSame && (hidden.length > 1 || willingToClose)) {
      return { place: false, placeIndex: null, flipIndex: twoSame.flipIdx, reason: 'Voltea columna prometedora' };
    }
    // En niveles >= 2, voltea estratégicamente en columnas con cartas altas como en modo Difícil
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

  const hi = highestVisibleIndex(board);
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

  const estimatedTotal = myVisible + myHidden * 4.5;

  const opponents = state.players.filter(p => p.id !== bot.id);
  let safe = true;
  for (const opp of opponents) {
    const oppVisible = getVisibleScore(opp.board);
    const oppHidden = hiddenIndices(opp.board).length;
    const oppEstimate = oppVisible + oppHidden * 4.5;
    if (estimatedTotal >= oppEstimate) {
      safe = false;
      break;
    }
  }

  const tolerance = mem ? mem.closeRiskTolerance : 0.5;
  if (safe) return true;
  if (myHidden <= 1 && Math.random() < tolerance) return true;
  return false;
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