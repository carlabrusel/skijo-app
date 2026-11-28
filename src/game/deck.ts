import { ActionType, Card } from './types';

const COUNTS: Record<number, number> = {
  [-2]: 5,
  [-1]: 10,
  0: 15,
  1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10,
  7: 10, 8: 10, 9: 10, 10: 10, 11: 10, 12: 10,
};

const ACTION_COUNTS: Record<ActionType, number> = {
  swap_own: 4,
  swap_opponent: 4,
  swap_column: 4,
  peek: 4,
  draw_two: 4,
  extra_turn: 4,
};

const STAR_COUNT = 10;

let idCounter = 0;

export function createDeck(withExpansion = false): Card[] {
  const deck: Card[] = [];
  for (const [valStr, count] of Object.entries(COUNTS)) {
    const value = parseInt(valStr, 10);
    for (let i = 0; i < count; i++) {
      deck.push({ id: `c${idCounter++}`, value, kind: 'number' });
    }
  }

  if (withExpansion) {
    for (let i = 0; i < STAR_COUNT; i++) {
      deck.push({ id: `c${idCounter++}`, value: 0, kind: 'star' });
    }
    for (const [actStr, count] of Object.entries(ACTION_COUNTS)) {
      const actionType = actStr as ActionType;
      for (let i = 0; i < count; i++) {
        deck.push({ id: `c${idCounter++}`, value: 0, kind: 'action', actionType });
      }
    }
  }

  return deck;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function actionLabel(actionType?: ActionType): { short: string; title: string; desc: string } {
  switch (actionType) {
    case 'swap_own':
      return { short: 'PROPIA', title: 'Cambio propio', desc: 'Intercambia 2 cartas de tu propio tablero.' };
    case 'swap_opponent':
      return { short: 'RIVAL', title: 'Robo al rival', desc: 'Intercambia 1 carta tuya por 1 de un rival.' };
    case 'swap_column':
      return { short: 'COL.', title: 'Cambio de columna', desc: 'Intercambia 1 columna tuya por 1 de un rival.' };
    case 'peek':
      return { short: 'ESPIAR', title: 'Espiar cartas', desc: 'Mira en secreto hasta 2 cartas boca abajo.' };
    case 'draw_two':
      return { short: 'x2', title: 'Robar doble', desc: 'Roba 2 cartas del mazo, quédate 1 y descarta la otra.' };
    case 'extra_turn':
      return { short: '+1', title: 'Turno extra', desc: 'Al terminar este turno juegas otro turno seguido.' };
    default:
      return { short: 'ACC.', title: 'Carta de Acción', desc: 'Efecto especial.' };
  }
}

export function cardGradient(cardOrValue: Card | number): { bg: string; text: string; isDarkText: boolean } {
  // Si es un objeto Card
  if (typeof cardOrValue === 'object' && cardOrValue !== null) {
    if (cardOrValue.kind === 'star') {
      return { bg: 'from-amber-300 via-yellow-400 to-amber-500', text: 'text-amber-950', isDarkText: true };
    }
    if (cardOrValue.kind === 'action') {
      return { bg: 'from-fuchsia-600 via-purple-700 to-indigo-900', text: 'text-white', isDarkText: false };
    }
    return cardGradient(cardOrValue.value);
  }

  // Colores clásicos originales de Skyjo
  const value = Number(cardOrValue);
  if (value <= -1) {
    return { bg: 'from-indigo-700 to-purple-800', text: 'text-white', isDarkText: false };
  }
  if (value === 0) {
    return { bg: 'from-sky-400 to-cyan-500', text: 'text-white', isDarkText: false };
  }
  if (value >= 1 && value <= 4) {
    return { bg: 'from-emerald-400 to-green-600', text: 'text-white', isDarkText: false };
  }
  if (value >= 5 && value <= 8) {
    return { bg: 'from-yellow-300 to-amber-500', text: 'text-amber-950', isDarkText: true };
  }
  return { bg: 'from-red-500 to-rose-700', text: 'text-white', isDarkText: false };
}