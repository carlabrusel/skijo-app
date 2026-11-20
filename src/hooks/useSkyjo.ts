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
import { OnlineRoomRow, getRoom, updateRoomState } from '@/lib/supabase';

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

function buildOnlinePlayers(room: OnlineRoomRow, fillWithBots: boolean): Player[] {
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
        name: `Bot ${BOT_NAMES[botIdx]}`,
        isBot: true,
        board: emptyBoard(),
        score: 0,
      });
      botIdx++;
    }
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

function freshState(config: GameConfig, customPlayers?: Player[]): GameState {
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
  };
}

function updateDiscardCounts(counts: Record<number, number>, card: Card): Record<number, number> {
  return { ...counts, [card.value]: (counts[card.value] || 0) + 1 };
}

function buildRoundResultFromState(s: GameState): RoundResult {
  const closerId = s.lastRoundCloser || s.players[0].id;
  const results: RoundPlayerResult[] = s.players.map(p => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    roundScore: getFullScore(p.board),
    finalScore: p.score,
    doubled: false,
    eliminated: countEliminated(p.board),
    closed: p.id === closerId,
  }));
  const sortedResults = [...results].sort((a, b) => a.finalScore - b.finalScore);
  const someoneOver100 = s.players.some(p => p.score >= 100);
  const winner = someoneOver100
    ? s.players.reduce((min, p) => (p.score < min.score ? p : min)).id
    : null;
  return {
    players: sortedResults,
    closer: closerId,
    isFinal: someoneOver100,
    winner,
  };
}

export function useSkyjo() {
  const [state, setState] = useState<GameState | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [gameWinner, setGameWinner] = useState<string | null>(null);
  const [memory, setMemory] = useState<AdaptiveMemory>(() => loadMemory());

  // Estado online
  const [onlineRoomCode, setOnlineRoomCode] = useState<string | null>(null);
  const [onlineHostId, setOnlineHostId] = useState<string | null>(null);
  const [localPlayerId, setLocalPlayerId] = useState<string>(PLAYER_ID);

  const busyRef = useRef(false);
  const roundTurnsRef = useRef(0);
  const pendingFinishRef = useRef<{ result: RoundResult } | null>(null);
  const lastSyncedSnapshotRef = useRef<string>('');

  const pushOnlineState = useCallback(
    async (nextState: GameState, codeOverride?: string) => {
      const code = codeOverride ?? onlineRoomCode;
      if (!code) return;
      const serialized = JSON.stringify(nextState);
      lastSyncedSnapshotRef.current = serialized;
      await updateRoomState(code, { status: 'playing', game_state: nextState });
    },
    [onlineRoomCode]
  );

  // Sincronización periódica con Supabase en partidas online
  useEffect(() => {
    if (!onlineRoomCode || setupOpen) return;
    const interval = setInterval(async () => {
      const room = await getRoom(onlineRoomCode);
      if (!room || !room.game_state) return;
      const remote = room.game_state as GameState;
      const serialized = JSON.stringify(remote);
      if (serialized !== lastSyncedSnapshotRef.current) {
        lastSyncedSnapshotRef.current = serialized;
        setState(remote);
        if (remote.phase === 'end_routine') {
          const res = buildRoundResultFromState(remote);
          setRoundResult(res);
          if (res.winner) setGameWinner(res.winner);
        } else {
          setRoundResult(null);
          setGameWinner(null);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [onlineRoomCode, setupOpen]);

  const startGame = useCallback((config: GameConfig) => {
    roundTurnsRef.current = 0;
    pendingFinishRef.current = null;
    setOnlineRoomCode(null);
    setOnlineHostId(null);
    setLocalPlayerId(PLAYER_ID);
    setRoundResult(null);
    setGameWinner(null);
    setSetupOpen(false);
    setState(() => dealNewRound(freshState(config)));
  }, []);

  const startOnlineGame = useCallback(
    async (room: OnlineRoomRow, myId: string, fillWithBots: boolean) => {
      roundTurnsRef.current = 0;
      pendingFinishRef.current = null;
      const players = buildOnlinePlayers(room, fillWithBots);
      const initial = dealNewRound(
        freshState({ playerCount: players.length, aiLevel: 'hard' }, players)
      );
      setOnlineRoomCode(room.code);
      setOnlineHostId(room.host_id);
      setLocalPlayerId(myId);
      setRoundResult(null);
      setGameWinner(null);
      setSetupOpen(false);
      setState(initial);
      await pushOnlineState(initial, room.code);
    },
    [pushOnlineState]
  );

  const joinStartedOnlineGame = useCallback((room: OnlineRoomRow, myId: string) => {
    if (!room.game_state) return;
    const remote = room.game_state as GameState;
    lastSyncedSnapshotRef.current = JSON.stringify(remote);
    setOnlineRoomCode(room.code);
    setOnlineHostId(room.host_id);
    setLocalPlayerId(myId);
    setSetupOpen(false);
    setState(remote);
  }, []);

  const resetGame = useCallback(() => {
    roundTurnsRef.current = 0;
    pendingFinishRef.current = null;
    setOnlineRoomCode(null);
    setOnlineHostId(null);
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
    setState(s => {
      if (!s) return dealNewRound(freshState({ playerCount: 2, aiLevel: 'hard' }));
      const resetPlayers = s.players.map(p => ({ ...p, score: 0, board: emptyBoard() }));
      const next = dealNewRound(freshState(s.config, resetPlayers));
      if (onlineRoomCode) pushOnlineState(next);
      return next;
    });
  }, [onlineRoomCode, pushOnlineState]);

  const resetAdaptiveMemory = useCallback(() => {
    const m = resetMemory();
    setMemory(m);
  }, []);

  const triggerDiscardPulse = useCallback(() => {}, []);

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

      if (!onlineRoomCode && s.config.aiLevel === 'adaptive') {
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

      return {
        ...s,
        players: updatedPlayers,
        phase: 'end_routine',
        stage: 'choose_source',
        lastRoundCloser: closerId,
        pendingDraw: null,
        pendingHighlight: null,
        lastAction: 'Ronda terminada',
      };
    },
    [memory, onlineRoomCode, localPlayerId]
  );

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
        ? `${nextPlayer.name} juega su último turno...`
        : nextPlayer.isBot
          ? `${nextPlayer.name} está pensando...`
          : `Turno de ${nextPlayer.name}`,
      pendingDraw: null,
    };
  }, []);

  const completeTurn = useCallback(
    (s: GameState, actorId: string): GameState => {
      roundTurnsRef.current += 1;
      const actor = s.players.find(p => p.id === actorId)!;

      if (!s.lastRoundTriggered && allRevealed(actor.board)) {
        const remaining = s.turnOrder.length - 1;
        const triggeredState: GameState = {
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

      return advanceToNextPlayer(s);
    },
    [advanceToNextPlayer, endRound]
  );

  // ---- Player initial reveal ----
  const revealInitialCard = useCallback(
    (index: number) => {
      setState(prev => {
        if (!prev || prev.phase !== 'reveal_initial') return prev;
        const pid = localPlayerId;
        if ((prev.initialRevealed[pid] ?? 0) >= 2) return prev;
        const cell = prev.players.find(p => p.id === pid)?.board[index];
        if (!cell || cell.revealed) return prev;

        const players = prev.players.map(p => {
          if (p.id !== pid) return p;
          const board = p.board.map((c, i) => (i === index ? { ...c, revealed: true } : c));
          return { ...p, board };
        });
        const count = (prev.initialRevealed[pid] ?? 0) + 1;
        const updatedInitial = { ...prev.initialRevealed, [pid]: count };

        let next: GameState = {
          ...prev,
          players,
          initialRevealed: updatedInitial,
          lastAction: count < 2 ? `Voltea 1 carta más (${count}/2)` : 'Esperando al resto de jugadores...',
        };

        const humanPlayers = players.filter(p => !p.isBot);
        const allHumansReady = humanPlayers.every(p => (updatedInitial[p.id] ?? 0) >= 2);

        if (allHumansReady) {
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
            players: botPlayers,
            currentPlayerIndex: startIdx,
            phase: 'playing',
            stage: starter.isBot ? 'bot_thinking' : 'choose_source',
            lastAction: `¡Empieza ${starter.name}!`,
          };
        }

        if (onlineRoomCode) pushOnlineState(next);
        return next;
      });
    },
    [localPlayerId, onlineRoomCode, pushOnlineState]
  );

  // ---- Player source choice ----
  const playerTakeDiscard = useCallback(() => {
    setState(prev => {
      if (!prev || prev.phase !== 'playing') return prev;
      if (prev.players[prev.currentPlayerIndex].id !== localPlayerId) return prev;
      if (prev.stage !== 'choose_source') return prev;
      if (prev.discard.length === 0) return prev;
      const top = prev.discard[0];
      const next: GameState = {
        ...prev,
        pendingDraw: { card: top, source: 'from_descarte' },
        stage: 'must_place',
        discard: prev.discard.slice(1),
        lastAction: `${prev.players[prev.currentPlayerIndex].name} cogió del descarte`,
      };
      if (onlineRoomCode) pushOnlineState(next);
      return next;
    });
  }, [localPlayerId, onlineRoomCode, pushOnlineState]);

  const playerDrawDeck = useCallback(() => {
    setState(prev => {
      if (!prev || prev.phase !== 'playing') return prev;
      if (prev.players[prev.currentPlayerIndex].id !== localPlayerId) return prev;
      if (prev.stage !== 'choose_source') return prev;
      const s = ensureDeck(prev);
      if (s.deck.length === 0) return prev;
      const drawn = s.deck[0];
      const next: GameState = {
        ...s,
        deck: s.deck.slice(1),
        pendingDraw: { card: drawn, source: 'from_mazo' },
        stage: 'must_place',
        lastAction: `${prev.players[prev.currentPlayerIndex].name} robó del mazo`,
      };
      if (onlineRoomCode) pushOnlineState(next);
      return next;
    });
  }, [ensureDeck, localPlayerId, onlineRoomCode, pushOnlineState]);

  const playerPlaceCard = useCallback(
    (index: number) => {
      setState(prev => {
        if (!prev || prev.phase !== 'playing') return prev;
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
        let s: GameState = {
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
        const next = completeTurn(s, player.id);
        if (onlineRoomCode) pushOnlineState(next);
        return next;
      });
      triggerDiscardPulse();
    },
    [checkColumnEliminations, completeTurn, triggerDiscardPulse, localPlayerId, onlineRoomCode, pushOnlineState]
  );

  const playerDiscardDrawn = useCallback(() => {
    setState(prev => {
      if (!prev || prev.phase !== 'playing') return prev;
      if (prev.players[prev.currentPlayerIndex].id !== localPlayerId) return prev;
      if (prev.stage !== 'must_place' || !prev.pendingDraw) return prev;
      const drawn = prev.pendingDraw.card;
      const player = prev.players[prev.currentPlayerIndex];
      const next: GameState = {
        ...prev,
        discard: [drawn, ...prev.discard],
        discardCounts: updateDiscardCounts(prev.discardCounts, drawn),
        pendingDraw: null,
        stage: 'discard_then_flip',
        lastAction: `${player.name} descartó y va a voltear una oculta`,
      };
      if (onlineRoomCode) pushOnlineState(next);
      return next;
    });
    triggerDiscardPulse();
  }, [triggerDiscardPulse, localPlayerId, onlineRoomCode, pushOnlineState]);

  const playerFlipHidden = useCallback(
    (index: number) => {
      setState(prev => {
        if (!prev || prev.phase !== 'playing') return prev;
        if (prev.players[prev.currentPlayerIndex].id !== localPlayerId) return prev;
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
          lastAction: `${player.name} volteó una carta`,
        };
        s = checkColumnEliminations(s, player.id);
        const next = completeTurn(s, player.id);
        if (onlineRoomCode) pushOnlineState(next);
        return next;
      });
    },
    [checkColumnEliminations, completeTurn, localPlayerId, onlineRoomCode, pushOnlineState]
  );

  const nextRound = useCallback(() => {
    roundTurnsRef.current = 0;
    pendingFinishRef.current = null;
    setRoundResult(null);
    setState(prev => {
      if (!prev) return prev;
      const next = dealNewRound({ ...prev, roundNumber: prev.roundNumber + 1 });
      if (onlineRoomCode) pushOnlineState(next);
      return next;
    });
  }, [onlineRoomCode, pushOnlineState]);

  // ---- Bot turn runner (solo ejecuta el anfitrión en modo online para no duplicar turnos) ----
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
            await sleep(pauseMs * 0.5);
          }
        }
      }

      await sleep(200);
      const cleanState: GameState = { ...s, pendingHighlight: null };
      const nextState = completeTurn(cleanState, bot.id);
      setState(nextState);
      if (onlineRoomCode) pushOnlineState(nextState);
    },
    [memory, checkColumnEliminations, ensureDeck, completeTurn, onlineRoomCode, pushOnlineState]
  );

  useEffect(() => {
    if (!state) return;
    if (state.phase === 'playing' && state.stage === 'bot_thinking' && !busyRef.current) {
      if (onlineRoomCode && onlineHostId && localPlayerId !== onlineHostId) return;
      const current = state.players[state.currentPlayerIndex];
      if (current && current.isBot) {
        busyRef.current = true;
        runBotTurn(state).finally(() => {
          busyRef.current = false;
        });
      }
    }
  }, [state, runBotTurn, onlineRoomCode, onlineHostId, localPlayerId]);

  return {
    state,
    roundResult,
    rulesOpen,
    setupOpen,
    gameWinner,
    memory,
    localPlayerId,
    onlineRoomCode,
    setRulesOpen,
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