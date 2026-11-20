import { useMemo } from 'react';
import { useSkyjo } from '@/hooks/useSkyjo';
import { TopBar } from '@/components/TopBar';
import { OpponentsBar } from '@/components/OpponentsBar';
import { BoardGrid } from '@/components/BoardGrid';
import { CardView } from '@/components/CardView';
import { SetupModal } from '@/components/SetupModal';
import { RulesModal, RoundModal, GameOverModal } from '@/components/Modals';
import { getVisibleScore } from '@/game/board';
import { Layers, Trash2, Hand, ArrowDownToLine, User, AlertTriangle } from 'lucide-react';

export default function App() {
  const game = useSkyjo();
  const { state, localPlayerId } = game;

  const player = state?.players.find(p => p.id === localPlayerId) ?? state?.players[0] ?? null;
  const playerVisibleScore = useMemo(
    () => (player ? getVisibleScore(player.board) : 0),
    [player?.board]
  );

  if (!state || game.setupOpen || !player) {
    return (
      <>
        <SetupModal
          open={game.setupOpen || !state}
          onStart={(playerCount, aiLevel) => game.startGame({ playerCount, aiLevel })}
          onStartOnline={game.startOnlineGame}
          onJoinStartedOnline={game.joinStartedOnlineGame}
          memory={game.memory}
          onResetMemory={game.resetAdaptiveMemory}
        />
        {state && <RulesModal open={game.rulesOpen} onClose={() => game.setRulesOpen(false)} />}
      </>
    );
  }

  const isPlayerTurn = state.players[state.currentPlayerIndex]?.id === localPlayerId;
  const isInitialReveal = state.phase === 'reveal_initial';
  const isPlaying = state.phase === 'playing';
  const canChooseSource = isPlaying && isPlayerTurn && state.stage === 'choose_source';
  const mustPlace = isPlaying && isPlayerTurn && state.stage === 'must_place';
  const discardThenFlip = isPlaying && isPlayerTurn && state.stage === 'discard_then_flip';
  const botThinking = isPlaying && !isPlayerTurn;

  const playerCellClickable = (i: number) => {
    if (isInitialReveal && (state.initialRevealed[localPlayerId] ?? 0) < 2) {
      const c = player.board[i];
      return !c.revealed && !c.eliminated && !!c.card;
    }
    if (mustPlace) return true;
    if (discardThenFlip) {
      const c = player.board[i];
      return !c.revealed && !c.eliminated && !!c.card;
    }
    return false;
  };

  const onPlayerCellClick = (i: number) => {
    if (isInitialReveal) game.revealInitialCard(i);
    else if (mustPlace) game.playerPlaceCard(i);
    else if (discardThenFlip) game.playerFlipHidden(i);
  };

  const playerHighlight = (i: number) => {
    if (isInitialReveal && (state.initialRevealed[localPlayerId] ?? 0) < 2) {
      const c = player.board[i];
      return !c.revealed && !c.eliminated && !!c.card;
    }
    if (discardThenFlip) {
      const c = player.board[i];
      return !c.revealed && !c.eliminated && !!c.card;
    }
    return false;
  };

  const deckEmpty = state.deck.length === 0;
  const discardTop = state.discard[0] ?? null;
  const centerCardClass = 'h-[10dvh] max-h-20 aspect-[2/3]';

  const currentActivePlayerId = state.players[state.currentPlayerIndex]?.id;
  const reorderedPlayers = [
    player,
    ...state.players.filter(p => p.id !== localPlayerId),
  ];
  const reorderedState = {
    ...state,
    players: reorderedPlayers,
    currentPlayerIndex: Math.max(0, reorderedPlayers.findIndex(p => p.id === currentActivePlayerId)),
  };

  return (
    <div
      className="h-dvh max-w-md mx-auto flex flex-col overflow-hidden text-white p-2"
      style={{
        background: 'radial-gradient(ellipse at center top, #1e3a5f 0%, #0f1e30 40%, #0a1620 100%)',
      }}
    >
      <div className="shrink-0">
        <TopBar state={reorderedState} memory={game.memory} onRules={() => game.setRulesOpen(true)} onReset={game.resetGame} />
      </div>

      {state.lastRoundTriggered && state.phase !== 'end_routine' && (
        <div className="shrink-0 bg-amber-500/20 border-y border-amber-500/40 px-3 py-1 flex items-center justify-center gap-1.5 text-amber-300 text-[11px] font-semibold animate-pulse">
          <AlertTriangle size={12} /> ¡Última ronda!
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col justify-center px-1">
        <OpponentsBar state={reorderedState} />
      </div>

      <div className="shrink-0 py-1 flex flex-col items-center gap-1.5 z-10">
        <p
          className={`text-[13px] text-center px-3 py-1 rounded-full bg-slate-900/80 font-semibold leading-snug max-w-full ${
            botThinking ? 'text-amber-300' : isPlayerTurn ? 'text-emerald-300' : 'text-slate-300'
          }`}
        >
          {state.lastAction}
        </p>

        <div className="flex items-end gap-3 sm:gap-5">
          <div className="flex flex-col items-center gap-0.5">
            <button
              onClick={canChooseSource ? game.playerDrawDeck : undefined}
              className={`relative ${canChooseSource ? 'cursor-pointer' : 'cursor-default'}`}
              disabled={!canChooseSource || deckEmpty}
            >
              <div
                className={`${centerCardClass} rounded-lg border-2 border-white shadow-md transition-all duration-300 relative overflow-hidden ${
                  canChooseSource ? 'ring-4 ring-emerald-400/60 hover:scale-105 active:scale-95 shadow-emerald-400/30' : ''
                }`}
                style={{ background: 'conic-gradient(from 45deg, #1e3a8a, #059669, #f59e0b, #dc2626, #7c3aed, #1e3a8a)' }}
              >
                <div
                  className="absolute inset-0 opacity-30"
                  style={{ backgroundImage: 'radial-gradient(circle at 50% 50%, transparent 30%, rgba(0,0,0,0.5) 100%)' }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Layers size={20} className="text-white/70" />
                </div>
              </div>
              <span className="absolute -bottom-1 -right-1 bg-slate-800 text-slate-200 text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-slate-600">
                {state.deck.length}
              </span>
            </button>
            <span className="text-[9px] text-slate-400 uppercase tracking-wide">Mazo</span>
          </div>

          <div className="flex flex-col items-center gap-0.5">
            <div
              key={discardTop ? discardTop.id : 'empty-discard'}
              className={`relative rounded-lg ${discardTop && state.roundNumber > 0 ? 'animate-discard-halo' : ''}`}
            >
              {discardTop ? (
                <div className="animate-discard-drop">
                  <CardView
                    card={discardTop}
                    revealed={true}
                    size="lg"
                    onClick={canChooseSource ? game.playerTakeDiscard : undefined}
                    highlighted={canChooseSource}
                  />
                </div>
              ) : (
                <div className={`${centerCardClass} rounded-lg border-2 border-dashed border-slate-700 flex items-center justify-center`}>
                  <Trash2 size={18} className="text-slate-600" />
                </div>
              )}
            </div>
            <span className="text-[9px] text-slate-400 uppercase tracking-wide">Descarte</span>
          </div>

          <div className="flex flex-col items-center gap-0.5">
            {state.pendingDraw ? (
              <div className="animate-card-appear">
                <CardView card={state.pendingDraw.card} revealed={true} size="lg" highlighted={true} />
              </div>
            ) : (
              <div className={`${centerCardClass} rounded-lg border-2 border-dashed border-slate-800/50 flex items-center justify-center`}>
                <Hand size={18} className="text-slate-700" />
              </div>
            )}
            <span
              className={`text-[9px] uppercase tracking-wide flex items-center gap-0.5 transition-colors ${
                state.pendingDraw ? 'text-emerald-400 font-semibold' : 'text-slate-500'
              }`}
            >
              {state.pendingDraw && <Hand size={9} />} Mano
            </span>
          </div>
        </div>

        <div className="h-8 flex items-center justify-center">
          <button
            onClick={game.playerDiscardDrawn}
            disabled={!(mustPlace && state.pendingDraw)}
            className={`px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg transition-opacity duration-200 flex items-center gap-1.5 ring-2 ring-amber-400/40 ${
              mustPlace && state.pendingDraw
                ? 'opacity-100 animate-pulse'
                : 'opacity-0 pointer-events-none'
            }`}
          >
            <ArrowDownToLine size={14} /> Descartar robada
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col justify-center border-t border-slate-800/50 px-2 pt-1 pb-1">
        <div className="flex items-center justify-between mb-1 shrink-0">
          <span className={`flex items-center gap-1.5 text-xs font-semibold ${isPlayerTurn ? 'text-amber-300' : 'text-emerald-400'}`}>
            <User size={14} /> {player.name}
            {isPlayerTurn && <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full">tu turno</span>}
          </span>
          <span className="text-xs text-slate-400">Puntos: <span className="font-bold text-emerald-300">{playerVisibleScore}</span></span>
        </div>
        <div className="flex justify-center">
          <BoardGrid
            board={player.board}
            size="player"
            onCellClick={onPlayerCellClick}
            clickablePredicate={playerCellClickable}
            highlightPredicate={playerHighlight}
            activeTurn={isPlayerTurn}
          />
        </div>
      </div>

      <RulesModal open={game.rulesOpen} onClose={() => game.setRulesOpen(false)} />
      {game.roundResult && !game.gameWinner && (
        <RoundModal
          result={game.roundResult}
          roundNumber={state.roundNumber}
          onNext={game.nextRound}
        />
      )}
      {game.gameWinner && game.roundResult && (
        <GameOverModal
          result={game.roundResult}
          onPlayAgain={game.playAgain}
          onReset={game.resetGame}
        />
      )}
    </div>
  );
}