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
import {
  OnlineRoomRow,
  getRoom,
  updateRoomState,
} from '@/lib/supabase';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type SyncedGameState = GameState & {
  _rev?: number;
  _roundResult?: RoundResult | null;
};

function buildPlayers(config: GameConfig): Player[] {
  const players: Player[] = [
    { id: PLAYER_ID, name: 'Tú', isBot: false, board: emptyBoard(), score: 0 },
  ];
  for (let i = 0; i < config.playerCount - 1; i++) {
    players.push({
      id: BOT_IDS[i],
      name: BOT_NAMES[i],
      isBot: true,
      board: emptyBoard(),
      score: 0,
    });
  }
  return players;
}

function dealNewRound(state: SyncedGameState, isOnline = false): SyncedGameState {
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
    lastAction: isOnline
      ? 'Voltead 2 cartas cada uno para empezar'
      : 'Voltea 2 de tus cartas para empezar',
    lastRoundTriggered: false,
    lastRoundCloser: null,
    lastRoundRemaining: [],
    remainingFinalTurns: 0,
    initialRevealed: Object.fromEntries(players.map(p => [p.id, 0])),
    pendingHighlight: null,
    discardCounts,
    discardPulse: false,
    _rev: (state._rev ?? 0) + 1,
    _roundResult: null,
  };
}

function freshState(config: GameConfig, customPlayers?: Player[]): SyncedGameState {
  const players = customPlayers ?? buildPlayers(config);
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
    roundHistory: [],
    _rev: 1,
    _roundResult: null,
  };
}

function updateDiscardCounts(counts: Record<number, number>, card: Card): Record<number, number> {
  return { ...counts, [card.value]: (counts[card.value] || 0) + 1 };
}

// Mejora 1: fusiona el estado remoto con las cartas iniciales volteadas localmente para que nunca se pisen
function mergeInitialRevealStates(
  local: SyncedGameState,
  remote: SyncedGameState,
  myId: string
): { merged: SyncedGameState; needsRePush: boolean } {
  if (local.phase !== 'reveal_initial' || remote.phase !== 'reveal_initial') {
    return { merged: remote, needsRePush: false };
  }
  if (local.roundNumber !== remote.roundNumber) {
    return { merged: remote, needsRePush: false };
  }

  const localMe = local.players.find(p => p.id === myId);
  const remoteMe = remote.players.find(p => p.id === myId);
  if (!localMe || !remoteMe) {
    return { merged: remote, needsRePush: false };
  }

  const localMyCount = localMe.board.filter(c => c.revealed).length;
  const remoteMyCount = remoteMe.board.filter(c => c.revealed).length;

  // Si localmente tengo más cartas reveladas mías que lo que llegó de Supabase, conservar mi tablero
  if (localMyCount <= remoteMyCount) {
    return { merged: remote, needsRePush: false };
  }

  const mergedPlayers = remote.players.map(p => (p.id === myId ? localMe : p));
  const mergedInitialRevealed: Record<string, number> = {
    ...remote.initialRevealed,
    [myId]: localMyCount,
  };

  const humanPlayers = mergedPlayers.filter(p => !p.isBot);
  const allHumansReady = humanPlayers.every(hp => (mergedInitialRevealed[hp.id] ?? 0) >= 2);

  if (!allHumansReady) {
    return {
      merged: {
        ...remote,
        players: mergedPlayers,
        initialRevealed: mergedInitialRevealed,
      },
      needsRePush: true,
    };
  }

  // Si con mi jugada ya están todos listos, arrancar la partida directamente
  let finalPlayers = mergedPlayers;
  for (const p of finalPlayers) {
    if (!p.isBot) continue;
    const botHidden = hiddenIndices(p.board);
    const picks = shuffle([...botHidden]).slice(0, 2);
    finalPlayers = finalPlayers.map(bp => {
      if (bp.id !== p.id) return bp;
      const board = bp.board.map((c, i) => (picks.includes(i) ? { ...c, revealed: true } : c));
      return { ...bp, board };
    });
  }

  let bestId = '';
  let bestSum = -Infinity;
  for (const p of finalPlayers) {
    const revealedVals = p.board.filter(c => c.revealed && c.card).map(c => c.card!.value);
    const sum = revealedVals.reduce((a, b) => a + b, 0);
    if (sum > bestSum) {
      bestSum = sum;
      bestId = p.id;
    }
  }
  const startIdx = finalPlayers.findIndex(p => p.id === bestId);
  const starter = finalPlayers[startIdx];

  return {
    merged: {
      ...remote,
      players: finalPlayers,
      initialRevealed: mergedInitialRevealed,
      currentPlayerIndex: startIdx,
      phase: 'playing',
      stage: starter.isBot ? 'bot_thinking' : 'choose_source',
      lastAction: starter.isBot
        ? `${starter.name} empieza...`
        : starter.id === myId
          ? '¡Empiezas tú! Roba del mazo o coge del descarte'
          : `¡Empieza ${starter.name}!`,
    },
    needsRePush: true,
  };
}

export function useSkyjo() {
  const [state, setState] = useState<SyncedGameState | null>(null);
  const [localPlayerId, setLocalPlayerId] = useState<string>(PLAYER_ID);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [gameWinner, setGameWinner] = useState<string | null>(null);
  const [memory, setMemory] = useState<AdaptiveMemory>(() => loadMemory());

  const busyRef = useRef(false);
  const roundTurnsRef = useRef(0);
  const pendingFinishRef = useRef<{ result: RoundResult } | null>(null);
  const stateRef = useRef<SyncedGameState | null>(null);
  stateRef.current = state;

  const localRevRef = useRef<number>(0);
  const syncLockUntilRef = useRef<number>(0);
  const pushInFlightRef = useRef<boolean>(false);
  const queuedPushStateRef = useRef<SyncedGameState | null>(null);

  const isOnline = Boolean(roomCode);
  const isHost = !isOnline || hostId === localPlayerId;

  const pushOnlineState = useCallback(
    async (nextState: SyncedGameState) => {
      if (!roomCode) return;
      const nextRev = Math.max(localRevRef.current + 1, (nextState._rev ?? 0) + 1);
      const stamped: SyncedGameState = { ...nextState, _rev: nextRev };
      localRevRef.current = nextRev;
      syncLockUntilRef.current = Date.now() + 1800;

      if (pushInFlightRef.current) {
        queuedPushStateRef.current = stamped;
        return;
      }

      pushInFlightRef.current = true;
      let toSend: SyncedGameState | null = stamped;
      try {
        while (toSend) {
          queuedPushStateRef.current = null;
          await updateRoomState(roomCode, {
            status: 'playing',
            game_state: toSend,
          });
          syncLockUntilRef.current = Date.now() + 700;
          toSend = queuedPushStateRef.current;
        }
      } finally {
        pushInFlightRef.current = false;
      }
    },
    [roomCode]
  );

  const applyLocalMutation = useCallback(
    (updater: (prev: SyncedGameState) => SyncedGameState | null) => {
      setState(prev => {
        if (!prev) return prev;
        const next = updater(prev);
        if (!next || next === prev) return prev;
        if (roomCode) {
          const nextRev = Math.max(localRevRef.current + 1, (next._rev ?? 0) + 1);
          const stamped = { ...next, _rev: nextRev };
          localRevRef.current = nextRev;
          syncLockUntilRef.current = Date.now() + 1800;
          void pushOnlineState(stamped);
          return stamped;
        }
        return next;
      });
    },
    [roomCode, pushOnlineState]
  );

  // Sincronización periódica con fusión segura en fase inicial
  useEffect(() => {
    if (!roomCode) return;
    let active = true;

    const poll = async () => {
      if (!active) return;
      if (pushInFlightRef.current || Date.now() < syncLockUntilRef.current) {
        return;
      }
      const remote = await getRoom(roomCode);
      if (!active || !remote || !remote.game_state) return;
      if (pushInFlightRef.current || Date.now() < syncLockUntilRef.current) {
        return;
      }

      const remoteState = remote.game_state as SyncedGameState;
      const remoteRev = remoteState._rev ?? 0;

      if (remoteRev > localRevRef.current) {
        const currentLocal = stateRef.current;
        if (currentLocal) {
          const { merged, needsRePush } = mergeInitialRevealStates(
            currentLocal,
            remoteState,
            localPlayerId
          );
          if (needsRePush) {
            const stamped = { ...merged, _rev: remoteRev + 1 };
            localRevRef.current = stamped._rev;
            setState(stamped);
            void pushOnlineState(stamped);
            return;
          }
        }

        localRevRef.current = remoteRev;
        setState(remoteState);
        if (remoteState._roundResult !== undefined) {
          setRoundResult(remoteState._roundResult);
          setGameWinner(remoteState._roundResult?.winner ?? null);
        }
      }
    };

    const interval = setInterval(poll, 650);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [roomCode, localPlayerId, pushOnlineState]);

  const startGame = useCallback((config: GameConfig) => {
    roundTurnsRef.current = 0;
    pendingFinishRef.current = null;
    localRevRef.current = 1;
    syncLockUntilRef.current = 0;
    setRoomCode(null);
    setHostId(null);
    setLocalPlayerId(PLAYER_ID);
    setRoundResult(null);
    setGameWinner(null);
    setSetupOpen(false);
    setState(() => dealNewRound(freshState(config), false));
  }, []);

  const startOnlineGame = useCallback(
    async (room: OnlineRoomRow, myPlayerId: string, fillWithBots: boolean) => {
      roundTurnsRef.current = 0;
      pendingFinishRef.current = null;
      const players: Player[] = room.players.map(p => ({
        id: p.id,
        name: p.name,
        isBot: false,
        board: emptyBoard(),
        score: 0,
      }));

      if (fillWithBots) {
        let botIdx = 0;
        while (players.length < 4 && botIdx < BOT_NAMES.length) {
          players.push({
            id: BOT_IDS[botIdx],
            name: BOT_NAMES[botIdx],
            isBot: true,
            board: emptyBoard(),
            score: 0,
          });
          botIdx++;
        }
      }

      const initial = dealNewRound(
        freshState({ playerCount: players.length, aiLevel: 'hard' }, players),
        true
      );
      localRevRef.current = initial._rev ?? 1;
      syncLockUntilRef.current = Date.now() + 2000;

      setRoomCode(room.code);
      setHostId(room.host_id);
      setLocalPlayerId(myPlayerId);
      setRoundResult(null);
      setGameWinner(null);
      setSetupOpen(false);
      setState(initial);

      await updateRoomState(room.code, {
        status: 'playing',
        game_state: initial,
      });
    },
    []
  );

  const joinStartedOnlineGame = useCallback((room: OnlineRoomRow, myPlayerId: string) => {
    const incoming = room.game_state as SyncedGameState | null;
    if (!incoming) return;
    roundTurnsRef.current = 0;
    pendingFinishRef.current = null;
    localRevRef.current = incoming._rev ?? 1;
    syncLockUntilRef.current = 0;

    setRoomCode(room.code);
    setHostId(room.host_id);
    setLocalPlayerId(myPlayerId);
    setRoundResult(incoming._roundResult ?? null);
    setGameWinner(incoming._roundResult?.winner ?? null);
    setSetupOpen(false);
    setState(incoming);
  }, []);

  const resetGame = useCallback(() => {
    roundTurnsRef.current = 0;
    pendingFinishRef.current = null;
    localRevRef.current = 0;
    syncLockUntilRef.current = 0;
    setRoomCode(null);
    setHostId(null);
    setLocalPlayerId(PLAYER_ID);
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
    applyLocalMutation(s => {
      const resetPlayers = s.players.map(p => ({ ...p, board: emptyBoard(), score: 0 }));
      return dealNewRound(freshState(s.config, resetPlayers), Boolean(roomCode));
    });
  }, [applyLocalMutation, roomCode]);

  const resetAdaptiveMemory = useCallback(() => {
    const m = resetMemory();
    setMemory(m);
  }, []);

  const triggerDiscardPulse = useCallback(() => {}, []);

  useEffect(() => {
    if (state?.phase === 'end_routine' && pendingFinishRef.current) {
      const { result } = pendingFinishRef.current;
      const timer = setTimeout(() => {
        pendingFinishRef.current = null;
        setRoundResult(result);
        if (result.winner) setGameWinner(result.winner);
        if (roomCode && isHost) {
          applyLocalMutation(prev => ({
            ...prev,
            _roundResult: result,
          }));
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [state?.phase, roomCode, isHost, applyLocalMutation]);

  useEffect(() => {
    if (isOnline && state?.phase === 'end_routine' && state._roundResult && !roundResult) {
      setRoundResult(state._roundResult);
      if (state._roundResult.winner) setGameWinner(state._roundResult.winner);
    }
  }, [isOnline, state?.phase, state?._roundResult, roundResult]);

  const ensureDeck = useCallback((s: SyncedGameState): SyncedGameState => {
    if (s.deck.length === 0 && s.discard.length > 1) {
      const top = s.discard[0];
      const rest = s.discard.slice(1);
      return { ...s, deck: shuffle(rest), discard: [top] };
    }
    return s;
  }, []);

  const checkColumnEliminations = useCallback(
    (s: SyncedGameState, playerId: string): SyncedGameState => {
      const player = s.players.find(p => p.id === playerId)!;
      let board = player.board;
      let discard = s.discard;
      let discardCounts = s.discardCounts;
      let changed = true;
      let elimCount = 0;
      let lastElimIndex: number | null = null;

      while (changed) {
        const cols = findEliminableColumns(board);
        if (cols.length === 0) {
          changed = false;
          break;
        }
        lastElimIndex = cols[0];
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
          pendingHighlight:
            lastElimIndex !== null
              ? { player: playerId, index: lastElimIndex, action: 'place' }
              : s.pendingHighlight,
          lastAction: `✨ ¡Columna eliminada de ${player.name}! ✨`,
        };
      }
      return s;
    },
    []
  );

  const endRound = useCallback(
    (s: SyncedGameState, closerId: string): SyncedGameState => {
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

      if (!isOnline && s.config.aiLevel === 'adaptive') {
        const playerElim = countEliminated(playersRevealed.find(p => p.id === localPlayerId)!.board);
        const playerRes = results.find(r => r.id === localPlayerId)!;
        const closerRes = results.find(r => r.id === closerId)!;
        const lowestRoundScore = Math.min(...results.map(r => r.roundScore));

        const newMem = evolveMemory(memory, {
          playerClosed: closerId === localPlayerId,
          playerDoubled: playerRes.doubled,
          botClosedAndDoubled: closerId !== localPlayerId && closerRes.doubled,
          turnsInRound: Math.max(1, Math.floor(roundTurnsRef.current / s.players.length)),
          playerEliminatedColumns: Math.floor(playerElim / 3),
          playerWonRound: playerRes.roundScore === lowestRoundScore,
          isGameOver: someoneOver100,
          playerWonGame: winner === localPlayerId,
        });
        setMemory(newMem);
      }

      pendingFinishRef.current = { result };

      const prevHistory = s.roundHistory ?? [];
      const updatedHistory = [
        ...prevHistory.filter(h => h.roundNumber !== s.roundNumber),
        { roundNumber: s.roundNumber, result },
      ];

      return {
        ...s,
        players: updatedPlayers,
        phase: 'end_routine',
        stage: 'choose_source',
        pendingDraw: null,
        pendingHighlight: null,
        roundHistory: updatedHistory,
        lastAction: '¡Ronda terminada! Revelando cartas...',
      };
    },
    [isOnline, localPlayerId, memory]
  );

  const advanceToNextPlayer = useCallback((s: SyncedGameState): SyncedGameState => {
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
          : `¡Última ronda! Turno final de ${nextPlayer.name}`
        : nextPlayer.isBot
          ? `${nextPlayer.name} está pensando...`
          : nextPlayer.id === PLAYER_ID
            ? 'Tu turno: roba del mazo o coge del descarte'
            : `Turno de ${nextPlayer.name}`,
      pendingDraw: null,
    };
  }, []);

  const completeTurn = useCallback(
    (s: SyncedGameState, actorId: string): SyncedGameState => {
      roundTurnsRef.current += 1;
      const actor = s.players.find(p => p.id === actorId)!;

      if (!s.lastRoundTriggered && allRevealed(actor.board)) {
        const remaining = s.turnOrder.length - 1;
        const triggeredState: SyncedGameState = {
          ...s,
          lastRoundTriggered: true,
          lastRoundCloser: actorId,
          lastRoundRemaining: s.turnOrder.filter(id => id !== actorId),
          remainingFinalTurns: remaining,
          lastAction: `¡Última ronda! ${actor.name} cerró.`,
        };
        if (remaining <= 0) {
          return endRound(triggeredState, actorId);
        }
        return advanceToNextPlayer(triggeredState);
      }

      if (s.lastRoundTriggered && actorId !== s.lastRoundCloser) {
        const nextRemaining = Math.max(0, s.remainingFinalTurns - 1);
        const updatedState: SyncedGameState = {
          ...s,
          remainingFinalTurns: nextRemaining,
          lastRoundRemaining: s.lastRoundRemaining.filter(id => id !== actorId),
        };
        if (nextRemaining === 0) {
          return endRound(updatedState, s.lastRoundCloser!);
        }
        return advanceToNextPlayer(updatedState);
      }

      return advanceToNextPlayer(s);
    },
    [advanceToNextPlayer, endRound]
  );

  const revealInitialCard = useCallback(
    (index: number) => {
      applyLocalMutation(prev => {
        if (prev.phase !== 'reveal_initial') return prev;
        const pid = localPlayerId;
        const currentCount = prev.initialRevealed[pid] ?? 0;
        if (currentCount >= 2) return prev;

        const cell = prev.players.find(p => p.id === pid)?.board[index];
        if (!cell || cell.revealed || cell.eliminated) return prev;

        const players = prev.players.map(p => {
          if (p.id !== pid) return p;
          const board = p.board.map((c, i) => (i === index ? { ...c, revealed: true } : c));
          return { ...p, board };
        });

        const count = currentCount + 1;
        const updatedInitialRevealed = { ...prev.initialRevealed, [pid]: count };

        const humanPlayers = players.filter(p => !p.isBot);
        const allHumansReady = humanPlayers.every(hp => (updatedInitialRevealed[hp.id] ?? 0) >= 2);

        if (!allHumansReady) {
          const me = players.find(p => p.id === pid);
          return {
            ...prev,
            players,
            initialRevealed: updatedInitialRevealed,
            lastAction:
              count < 2
                ? `${me?.name ?? 'Jugador'}: voltea 1 carta más (${count}/2)`
                : 'Esperando a que los demás volteen sus 2 cartas...',
          };
        }

        let finalPlayers = players;
        for (const p of finalPlayers) {
          if (!p.isBot) continue;
          const botHidden = hiddenIndices(p.board);
          const picks = shuffle([...botHidden]).slice(0, 2);
          finalPlayers = finalPlayers.map(bp => {
            if (bp.id !== p.id) return bp;
            const board = bp.board.map((c, i) => (picks.includes(i) ? { ...c, revealed: true } : c));
            return { ...bp, board };
          });
        }

        let bestId = '';
        let bestSum = -Infinity;
        for (const p of finalPlayers) {
          const revealedVals = p.board.filter(c => c.revealed && c.card).map(c => c.card!.value);
          const sum = revealedVals.reduce((a, b) => a + b, 0);
          if (sum > bestSum) {
            bestSum = sum;
            bestId = p.id;
          }
        }
        const startIdx = finalPlayers.findIndex(p => p.id === bestId);
        const starter = finalPlayers[startIdx];

        return {
          ...prev,
          players: finalPlayers,
          initialRevealed: updatedInitialRevealed,
          currentPlayerIndex: startIdx,
          phase: 'playing',
          stage: starter.isBot ? 'bot_thinking' : 'choose_source',
          lastAction: starter.isBot
            ? `${starter.name} empieza...`
            : starter.id === PLAYER_ID
              ? '¡Empiezas tú! Roba del mazo o coge del descarte'
              : `¡Empieza ${starter.name}!`,
        };
      });
    },
    [applyLocalMutation, localPlayerId]
  );

  const playerTakeDiscard = useCallback(() => {
    applyLocalMutation(prev => {
      if (prev.phase !== 'playing') return prev;
      if (prev.players[prev.currentPlayerIndex].id !== localPlayerId) return prev;
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
  }, [applyLocalMutation, localPlayerId]);

  const playerDrawDeck = useCallback(() => {
    applyLocalMutation(prev => {
      if (prev.phase !== 'playing') return prev;
      if (prev.players[prev.currentPlayerIndex].id !== localPlayerId) return prev;
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
  }, [applyLocalMutation, ensureDeck, localPlayerId]);

  const playerPlaceCard = useCallback(
    (index: number) => {
      applyLocalMutation(prev => {
        if (prev.phase !== 'playing') return prev;
        if (prev.players[prev.currentPlayerIndex].id !== localPlayerId) return prev;
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
        let s: SyncedGameState = {
          ...prev,
          players: prev.players.map(p => (p.id === player.id ? { ...p, board } : p)),
          discard,
          discardCounts,
          pendingDraw: null,
          pendingHighlight: { player: player.id, index, action: 'place' },
          stage: 'choose_source',
          lastAction: `${player.name} colocó carta`,
        };
        s = checkColumnEliminations(s, player.id);
        return completeTurn(s, player.id);
      });
      triggerDiscardPulse();
    },
    [applyLocalMutation, checkColumnEliminations, completeTurn, localPlayerId, triggerDiscardPulse]
  );

  const playerDiscardDrawn = useCallback(() => {
    applyLocalMutation(prev => {
      if (prev.phase !== 'playing') return prev;
      if (prev.players[prev.currentPlayerIndex].id !== localPlayerId) return prev;
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
  }, [applyLocalMutation, localPlayerId, triggerDiscardPulse]);

  const playerFlipHidden = useCallback(
    (index: number) => {
      applyLocalMutation(prev => {
        if (prev.phase !== 'playing') return prev;
        if (prev.players[prev.currentPlayerIndex].id !== localPlayerId) return prev;
        if (prev.stage !== 'discard_then_flip') return prev;
        const player = prev.players[prev.currentPlayerIndex];
        const cell = player.board[index];
        if (!cell.card || cell.revealed || cell.eliminated) return prev;
        const board = player.board.map((c, i) => (i === index ? { ...c, revealed: true } : c));
        let s: SyncedGameState = {
          ...prev,
          players: prev.players.map(p => (p.id === player.id ? { ...p, board } : p)),
          pendingHighlight: { player: player.id, index, action: 'flip' },
          stage: 'choose_source',
          lastAction: `${player.name} volteó carta`,
        };
        s = checkColumnEliminations(s, player.id);
        return completeTurn(s, player.id);
      });
    },
    [applyLocalMutation, checkColumnEliminations, completeTurn, localPlayerId]
  );

  const nextRound = useCallback(() => {
    roundTurnsRef.current = 0;
    pendingFinishRef.current = null;
    setRoundResult(null);
    applyLocalMutation(prev =>
      dealNewRound({ ...prev, roundNumber: prev.roundNumber + 1 }, Boolean(roomCode))
    );
  }, [applyLocalMutation, roomCode]);

  const runBotTurn = useCallback(
    async (cur: SyncedGameState) => {
      let s = cur;
      const bot = s.players[s.currentPlayerIndex];
      if (!bot || !bot.isBot) return;

      const playerCount = s.config.playerCount;
      const pauseMs = playerCount >= 3 ? 700 : 900;

      const syncBotStep = (next: SyncedGameState) => {
        if (roomCode) {
          const nextRev = Math.max(localRevRef.current + 1, (next._rev ?? 0) + 1);
          const stamped = { ...next, _rev: nextRev };
          localRevRef.current = nextRev;
          syncLockUntilRef.current = Date.now() + 1800;
          setState(stamped);
          void pushOnlineState(stamped);
          return stamped;
        }
        setState(next);
        return next;
      };

      await sleep(pauseMs);
      s = syncBotStep({ ...s, stage: 'bot_thinking', lastAction: `${bot.name} está pensando...` });

      const mem = !isOnline && s.config.aiLevel === 'adaptive' ? memory : null;
      const level: AILevel = s.config.aiLevel;

      const decision = decideBotMove(bot.board, s.discard[0] ?? null, s, level, mem);

      if (decision.source === 'discard') {
        const top = s.discard[0];
        const placeIdx = decision.placeIndex!;
        await sleep(pauseMs * 0.7);
        s = syncBotStep({
          ...s,
          pendingHighlight: { player: bot.id, index: placeIdx, action: 'place' },
          lastAction: `${bot.name} coge del descarte`,
        });
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
        s = syncBotStep({
          ...s,
          players: s.players.map(p => (p.id === bot.id ? { ...p, board: newBoard } : p)),
          discard: newDiscard,
          discardCounts,
          pendingHighlight: { player: bot.id, index: placeIdx, action: 'place' },
          lastAction: `${bot.name} intercambia carta`,
        });
        if (oldCard) triggerDiscardPulse();

        await sleep(pauseMs * 0.65);
        const beforeElim = s.lastAction;
        s = checkColumnEliminations(s, bot.id);
        if (s.lastAction !== beforeElim) {
          s = syncBotStep(s);
          await sleep(750);
        }
      } else {
        s = ensureDeck(s);
        if (s.deck.length === 0) {
          s = syncBotStep({ ...s, lastAction: `${bot.name} no pudo robar` });
          await sleep(400);
        } else {
          const drawn = s.deck[0];
          await sleep(pauseMs * 0.6);
          s = syncBotStep({
            ...s,
            pendingDraw: { card: drawn, source: 'from_mazo' },
            deck: s.deck.slice(1),
            lastAction: `${bot.name} roba del mazo`,
          });
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
            s = syncBotStep({
              ...s,
              pendingHighlight: { player: bot.id, index: idx, action: 'place' },
              lastAction: `${bot.name} coloca carta`,
            });
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
            s = syncBotStep({
              ...s,
              players: s.players.map(p => (p.id === bot.id ? { ...p, board: newBoard } : p)),
              discard: newDiscard,
              discardCounts,
              pendingDraw: null,
              pendingHighlight: { player: bot.id, index: idx, action: 'place' },
              lastAction: `${bot.name} intercambia`,
            });
            if (oldCard) triggerDiscardPulse();

            await sleep(pauseMs * 0.65);
            const beforeElim = s.lastAction;
            s = checkColumnEliminations(s, bot.id);
            if (s.lastAction !== beforeElim) {
              s = syncBotStep(s);
              await sleep(750);
            }
          } else {
            const newDiscard = [drawn, ...s.discard];
            const discardCounts = updateDiscardCounts(s.discardCounts, drawn);
            let newBoard = s.players[s.currentPlayerIndex].board;
            if (placement.flipIndex !== null) {
              const fi = placement.flipIndex;
              s = syncBotStep({
                ...s,
                pendingHighlight: { player: bot.id, index: fi, action: 'flip' },
                lastAction: `${bot.name} descarta y voltea`,
              });
              await sleep(pauseMs);
              newBoard = newBoard.map((c, i) => (i === fi ? { ...c, revealed: true } : c));
            }
            s = syncBotStep({
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
            });
            triggerDiscardPulse();

            await sleep(pauseMs * 0.65);
            const beforeElim = s.lastAction;
            s = checkColumnEliminations(s, bot.id);
            if (s.lastAction !== beforeElim) {
              s = syncBotStep(s);
              await sleep(750);
            }
          }
        }
      }

      await sleep(200);
      const cleanState: SyncedGameState = { ...s, pendingHighlight: null };
      const nextState = completeTurn(cleanState, bot.id);
      syncBotStep(nextState);
    },
    [
      isOnline,
      memory,
      checkColumnEliminations,
      ensureDeck,
      completeTurn,
      triggerDiscardPulse,
      roomCode,
      pushOnlineState,
    ]
  );

  useEffect(() => {
    if (!state || !isHost) return;
    if (state.phase === 'playing' && state.stage === 'bot_thinking' && !busyRef.current) {
      const current = state.players[state.currentPlayerIndex];
      if (current && current.isBot) {
        busyRef.current = true;
        runBotTurn(state).finally(() => {
          busyRef.current = false;
        });
      }
    }
  }, [state, isHost, runBotTurn]);

  return {
    state,
    localPlayerId,
    roundResult,
    rulesOpen,
    historyOpen,
    setupOpen,
    gameWinner,
    memory,
    setRulesOpen,
    setHistoryOpen,
    setSetupOpen,
    startGame,
    startOnlineGame,
    joinStartedOnlineGame,
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