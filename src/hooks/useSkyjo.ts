import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GameState, Player, Card, Board,
  RoundResult, RoundPlayerResult, GameConfig, AdaptiveMemory,
  BOT_NAMES, BOT_IDS, PLAYER_ID, AILevel,
} from '@/game/types';
import { createDeck, shuffle, actionLabel } from '@/game/deck';
import {
  emptyBoard, dealCardsToBoard, allRevealed, getFullScore,
  findEliminableColumns, eliminateColumns,
  hiddenIndices, countEliminated,
} from '@/game/board';
import { decideBotMove, decideBotPlacement, decideBotAction } from '@/game/bot';
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
  const withExpansion = Boolean(!isOnline && state.config.withExpansion);
  const deck = shuffle(createDeck(withExpansion));
  const players = state.players.map(p => {
    const cards = deck.splice(0, 12);
    return { ...p, board: dealCardsToBoard(emptyBoard(), cards) };
  });

  let firstDiscardIdx = deck.findIndex(c => c.kind !== 'action');
  if (firstDiscardIdx === -1) firstDiscardIdx = 0;
  const [firstDiscard] = deck.splice(firstDiscardIdx, 1);

  const discardCounts: Record<number, number> = {};
  if (firstDiscard && firstDiscard.kind === 'number') {
    discardCounts[firstDiscard.value] = (discardCounts[firstDiscard.value] || 0) + 1;
  }

  return {
    ...state,
    deck,
    discard: [firstDiscard],
    players,
    phase: 'reveal_initial',
    stage: 'choose_source',
    currentPlayerIndex: 0,
    pendingDraw: null,
    pendingAction: null,
    extraTurnsRemaining: 0,
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
    pendingAction: null,
    extraTurnsRemaining: 0,
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
  if (card.kind && card.kind !== 'number') return counts;
  return { ...counts, [card.value]: (counts[card.value] || 0) + 1 };
}

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
        freshState({ playerCount: players.length, aiLevel: 'hard', withExpansion: false }, players),
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
        pendingAction: null,
        extraTurnsRemaining: 0,
        pendingHighlight: null,
        roundHistory: updatedHistory,
        lastAction: '¡Ronda terminada! Revelando cartas...',
      };
    },
    [isOnline, localPlayerId, memory]
  );

  const advanceToNextPlayer = useCallback((s: SyncedGameState): SyncedGameState => {
    if ((s.extraTurnsRemaining ?? 0) > 0 && !s.lastRoundTriggered) {
      const samePlayer = s.players[s.currentPlayerIndex];
      return {
        ...s,
        extraTurnsRemaining: (s.extraTurnsRemaining ?? 1) - 1,
        stage: samePlayer.isBot ? 'bot_thinking' : 'choose_source',
        pendingDraw: null,
        pendingAction: null,
        lastAction: samePlayer.isBot
          ? `${samePlayer.name} juega su turno extra...`
          : '⚡ ¡Turno extra! Roba del mazo o coge del descarte',
      };
    }

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
      pendingAction: null,
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
          extraTurnsRemaining: 0,
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
      if (top.kind === 'action') return prev;
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
      const isAction = drawn.kind === 'action';
      return {
        ...s,
        deck: s.deck.slice(1),
        pendingDraw: { card: drawn, source: 'from_mazo' },
        stage: 'must_place',
        lastAction: isAction
          ? `⚡ Robaste ${actionLabel(drawn.actionType).title}. Úsala o descártala.`
          : 'Robaste del mazo. Coloca en tu tablero o descarta.',
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
        if (drawn.kind === 'action') return prev;

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

  const playerUseActionCard = useCallback(() => {
    applyLocalMutation(prev => {
      if (prev.phase !== 'playing') return prev;
      if (prev.players[prev.currentPlayerIndex].id !== localPlayerId) return prev;
      if (prev.stage !== 'must_place' || !prev.pendingDraw) return prev;
      const drawn = prev.pendingDraw.card;
      if (drawn.kind !== 'action' || !drawn.actionType) return prev;

      const act = drawn.actionType;
      const discard = [drawn, ...prev.discard];

      if (act === 'extra_turn') {
        return {
          ...prev,
          discard,
          pendingDraw: null,
          pendingAction: null,
          extraTurnsRemaining: (prev.extraTurnsRemaining ?? 0) + 1,
          stage: 'discard_then_flip',
          lastAction: '⚡ ¡Turno extra activado! Voltea 1 carta oculta para acabar este turno.',
        };
      }

      if (act === 'draw_two') {
        const s = ensureDeck(prev);
        const card1 = s.deck[0];
        const card2 = s.deck[1];
        const drawnTwo = [card1, card2].filter(Boolean);
        if (drawnTwo.length === 0) {
          return {
            ...s,
            discard,
            pendingDraw: null,
            stage: 'discard_then_flip',
            lastAction: 'No quedan cartas en el mazo. Voltea 1 carta oculta.',
          };
        }
        return {
          ...s,
          deck: s.deck.slice(drawnTwo.length),
          discard,
          pendingDraw: null,
          stage: 'action_resolve',
          pendingAction: {
            actionType: 'draw_two',
            card: drawn,
            step: 'choose_drawn_two',
            drawnTwo,
          },
          lastAction: '⚡ Elige 1 de las 2 cartas robadas para quedártela:',
        };
      }

      const instructionMap = {
        swap_own: '⚡ Pulsa la 1ª carta de TU tablero que quieres mover:',
        swap_opponent: '⚡ Pulsa la carta de TU tablero que quieres dar al rival:',
        swap_column: '⚡ Pulsa cualquier carta de TU columna que quieres cambiar:',
        peek: '⚡ Pulsa 2 cartas boca abajo (tuyas o de rivales) para espiarlas (0/2):',
      };

      return {
        ...prev,
        discard,
        pendingDraw: null,
        stage: 'action_resolve',
        pendingAction: {
          actionType: act,
          card: drawn,
          step: 'select_first',
          peekedCards: [],
        },
        lastAction: instructionMap[act],
      };
    });
  }, [applyLocalMutation, ensureDeck, localPlayerId]);

  const playerChooseDrawnTwo = useCallback(
    (chosenIndex: number) => {
      applyLocalMutation(prev => {
        const pa = prev.pendingAction;
        if (prev.stage !== 'action_resolve' || !pa || pa.actionType !== 'draw_two' || !pa.drawnTwo) return prev;
        const chosen = pa.drawnTwo[chosenIndex];
        const other = pa.drawnTwo[chosenIndex === 0 ? 1 : 0];
        if (!chosen) return prev;

        const discard = other ? [other, ...prev.discard] : prev.discard;
        const discardCounts = other ? updateDiscardCounts(prev.discardCounts, other) : prev.discardCounts;

        return {
          ...prev,
          discard,
          discardCounts,
          pendingAction: null,
          pendingDraw: { card: chosen, source: 'from_mazo' },
          stage: 'must_place',
          lastAction: chosen.kind === 'action'
            ? `⚡ Elegiste ${actionLabel(chosen.actionType).title}. Úsala o descártala.`
            : 'Coloca la carta elegida en tu tablero o descártala.',
        };
      });
    },
    [applyLocalMutation]
  );

  const playerResolveActionTarget = useCallback(
    (targetPlayerId: string, cellIndex: number) => {
      applyLocalMutation(prev => {
        const pa = prev.pendingAction;
        if (prev.phase !== 'playing' || prev.stage !== 'action_resolve' || !pa) return prev;
        if (prev.players[prev.currentPlayerIndex].id !== localPlayerId) return prev;

        const targetPlayer = prev.players.find(p => p.id === targetPlayerId);
        if (!targetPlayer) return prev;
        const targetCell = targetPlayer.board[cellIndex];
        if (!targetCell || targetCell.eliminated || !targetCell.card) return prev;

        // 1. PEEK (Espiar ESTRICTAMENTE hasta 2 cartas boca abajo)
        if (pa.actionType === 'peek') {
          if (targetCell.revealed) return prev;
          const already = pa.peekedCards ?? [];
          // Bloquea cualquier clic si ya ha mirado 2 cartas
          if (already.length >= 2) return prev;
          if (already.some(p => p.playerId === targetPlayerId && p.index === cellIndex)) return prev;

          const nextPeeked = [...already, { playerId: targetPlayerId, index: cellIndex, card: targetCell.card }];
          const cardLabel =
            targetCell.card.kind === 'star'
              ? '★ (Estrella)'
              : targetCell.card.kind === 'action'
                ? actionLabel(targetCell.card.actionType).short
                : String(targetCell.card.value);

          const anyMoreHidden = prev.players.some(p =>
            p.board.some((c, i) => !c.eliminated && !c.revealed && !nextPeeked.some(pk => pk.playerId === p.id && pk.index === i))
          );

          if (nextPeeked.length >= 2 || !anyMoreHidden) {
            return {
              ...prev,
              pendingAction: { ...pa, peekedCards: nextPeeked },
              lastAction: `👁 (${nextPeeked.length}/2) ${targetPlayer.name}: ${cardLabel}. Pulsa "Listo, voltear carta".`,
            };
          }

          return {
            ...prev,
            pendingAction: { ...pa, peekedCards: nextPeeked },
            lastAction: `👁 (1/2) ${targetPlayer.name}: ${cardLabel}. Elige 1 carta más:`,
          };
        }

        // 2. SWAP OWN
        if (pa.actionType === 'swap_own') {
          if (targetPlayerId !== localPlayerId) return prev;
          if (pa.step === 'select_first') {
            return {
              ...prev,
              pendingAction: { ...pa, step: 'select_second', firstTarget: { playerId: localPlayerId, index: cellIndex } },
              lastAction: '⚡ Ahora pulsa la 2ª carta de TU tablero para intercambiarlas:',
            };
          }
          if (pa.step === 'select_second' && pa.firstTarget) {
            const idx1 = pa.firstTarget.index;
            if (idx1 === cellIndex) return prev;
            const me = prev.players.find(p => p.id === localPlayerId)!;
            const newBoard = [...me.board];
            const temp = newBoard[idx1];
            newBoard[idx1] = newBoard[cellIndex];
            newBoard[cellIndex] = temp;

            let s: SyncedGameState = {
              ...prev,
              players: prev.players.map(p => (p.id === localPlayerId ? { ...p, board: newBoard } : p)),
              pendingAction: null,
              stage: 'choose_source',
              lastAction: '⚡ Cartas intercambiadas en tu tablero',
            };
            s = checkColumnEliminations(s, localPlayerId);
            return completeTurn(s, localPlayerId);
          }
        }

        // 3. SWAP OPPONENT
        if (pa.actionType === 'swap_opponent') {
          if (pa.step === 'select_first') {
            if (targetPlayerId !== localPlayerId) return prev;
            return {
              ...prev,
              pendingAction: { ...pa, step: 'select_second', firstTarget: { playerId: localPlayerId, index: cellIndex } },
              lastAction: '⚡ Ahora pulsa la carta de un RIVAL que quieres robarle:',
            };
          }
          if (pa.step === 'select_second' && pa.firstTarget) {
            if (targetPlayerId === localPlayerId) return prev;
            const myIdx = pa.firstTarget.index;
            const me = prev.players.find(p => p.id === localPlayerId)!;
            const opp = targetPlayer;

            const myNewBoard = [...me.board];
            const oppNewBoard = [...opp.board];
            const myCell = myNewBoard[myIdx];
            const oppCell = oppNewBoard[cellIndex];
            myNewBoard[myIdx] = oppCell;
            oppNewBoard[cellIndex] = myCell;

            let s: SyncedGameState = {
              ...prev,
              players: prev.players.map(p => {
                if (p.id === localPlayerId) return { ...p, board: myNewBoard };
                if (p.id === opp.id) return { ...p, board: oppNewBoard };
                return p;
              }),
              pendingAction: null,
              stage: 'choose_source',
              lastAction: `⚡ Intercambiaste carta con ${opp.name}`,
            };
            s = checkColumnEliminations(s, localPlayerId);
            s = checkColumnEliminations(s, opp.id);
            return completeTurn(s, localPlayerId);
          }
        }

        // 4. SWAP COLUMN
        if (pa.actionType === 'swap_column') {
          const clickedCol = cellIndex % 4;
          const colCells = [clickedCol, clickedCol + 4, clickedCol + 8];
          if (colCells.some(i => targetPlayer.board[i].eliminated)) return prev;

          if (pa.step === 'select_first') {
            if (targetPlayerId !== localPlayerId) return prev;
            return {
              ...prev,
              pendingAction: { ...pa, step: 'select_second', firstTarget: { playerId: localPlayerId, index: clickedCol } },
              lastAction: `⚡ Columna ${clickedCol + 1} elegida. Pulsa ahora una columna de un RIVAL:`,
            };
          }
          if (pa.step === 'select_second' && pa.firstTarget) {
            if (targetPlayerId === localPlayerId) return prev;
            const myCol = pa.firstTarget.index;
            const oppCol = clickedCol;
            const me = prev.players.find(p => p.id === localPlayerId)!;
            const opp = targetPlayer;

            const myNewBoard = [...me.board];
            const oppNewBoard = [...opp.board];
            for (let row = 0; row < 3; row++) {
              const mIdx = myCol + row * 4;
              const oIdx = oppCol + row * 4;
              const tmp = myNewBoard[mIdx];
              myNewBoard[mIdx] = oppNewBoard[oIdx];
              oppNewBoard[oIdx] = tmp;
            }

            let s: SyncedGameState = {
              ...prev,
              players: prev.players.map(p => {
                if (p.id === localPlayerId) return { ...p, board: myNewBoard };
                if (p.id === opp.id) return { ...p, board: oppNewBoard };
                return p;
              }),
              pendingAction: null,
              stage: 'choose_source',
              lastAction: `⚡ Intercambiaste columna con ${opp.name}`,
            };
            s = checkColumnEliminations(s, localPlayerId);
            s = checkColumnEliminations(s, opp.id);
            return completeTurn(s, localPlayerId);
          }
        }

        return prev;
      });
    },
    [applyLocalMutation, checkColumnEliminations, completeTurn, localPlayerId]
  );

  const playerFinishOrCancelAction = useCallback(() => {
    applyLocalMutation(prev => {
      if (prev.stage !== 'action_resolve') return prev;
      return {
        ...prev,
        pendingAction: null,
        stage: 'discard_then_flip',
        lastAction: 'Acción finalizada. Pulsa una carta boca abajo para voltearla.',
      };
    });
  }, [applyLocalMutation]);

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
          let drawn = s.deck[0];
          await sleep(pauseMs * 0.6);
          s = syncBotStep({
            ...s,
            pendingDraw: { card: drawn, source: 'from_mazo' },
            deck: s.deck.slice(1),
            lastAction: `${bot.name} roba del mazo`,
          });
          await sleep(pauseMs);

          if (drawn.kind === 'action') {
            const actPlan = decideBotAction(s.players[s.currentPlayerIndex], drawn, s, level, mem);
            s = syncBotStep({
              ...s,
              discard: [drawn, ...s.discard],
              pendingDraw: null,
              lastAction: actPlan.useAction
                ? `⚡ ${bot.name} usa ${actionLabel(drawn.actionType).title}`
                : `${bot.name} descarta acción`,
            });
            await sleep(pauseMs * 0.8);

            if (actPlan.useAction && drawn.actionType === 'draw_two') {
              s = ensureDeck(s);
              const two = s.deck.slice(0, 2);
              if (two.length > 0) {
                s = { ...s, deck: s.deck.slice(two.length) };
                const sorted = [...two].sort((a, b) => {
                  const va = a.kind === 'star' ? -0.5 : a.kind === 'action' ? 99 : a.value;
                  const vb = b.kind === 'star' ? -0.5 : b.kind === 'action' ? 99 : b.value;
                  return va - vb;
                });
                drawn = sorted[0];
                if (sorted[1]) {
                  s = syncBotStep({
                    ...s,
                    discard: [sorted[1], ...s.discard],
                    discardCounts: updateDiscardCounts(s.discardCounts, sorted[1]),
                    pendingDraw: { card: drawn, source: 'from_mazo' },
                    lastAction: `⚡ ${bot.name} elige una carta de las 2`,
                  });
                  await sleep(pauseMs * 0.7);
                }
              }
            } else if (actPlan.useAction && drawn.actionType === 'swap_own' && actPlan.ownIndex !== undefined && actPlan.secondOwnIndex !== undefined) {
              const curBot = s.players.find(p => p.id === bot.id)!;
              const nb = [...curBot.board];
              const tmp = nb[actPlan.ownIndex];
              nb[actPlan.ownIndex] = nb[actPlan.secondOwnIndex];
              nb[actPlan.secondOwnIndex] = tmp;
              s = syncBotStep({
                ...s,
                players: s.players.map(p => (p.id === bot.id ? { ...p, board: nb } : p)),
                pendingHighlight: { player: bot.id, index: actPlan.secondOwnIndex, action: 'place' },
                lastAction: `⚡ ${bot.name} reordena su tablero`,
              });
              await sleep(pauseMs * 0.7);
              s = checkColumnEliminations(s, bot.id);
              s = syncBotStep(s);
              await sleep(300);
              const cleanState: SyncedGameState = { ...s, pendingHighlight: null };
              syncBotStep(completeTurn(cleanState, bot.id));
              return;
            } else if (actPlan.useAction && drawn.actionType === 'swap_opponent' && actPlan.ownIndex !== undefined && actPlan.targetPlayerId && actPlan.targetIndex !== undefined) {
              const curBot = s.players.find(p => p.id === bot.id)!;
              const opp = s.players.find(p => p.id === actPlan.targetPlayerId)!;
              const bBoard = [...curBot.board];
              const oBoard = [...opp.board];
              const tmp = bBoard[actPlan.ownIndex];
              bBoard[actPlan.ownIndex] = oBoard[actPlan.targetIndex];
              oBoard[actPlan.targetIndex] = tmp;
              s = syncBotStep({
                ...s,
                players: s.players.map(p => {
                  if (p.id === bot.id) return { ...p, board: bBoard };
                  if (p.id === opp.id) return { ...p, board: oBoard };
                  return p;
                }),
                pendingHighlight: { player: opp.id, index: actPlan.targetIndex, action: 'place' },
                lastAction: `⚡ ${bot.name} intercambia carta con ${opp.name}`,
              });
              await sleep(pauseMs * 0.8);
              s = checkColumnEliminations(s, bot.id);
              s = checkColumnEliminations(s, opp.id);
              s = syncBotStep(s);
              await sleep(300);
              const cleanState: SyncedGameState = { ...s, pendingHighlight: null };
              syncBotStep(completeTurn(cleanState, bot.id));
              return;
            } else if (actPlan.useAction && drawn.actionType === 'swap_column' && actPlan.ownCol !== undefined && actPlan.targetPlayerId && actPlan.targetCol !== undefined) {
              const curBot = s.players.find(p => p.id === bot.id)!;
              const opp = s.players.find(p => p.id === actPlan.targetPlayerId)!;
              const bBoard = [...curBot.board];
              const oBoard = [...opp.board];
              for (let r = 0; r < 3; r++) {
                const bi = actPlan.ownCol + r * 4;
                const oi = actPlan.targetCol + r * 4;
                const tmp = bBoard[bi];
                bBoard[bi] = oBoard[oi];
                oBoard[oi] = tmp;
              }
              s = syncBotStep({
                ...s,
                players: s.players.map(p => {
                  if (p.id === bot.id) return { ...p, board: bBoard };
                  if (p.id === opp.id) return { ...p, board: oBoard };
                  return p;
                }),
                pendingHighlight: { player: opp.id, index: actPlan.targetCol, action: 'place' },
                lastAction: `⚡ ${bot.name} cambia columna con ${opp.name}`,
              });
              await sleep(pauseMs * 0.8);
              s = checkColumnEliminations(s, bot.id);
              s = checkColumnEliminations(s, opp.id);
              s = syncBotStep(s);
              await sleep(300);
              const cleanState: SyncedGameState = { ...s, pendingHighlight: null };
              syncBotStep(completeTurn(cleanState, bot.id));
              return;
            } else {
              if (actPlan.useAction && drawn.actionType === 'extra_turn') {
                s = { ...s, extraTurnsRemaining: (s.extraTurnsRemaining ?? 0) + 1 };
              }
              const hid = hiddenIndices(s.players[s.currentPlayerIndex].board);
              if (hid.length > 0) {
                const fi = hid[0];
                const nb = s.players[s.currentPlayerIndex].board.map((c, i) => (i === fi ? { ...c, revealed: true } : c));
                s = syncBotStep({
                  ...s,
                  players: s.players.map(p => (p.id === bot.id ? { ...p, board: nb } : p)),
                  pendingHighlight: { player: bot.id, index: fi, action: 'flip' },
                  lastAction: `${bot.name} voltea carta`,
                });
                await sleep(pauseMs * 0.65);
                s = checkColumnEliminations(s, bot.id);
              }
              const cleanState: SyncedGameState = { ...s, pendingHighlight: null };
              syncBotStep(completeTurn(cleanState, bot.id));
              return;
            }
          }

          if (drawn.kind !== 'action') {
            const placement = decideBotPlacement(
              s.players[s.currentPlayerIndex].board,
              drawn,
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
    playerUseActionCard,
    playerChooseDrawnTwo,
    playerResolveActionTarget,
    playerFinishOrCancelAction,
    playerDiscardDrawn,
    playerFlipHidden,
    nextRound,
  };
}