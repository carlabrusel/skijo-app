import { Card } from './types';

const COUNTS: Record<number, number> = {
  [-2]: 5,
  [-1]: 10,
  0: 15,
  1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10,
  7: 10, 8: 10, 9: 10, 10: 10, 11: 10, 12: 10,
};

let idCounter = 0;

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const [valStr, count] of Object.entries(COUNTS)) {
    const value = parseInt(valStr, 10);
    for (let i = 0; i < count; i++) {
      deck.push({ id: `c${idCounter++}`, value });
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

export function cardGradient(value: number): { bg: string; text: string; isDarkText: boolean } {
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
