import { Player, GameState } from '@/game/types';
import { BoardGrid } from './BoardGrid';
import { getVisibleScore } from '@/game/board';
import { Bot, User } from 'lucide-react';

interface OpponentPanelProps {
  player: Player;
  isCurrentTurn: boolean;
  highlightIndex: number | null;
  cardSize: 'opp' | 'opp-sm';
}

function OpponentPanel({ player, isCurrentTurn, highlightIndex, cardSize }: OpponentPanelProps) {
  const score = getVisibleScore(player.board);
  return (
    <div className={`flex flex-col items-center rounded-xl p-1.5 transition-all duration-300
      ${isCurrentTurn ? 'bg-amber-500/10 ring-2 ring-amber-400/60 shadow-lg shadow-amber-400/20' : 'bg-slate-800/30'}
    `}>
      <div className="flex items-center justify-between w-full px-1 mb-1">
        <span className={`flex items-center gap-1 text-[10px] font-bold truncate ${isCurrentTurn ? 'text-amber-300' : 'text-slate-400'}`}>
          {player.isBot ? (
            <Bot size={11} className={isCurrentTurn ? 'text-amber-400' : 'text-slate-500'} />
          ) : (
            <User size={11} className={isCurrentTurn ? 'text-amber-400' : 'text-slate-500'} />
          )}
          {player.name.replace('Bot ', '')}
        </span>
        <span className={`text-[10px] font-bold ${isCurrentTurn ? 'text-amber-300' : 'text-slate-400'}`}>
          {score}p
        </span>
      </div>
      <BoardGrid
        board={player.board}
        size={cardSize}
        highlightIndex={highlightIndex}
        activeTurn={isCurrentTurn}
      />
    </div>
  );
}

interface OpponentsBarProps {
  state: GameState;
}

export function OpponentsBar({ state }: OpponentsBarProps) {
  const opponents = state.players.filter(p => p.isBot);
  const currentId = state.players[state.currentPlayerIndex]?.id;
  const cardSize: 'opp' | 'opp-sm' = opponents.length > 1 ? 'opp-sm' : 'opp';

  return (
    <div className="flex gap-1.5 justify-center">
      {opponents.map(opp => (
        <OpponentPanel
          key={opp.id}
          player={opp}
          isCurrentTurn={currentId === opp.id}
          highlightIndex={state.pendingHighlight?.player === opp.id ? state.pendingHighlight.index : null}
          cardSize={cardSize}
        />
      ))}
    </div>
  );
}