import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GameState, Player, Card, Board,
  RoundResult, RoundPlayerResult, GameConfig, AdaptiveMemory,
  BOT_NAMES, BOT_IDS, PLAYER_ID, AILevel,
} from '@/game/types';
import { createDeck, shuffle } from '@/game/deck';
import {
  emptyBoard, dealCardsToBoard, allRevealed, getFullScore,
  findEliminableColumns, eliminateColumns,
  hiddenIndices, countEliminated,
} from '@/game/board';
import { decideBotMove, decideBotPlacement } from '@/game/bot';
import { loadMemory, resetMemory, evolveMemory } from '@/game/memory';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function buildPlayers(config: GameConfig): Player[] {
  const players: Player[] = [
    { id: PLAYER_ID, name: 'Tú', isBot: false, board: emptyBoard(), score: 0 },
  ];
  for (let i = 0; i < config.playerCount - 1; i++) {
    players.push({
      id: BOT_IDS[i],
      name: `Bot ${BOT_NAMES[i]}`,
      isBot: true,
      board: emptyBoard(),
      score: 0,
    });
  }
  return players;
}

function dealNewRound(state: GameState): GameState {
  const deck = shuffle(createDeck());
  const players = state.players.map(p => {
    const cards = deck.splice(0, 12);
    return { ...p, board: dealCardsToBoard(emptyBoard(), cards) };
  });
  const firstDiscard = deck.shift()!;

  const discardCounts: Record<number, number> = {};
  if (firstDiscard) discardCounts[firstDiscard.value] = (discardCounts[firstDiscard.value] || 0) + 1;

  return {
    ...state,
    deck,
    discard: [firstDiscard],
    players,
    phase: 'reveal_initial',
    stage: 'choose_source',
    currentPlayerIndex: 0,
    pendingDraw: null,
    lastAction: 'Voltea 2 de tus cartas para empezar',
    lastRoundTriggered: false,
    lastRoundCloser: null,
    lastRoundRemaining: [],
    remainingFinalTurns: 0,
    initialRevealed: Object.fromEntries(players.map(p => [p.id, 0])),
    pendingHighlight: null,
    discardCounts,
    discardPulse: false,
  };
}

function freshState(config: GameConfig): GameState {
  const players = buildPlayers(config);
  return {
    config,
    players,
    deck: [],
    discard: [],
    phase: 'reveal_initial',
    stage: 'choose_source',
    currentPlayerIndex: 0,
    pendingDraw: null,
    lastAction: '',
    lastRoundTriggered: false,
    lastRoundCloser: null,
    lastRoundRemaining: [],
    remainingFinalTurns: 0,
    initialRevealed: {},
    pendingHighlight: null,
    roundNumber: 1,
    turnOrder: players.map(p => p.id),
    discardCounts: {},
    discardPulse: false,
  };
}

function updateDiscardCounts(counts: Record<number, number>, card: Card): Record<number, number> {
  return { ...counts, [card.value]: (counts[card.value] || 0) + 1 };
}

export function useSkyjo() {
  const [state, setState] = useState<GameState | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [gameWinner, setGameWinner] = useState<string | null>(null);
  const [memory, setMemory] = useState<AdaptiveMemory>(() => loadMemory());
  const busyRef = useRef(false);
  const roundTurnsRef = useRef(0);
  const pendingFinishRef = useRef<{ result: RoundResult } | null>(null);

  const startGame = useCallback((config: GameConfig) => {
    roundTurnsRef.current = 0;
    pendingFinishRef.current = null;
    setRoundResult(null);
    setGameWinner(null);
    setSetupOpen(false);
    setState(() => dealNewRound(freshState(config)));
  }, []);

  const resetGame = useCallback(() => {
    roundTurnsRef.current = 0;
    pendingFinishRef.current = null;
    setRoundResult(null);
    setGameWinner(null);
    setSetupOpen(true);
    setState(null);
  }, []);

  const playAgain = useCallback(() => {
    roundTurnsRef.current = 0;
    pendingFinishRef.current = null;
    setRoundResult(null);
    setGameWinner(null);
    setSetupOpen(false);
    setState(s => {
      if (!s) return dealNewRound(freshState({ playerCount: 2, aiLevel: 'hard' }));
      return dealNewRound(freshState(s.config));
    });
  }, []);

  const resetAdaptiveMemory = useCallback(() => {
    const m = resetMemory();
    setMemory(m);
  }, []);

  const triggerDiscardPulse = useCallback(() => {
    // La animación del descarte se dispara limpiamente en App.tsx
  }, []);

  // Sincroniza automáticamente el modal cuando la fase pasa a 'end_routine'
  useEffect(() => {
    if (state?.phase === 'end_routine' && pendingFinishRef.current) {
      const { result } = pendingFinishRef.current;
      pendingFinishRef.current = null;
      setRoundResult(result);
      if (result.winner) setGameWinner(result.winner);
    }
  }, [state?.phase]);

  const ensureDeck = useCallback((s: GameState): GameState => {
    if (s.deck.length === 0 && s.discard.length > 1) {
      const top = s.discard[0];
      const rest = s.discard.slice(1);
      return { ...s, deck: shuffle(rest), discard: [top] };
    }
    return s;
  }, []);

  const checkColumnEliminations = useCallback(
    (s: GameState, playerId: string): GameState => {
      const player = s.players.find(p => p.id === playerId)!;
      let board = player.board;
      let discard = s.discard;
      let discardCounts = s.discardCounts;
      let changed = true;
      let elimCount = 0;
      while (changed) {
        const cols = findEliminableColumns(board);
        if (cols.length === 0) {
          changed = false;
          break;
        }
        const { board: nb, eliminatedCards } = eliminateColumns(board, cols);
        board = nb;
        elimCount += eliminatedCards.length;
        const elimSorted = [...eliminatedCards].sort((a, b) => a.card!.value - b.card!.value);
        discard = [...elimSorted.map(c => c.card!), ...discard];
        for (const c of elimSorted) {
          discardCounts = updateDiscardCounts(discardCounts, c.card!);
        }
      }
      if (elimCount > 0) {
        const players = s.players.map(p => (p.id === playerId ? { ...p, board } : p));
        return {
          ...s,
          players,
          discard,
          discardCounts,
          lastAction: `¡Columna(s) eliminada(s) de ${player.name}!`,
        };
      }
      return s;
    },
    []
  );

  const endRound = useCallback(
    (s: GameState, closerId: string): GameState => {
      const playersRevealed = s.players.map(p => ({
        ...p,
        board: p.board.map(c => (c.eliminated ? c : { ...c, revealed: true })) as Board,
      }));

      const closer = playersRevealed.find(p => p.id === closerId)!;
      const closerScore = getFullScore(closer.board);

      const others = playersRevealed.filter(p => p.id !== closerId);
      const otherScores = others.map(p => getFullScore(p.board));
      const isStrictlyLowest = otherScores.every(os => closerScore < os);

      const results: RoundPlayerResult[] = playersRevealed.map(p => {
        let rawScore = getFullScore(p.board);
        let doubled = false;
        if (p.id === closerId && !isStrictlyLowest && rawScore > 0) {
          rawScore *= 2;
          doubled = true;
        }
        return {
          id: p.id,
          name: p.name,
          isBot: p.isBot,
          roundScore: rawScore,
          finalScore: 0,
          doubled,
          eliminated: countEliminated(p.board),
          closed: p.id === closerId,
        };
      });

      const updatedPlayers = playersRevealed.map(p => {
        const r = results.find(r => r.id === p.id)!;
        return { ...p, score: p.score + r.roundScore };
      });

      results.forEach(r => {
        const p = updatedPlayers.find(p => p.id === r.id)!;
        r.finalScore = p.score;
      });

      const sortedResults = [...results].sort((a, b) => a.finalScore - b.finalScore);

      const someoneOver100 = updatedPlayers.some(p => p.score >= 100);
      let winner: string | null = null;
      if (someoneOver100) {
        winner = updatedPlayers.reduce((min, p) => (p.score < min.score ? p : min)).id;
      }

      const result: RoundResult = {
        players: sortedResults,
        closer: closerId,
        isFinal: someoneOver100,
        winner,
      };

      if (s.config.aiLevel === 'adaptive') {
        const playerElim = countEliminated(playersRevealed.find(p => p.id === PLAYER_ID)!.board);
        const playerRes = results.find(r => r.id === PLAYER_ID)!;
        const closerRes = results.find(r => r.id === closerId)!;
        const lowestRoundScore = Math.min(...results.map(r => r.roundScore));

        const newMem = evolveMemory(memory, {
          playerClosed: closerId === PLAYER_ID,
          playerDoubled: playerRes.doubled,
          botClosedAndDoubled: closerId !== PLAYER_ID && closerRes.doubled,
          turnsInRound: Math.max(1, Math.floor(roundTurnsRef.current / s.players.length)),
          playerEliminatedColumns: Math.floor(playerElim / 3),
          playerWonRound: playerRes.roundScore === lowestRoundScore,
          isGameOver: someoneOver100,
          playerWonGame: winner === PLAYER_ID,
        });
        setMemory(newMem);
      }

      pendingFinishRef.current = { result };

      return {
        ...s,
        players: updatedPlayers,
        phase: 'end_routine',
        stage: 'choose_source',
        pendingDraw: null,
        pendingHighlight: null,
        lastAction: 'Ronda terminada',
      };
    },
    [memory]
  );

  // ---- Gestión unificada de avance de turno y cierre de ronda ----
  const advanceToNextPlayer = useCallback((s: GameState): GameState => {
    const curIdx = s.currentPlayerIndex;
    let nextIdx = (curIdx + 1) % s.turnOrder.length;
    if (s.lastRoundTriggered && s.lastRoundCloser && s.turnOrder[nextIdx] === s.lastRoundCloser) {
      nextIdx = (nextIdx + 1) % s.turnOrder.length;
    }
    const nextPlayer = s.players[nextIdx];
    const isLastTurn = s.lastRoundTriggered;
    return {
      ...s,
      currentPlayerIndex: nextIdx,
      stage: nextPlayer.isBot ? 'bot_thinking' : 'choose_source',
      lastAction: isLastTurn
        ? nextPlayer.isBot
          ? `${nextPlayer.name} juega su último turno...`
          : '¡Última ronda! Juega tu último turno.'
        : nextPlayer.isBot
          ? `${nextPlayer.name} está pensando...`
          : 'Tu turno: roba del mazo o coge del descarte',
      pendingDraw: null,
    };
  }, []);

  const completeTurn = useCallback(
    (s: GameState, actorId: string): GameState => {
      roundTurnsRef.current += 1;
      const actor = s.players.find(p => p.id === actorId)!;

      // 1. Si nadie había cerrado aún y este jugador tiene todas sus cartas descubiertas/eliminadas
      if (!s.lastRoundTriggered && allRevealed(actor.board)) {
        const remaining = s.turnOrder.length - 1;
        const triggeredState: GameState = {
          ...s,
          lastRoundTriggered: true,
          lastRoundCloser: actorId,
          lastRoundRemaining: s.turnOrder.filter(id => id !== actorId),
          remainingFinalTurns: remaining,
          lastAction:
            actorId === PLAYER_ID
              ? '¡Última ronda! Cerraste.'
              : `¡Última ronda! ${actor.name} cerró.`,
        };
        if (remaining <= 0) {
          return endRound(triggeredState, actorId);
        }
        return advanceToNextPlayer(triggeredState);
      }

      // 2. Si la última ronda ya estaba activa y actúa alguien distinto al que cerró
      if (s.lastRoundTriggered && actorId !== s.lastRoundCloser) {
        const nextRemaining = Math.max(0, s.remainingFinalTurns - 1);
        const updatedState: GameState = {
          ...s,
          remainingFinalTurns: nextRemaining,
          lastRoundRemaining: s.lastRoundRemaining.filter(id => id !== actorId),
        };
        if (nextRemaining === 0) {
          return endRound(updatedState, s.lastRoundCloser!);
        }
        return advanceToNextPlayer(updatedState);
      }

      // 3. Turno normal
      return advanceToNextPlayer(s);
    },
    [advanceToNextPlayer, endRound]
  );

  // ---- Player initial reveal ----
  const revealInitialCard = useCallback((index: number) => {
    setState(prev => {
      if (!prev || prev.phase !== 'reveal_initial') return prev;
      const pid = PLAYER_ID;
      if (prev.initialRevealed[pid] >= 2) return prev;
      const players = prev.players.map(p => {
        if (p.id !== pid) return p;
        const board = p.board.map((c, i) => (i === index ? { ...c, revealed: true } : c));
        return { ...p, board };
      });
      const count = prev.initialRevealed[pid] + 1;
      let next = {
        ...prev,
        players,
        initialRevealed: { ...prev.initialRevealed, [pid]: count },
        lastAction: count < 2 ? `Voltea 1 carta más (${count}/2)` : 'Preparando...',
      };

      if (count >= 2) {
        let botPlayers = players;
        for (const p of botPlayers) {
          if (!p.isBot) continue;
          const botHidden = hiddenIndices(p.board);
          const picks = shuffle([...botHidden]).slice(0, 2);
          botPlayers = botPlayers.map(bp => {
            if (bp.id !== p.id) return bp;
            const board = bp.board.map((c, i) => (picks.includes(i) ? { ...c, revealed: true } : c));
            return { ...bp, board };
          });
        }
        next = { ...next, players: botPlayers };

        let bestId = '';
        let bestSum = -Infinity;
        for (const p of botPlayers) {
          const revealedVals = p.board.filter(c => c.revealed && c.card).map(c => c.card!.value);
          const sum = revealedVals.reduce((a, b) => a + b, 0);
          if (sum > bestSum) {
            bestSum = sum;
            bestId = p.id;
          }
        }
        const startIdx = botPlayers.findIndex(p => p.id === bestId);
        const starter = botPlayers[startIdx];
        next = {
          ...next,
          currentPlayerIndex: startIdx,
          phase: 'playing',
          stage: starter.isBot ? 'bot_thinking' : 'choose_source',
          lastAction: starter.isBot
            ? `${starter.name} empieza...`
            : '¡Empiezas tú! Roba del mazo o coge del descarte',
        };
      }
      return next;
    });
  }, []);

  // ---- Player source choice ----
  const playerTakeDiscard = useCallback(() => {
    setState(prev => {
      if (!prev || prev.phase !== 'playing') return prev;
      if (prev.players[prev.currentPlayerIndex].id !== PLAYER_ID) return prev;
      if (prev.stage !== 'choose_source') return prev;
      if (prev.discard.length === 0) return prev;
      const top = prev.discard[0];
      return {
        ...prev,
        pendingDraw: { card: top, source: 'from_descarte' },
        stage: 'must_place',
        discard: prev.discard.slice(1),
        lastAction: 'Elegiste el descarte. Pulsa una carta de tu tablero para intercambiarla.',
      };
    });
  }, []);

  const playerDrawDeck = useCallback(() => {
    setState(prev => {
      if (!prev || prev.phase !== 'playing') return prev;
      if (prev.players[prev.currentPlayerIndex].id !== PLAYER_ID) return prev;
      if (prev.stage !== 'choose_source') return prev;
      const s = ensureDeck(prev);
      if (s.deck.length === 0) return prev;
      const drawn = s.deck[0];
      return {
        ...s,
        deck: s.deck.slice(1),
        pendingDraw: { card: drawn, source: 'from_mazo' },
        stage: 'must_place',
        lastAction: 'Robaste del mazo. Coloca en tu tablero o descarta.',
      };
    });
  }, [ensureDeck]);

  const playerPlaceCard = useCallback(
    (index: number) => {
      setState(prev => {
        if (!prev || prev.phase !== 'playing') return prev;
        if (prev.players[prev.currentPlayerIndex].id !== PLAYER_ID) return prev;
        if (prev.stage !== 'must_place' || !prev.pendingDraw) return prev;
        const drawn = prev.pendingDraw.card;
        const player = prev.players[prev.currentPlayerIndex];
        const oldCard = player.board[index].card;
        const board = player.board.map((c, i) =>
          i === index ? { card: drawn, revealed: true, eliminated: false } : c
        );
        let discard = prev.discard;
        let discardCounts = prev.discardCounts;
        if (oldCard) {
          discard = [oldCard, ...discard];
          discardCounts = updateDiscardCounts(discardCounts, oldCard);
        }
        let s: GameState = {
          ...prev,
          players: prev.players.map(p => (p.id === player.id ? { ...p, board } : p)),
          discard,
          discardCounts,
          pendingDraw: null,
          pendingHighlight: { player: player.id, index, action: 'place' },
          stage: 'choose_source',
          lastAction: 'Carta colocada',
        };
        s = checkColumnEliminations(s, player.id);
        return completeTurn(s, player.id);
      });
      triggerDiscardPulse();
    },
    [checkColumnEliminations, completeTurn, triggerDiscardPulse]
  );

  const playerDiscardDrawn = useCallback(() => {
    setState(prev => {
      if (!prev || prev.phase !== 'playing') return prev;
      if (prev.players[prev.currentPlayerIndex].id !== PLAYER_ID) return prev;
      if (prev.stage !== 'must_place' || !prev.pendingDraw) return prev;
      const drawn = prev.pendingDraw.card;
      return {
        ...prev,
        discard: [drawn, ...prev.discard],
        discardCounts: updateDiscardCounts(prev.discardCounts, drawn),
        pendingDraw: null,
        stage: 'discard_then_flip',
        lastAction: 'Carta descartada. Pulsa una carta boca abajo para voltearla.',
      };
    });
    triggerDiscardPulse();
  }, [triggerDiscardPulse]);

  const playerFlipHidden = useCallback(
    (index: number) => {
      setState(prev => {
        if (!prev || prev.phase !== 'playing') return prev;
        if (prev.players[prev.currentPlayerIndex].id !== PLAYER_ID) return prev;
        if (prev.stage !== 'discard_then_flip') return prev;
        const player = prev.players[prev.currentPlayerIndex];
        const cell = player.board[index];
        if (!cell.card || cell.revealed || cell.eliminated) return prev;
        const board = player.board.map((c, i) => (i === index ? { ...c, revealed: true } : c));
        let s: GameState = {
          ...prev,
          players: prev.players.map(p => (p.id === player.id ? { ...p, board } : p)),
          pendingHighlight: { player: player.id, index, action: 'flip' },
          stage: 'choose_source',
          lastAction: 'Carta volteada',
        };
        s = checkColumnEliminations(s, player.id);
        return completeTurn(s, player.id);
      });
    },
    [checkColumnEliminations, completeTurn]
  );

  const nextRound = useCallback(() => {
    roundTurnsRef.current = 0;
    pendingFinishRef.current = null;
    setRoundResult(null);
    setState(prev => {
      if (!prev) return prev;
      return dealNewRound({ ...prev, roundNumber: prev.roundNumber + 1 });
    });
  }, []);

  // ---- Bot turn runner ----
  const runBotTurn = useCallback(
    async (cur: GameState) => {
      let s = cur;
      const bot = s.players[s.currentPlayerIndex];
      if (!bot || !bot.isBot) return;

      const playerCount = s.config.playerCount;
      const pauseMs = playerCount >= 3 ? 700 : 900;

      await sleep(pauseMs);
      s = { ...s, stage: 'bot_thinking', lastAction: `${bot.name} está pensando...` };
      setState(s);

      const mem = s.config.aiLevel === 'adaptive' ? memory : null;
      const level: AILevel = s.config.aiLevel;

      const decision = decideBotMove(bot.board, s.discard[0] ?? null, s, level, mem);

      if (decision.source === 'discard') {
        const top = s.discard[0];
        const placeIdx = decision.placeIndex!;
        await sleep(pauseMs * 0.7);
        s = {
          ...s,
          pendingHighlight: { player: bot.id, index: placeIdx, action: 'place' },
          lastAction: `${bot.name} coge del descarte`,
        };
        setState(s);
        await sleep(pauseMs);

        const oldCard = bot.board[placeIdx].card;
        const newBoard = bot.board.map((c, i) =>
          i === placeIdx ? { card: top, revealed: true, eliminated: false } : c
        );
        let newDiscard = s.discard.slice(1);
        let discardCounts = s.discardCounts;
        if (oldCard) {
          newDiscard = [oldCard, ...newDiscard];
          discardCounts = updateDiscardCounts(discardCounts, oldCard);
        }
        s = {
          ...s,
          players: s.players.map(p => (p.id === bot.id ? { ...p, board: newBoard } : p)),
          discard: newDiscard,
          discardCounts,
          pendingHighlight: { player: bot.id, index: placeIdx, action: 'place' },
          lastAction: `${bot.name} intercambia carta`,
        };
        s = checkColumnEliminations(s, bot.id);
        setState(s);
        if (oldCard) triggerDiscardPulse();
        await sleep(pauseMs * 0.6);
      } else {
        s = ensureDeck(s);
        if (s.deck.length === 0) {
          s = { ...s, lastAction: `${bot.name} no pudo robar` };
          setState(s);
          await sleep(400);
        } else {
          const drawn = s.deck[0];
          await sleep(pauseMs * 0.6);
          s = {
            ...s,
            pendingDraw: { card: drawn, source: 'from_mazo' },
            deck: s.deck.slice(1),
            lastAction: `${bot.name} roba del mazo`,
          };
          setState(s);
          await sleep(pauseMs);

          const placement = decideBotPlacement(
            s.players[s.currentPlayerIndex].board,
            drawn.value,
            s,
            level,
            mem
          );
          await sleep(pauseMs * 0.4);

          if (placement.place && placement.placeIndex !== null) {
            const idx = placement.placeIndex;
            s = {
              ...s,
              pendingHighlight: { player: bot.id, index: idx, action: 'place' },
              lastAction: `${bot.name} coloca carta`,
            };
            setState(s);
            await sleep(pauseMs);

            const oldCard = s.players[s.currentPlayerIndex].board[idx].card;
            const newBoard = s.players[s.currentPlayerIndex].board.map((c, i) =>
              i === idx ? { card: drawn, revealed: true, eliminated: false } : c
            );
            let newDiscard = s.discard;
            let discardCounts = s.discardCounts;
            if (oldCard) {
              newDiscard = [oldCard, ...newDiscard];
              discardCounts = updateDiscardCounts(discardCounts, oldCard);
            }
            s = {
              ...s,
              players: s.players.map(p => (p.id === bot.id ? { ...p, board: newBoard } : p)),
              discard: newDiscard,
              discardCounts,
              pendingDraw: null,
              pendingHighlight: { player: bot.id, index: idx, action: 'place' },
              lastAction: `${bot.name} intercambia`,
            };
            s = checkColumnEliminations(s, bot.id);
            setState(s);
            if (oldCard) triggerDiscardPulse();
            await sleep(pauseMs * 0.5);
          } else {
            const newDiscard = [drawn, ...s.discard];
            const discardCounts = updateDiscardCounts(s.discardCounts, drawn);
            let newBoard = s.players[s.currentPlayerIndex].board;
            if (placement.flipIndex !== null) {
              const fi = placement.flipIndex;
              s = {
                ...s,
                pendingHighlight: { player: bot.id, index: fi, action: 'flip' },
                lastAction: `${bot.name} descarta y voltea`,
              };
              setState(s);
              await sleep(pauseMs);
              newBoard = newBoard.map((c, i) => (i === fi ? { ...c, revealed: true } : c));
            }
            s = {
              ...s,
              players: s.players.map(p => (p.id === bot.id ? { ...p, board: newBoard } : p)),
              discard: newDiscard,
              discardCounts,
              pendingDraw: null,
              pendingHighlight:
                placement.flipIndex !== null
                  ? { player: bot.id, index: placement.flipIndex, action: 'flip' }
                  : null,
              lastAction: `${bot.name} descarta y voltea`,
            };
            s = checkColumnEliminations(s, bot.id);
            setState(s);
            triggerDiscardPulse();
            await sleep(pauseMs * 0.5);
          }
        }
      }

      // Fin de turno del bot: limpia el resaltado y evalúa cierre/siguiente jugador
      await sleep(200);
      const cleanState: GameState = { ...s, pendingHighlight: null };
      const nextState = completeTurn(cleanState, bot.id);
      setState(nextState);
    },
    [memory, checkColumnEliminations, ensureDeck, completeTurn, triggerDiscardPulse]
  );

  // drive bot turns
  useEffect(() => {
    if (!state) return;
    if (state.phase === 'playing' && state.stage === 'bot_thinking' && !busyRef.current) {
      const current = state.players[state.currentPlayerIndex];
      if (current && current.isBot) {
        busyRef.current = true;
        runBotTurn(state).finally(() => {
          busyRef.current = false;
        });
      }
    }
  }, [state, runBotTurn]);

  return {
    state,
    roundResult,
    rulesOpen,
    setupOpen,
    gameWinner,
    memory,
    setRulesOpen,
    setSetupOpen,
    startGame,
    resetGame,
    playAgain,
    resetAdaptiveMemory,
    revealInitialCard,
    playerTakeDiscard,
    playerDrawDeck,
    playerPlaceCard,
    playerDiscardDrawn,
    playerFlipHidden,
    nextRound,
  };
}