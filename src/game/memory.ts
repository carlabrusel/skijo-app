import { AdaptiveMemory } from './types';

const KEY = 'skyjo_adaptive_memory';

export function loadMemory(): AdaptiveMemory {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        level: parsed.level ?? 1,
        roundsPlayed: parsed.roundsPlayed ?? 0,
        playerClosesEarly: parsed.playerClosesEarly ?? 0,
        playerClosesLate: parsed.playerClosesLate ?? 0,
        playerColumnFocus: parsed.playerColumnFocus ?? 0,
        stealThreshold: parsed.stealThreshold ?? 3,
        closeRiskTolerance: parsed.closeRiskTolerance ?? 0.5,
        gamesPlayed: parsed.gamesPlayed ?? 0,
      };
    }
  } catch { /* ignore */ }
  return {
    level: 1,
    roundsPlayed: 0,
    playerClosesEarly: 0,
    playerClosesLate: 0,
    playerColumnFocus: 0,
    stealThreshold: 3,
    closeRiskTolerance: 0.5,
    gamesPlayed: 0,
  };
}

export function saveMemory(mem: AdaptiveMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(mem));
  } catch { /* ignore */ }
}

export function resetMemory(): AdaptiveMemory {
  const fresh: AdaptiveMemory = {
    level: 1,
    roundsPlayed: 0,
    playerClosesEarly: 0,
    playerClosesLate: 0,
    playerColumnFocus: 0,
    stealThreshold: 3,
    closeRiskTolerance: 0.5,
    gamesPlayed: 0,
  };
  saveMemory(fresh);
  return fresh;
}

export interface RoundLearningContext {
  playerClosed: boolean;
  playerDoubled: boolean;
  botClosedAndDoubled: boolean;
  turnsInRound: number;
  playerEliminatedColumns: number;
  playerWonRound: boolean;
  isGameOver: boolean;
  playerWonGame: boolean;
}

export function evolveMemory(
  mem: AdaptiveMemory,
  ctx: RoundLearningContext
): AdaptiveMemory {
  const next = { ...mem };
  next.roundsPlayed += 1;

  // Registrar partida completa terminada (cuando alguien llega a >= 100 puntos)
  if (ctx.isGameOver) {
    next.gamesPlayed += 1;
  }

  // Analizar velocidad de cierre real según los turnos que duró la ronda
  if (ctx.playerClosed) {
    if (ctx.turnsInRound <= 8) next.playerClosesEarly += 1;
    else next.playerClosesLate += 1;
  }

  // Registrar si el jugador busca activamente eliminar columnas
  if (ctx.playerEliminatedColumns > 0) {
    next.playerColumnFocus += ctx.playerEliminatedColumns;
  }

  // Ajustar agresividad de robo según ritmo del jugador
  const earlyRatio = next.playerClosesEarly / Math.max(1, next.roundsPlayed);
  if (earlyRatio > 0.5) {
    // El jugador cierra rápido: el bot coge cartas buenas antes y no espera tanto
    next.stealThreshold = Math.min(5, Number((next.stealThreshold + 0.3).toFixed(2)));
    next.closeRiskTolerance = Math.min(0.85, Number((next.closeRiskTolerance + 0.08).toFixed(2)));
  } else if (earlyRatio < 0.25) {
    // El jugador juega lento a bajar puntos: el bot exige cartas más bajas
    next.stealThreshold = Math.max(1.5, Number((next.stealThreshold - 0.2).toFixed(2)));
    next.closeRiskTolerance = Math.max(0.25, Number((next.closeRiskTolerance - 0.05).toFixed(2)));
  }

  // Penalizar/ajustar tolerancia al cierre si al bot le duplicaron puntos o si el jugador suele ganar rondas
  if (ctx.botClosedAndDoubled) {
    next.closeRiskTolerance = Math.max(0.15, Number((next.closeRiskTolerance - 0.15).toFixed(2)));
  } else if (ctx.playerDoubled) {
    next.closeRiskTolerance = Math.min(0.9, Number((next.closeRiskTolerance + 0.1).toFixed(2)));
  }

  if (ctx.playerWonRound) {
    next.stealThreshold = Math.min(5, Number((next.stealThreshold + 0.15).toFixed(2)));
  }

  // Subir nivel según rondas y partidas completas jugadas
  const experiencePoints = next.roundsPlayed + next.gamesPlayed * 3;
  next.level = 1 + Math.floor(experiencePoints / 3);

  saveMemory(next);
  return next;
}