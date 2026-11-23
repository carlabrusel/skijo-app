import { Board } from '@/game/types';
import { CardView } from './CardView';
import { Sparkles } from 'lucide-react';

interface BoardGridProps {
  board: Board;
  size: 'sm' | 'lg' | 'opp' | 'opp-sm' | 'player';
  onCellClick?: (index: number) => void;
  highlightPredicate?: (index: number) => boolean;
  clickablePredicate?: (index: number) => boolean;
  highlightIndex?: number | null;
  activeTurn?: boolean;
  dimmed?: boolean;
}

export function BoardGrid({
  board,
  size,
  onCellClick,
  highlightPredicate,
  clickablePredicate,
  highlightIndex,
  activeTurn,
  dimmed,
}: BoardGridProps) {
  const cardSize = size;
  const gapClass = size === 'player' ? 'gap-1.5' : size === 'lg' ? 'gap-1.5 sm:gap-2' : 'gap-1';

  const isColumnEliminationFlash =
    highlightIndex !== null &&
    highlightIndex !== undefined &&
    board[highlightIndex]?.eliminated === true;

  return (
    <div className={`grid grid-cols-4 ${gapClass}`}>
      {board.map((cell, i) => {
        const isClickable = onCellClick && clickablePredicate ? clickablePredicate(i) : !!onCellClick;

        const isSameEliminatedCol =
          isColumnEliminationFlash &&
          highlightIndex !== null &&
          highlightIndex !== undefined &&
          i % 4 === highlightIndex % 4;

        const isHighlighted =
          highlightIndex === i ||
          isSameEliminatedCol ||
          (highlightPredicate && highlightPredicate(i));

        const isMiddleEliminatedRow = isSameEliminatedCol && i >= 4 && i <= 7;

        return (
          <div
            key={i}
            className={`relative rounded-lg transition-all duration-300 ${
              isSameEliminatedCol
                ? 'scale-105 ring-2 ring-amber-400 bg-amber-400/20 shadow-lg shadow-amber-400/40 animate-pulse'
                : ''
            }`}
          >
            <CardView
              card={cell.card}
              revealed={cell.revealed}
              eliminated={cell.eliminated}
              size={cardSize}
              onClick={isClickable ? () => onCellClick?.(i) : undefined}
              highlighted={isHighlighted}
              activeTurn={activeTurn}
              dimmed={dimmed}
            />
            {isMiddleEliminatedRow && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="bg-amber-400 text-slate-950 rounded-full p-1 shadow-md animate-bounce">
                  <Sparkles size={size === 'player' ? 14 : 10} />
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}