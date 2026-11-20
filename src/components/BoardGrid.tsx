import { Board } from '@/game/types';
import { CardView } from './CardView';

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

export function BoardGrid({ board, size, onCellClick, highlightPredicate, clickablePredicate, highlightIndex, activeTurn, dimmed }: BoardGridProps) {
  const cardSize = size;
  const gapClass = size === 'player' ? 'gap-1.5' : size === 'lg' ? 'gap-1.5 sm:gap-2' : 'gap-1';
  return (
    <div className={`grid grid-cols-4 ${gapClass}`}>
      {board.map((cell, i) => {
        const isClickable = onCellClick && clickablePredicate ? clickablePredicate(i) : !!onCellClick;
        const isHighlighted = highlightIndex === i || (highlightPredicate && highlightPredicate(i));
        return (
          <CardView
            key={i}
            card={cell.card}
            revealed={cell.revealed}
            eliminated={cell.eliminated}
            size={cardSize}
            onClick={isClickable ? () => onCellClick?.(i) : undefined}
            highlighted={isHighlighted}
            activeTurn={activeTurn}
            dimmed={dimmed}
          />
        );
      })}
    </div>
  );
}
