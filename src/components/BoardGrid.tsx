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

  // Detecta si la casilla resaltada pertenece a una columna que acaba de ser eliminada
  const isColumnEliminationFlash =
    highlightIndex !== null &&
    highlightIndex !== undefined &&
    board[highlightIndex]?.eliminated === true;

  return (
    <div className={`grid grid-cols-4 ${gapClass}`}>
      {board.map((cell, i) => {
        const isClickable = onCellClick && clickablePredicate ? clickablePredicate(i) : !!onCellClick;

        // Si se eliminó una columna, ilumina las 3 celdas de esa columna; si no, solo la casilla jugada
        const isSameEliminatedCol =
          isColumnEliminationFlash &&
          highlightIndex !== null &&
          highlightIndex !== undefined &&
          i % 4 === highlightIndex % 4;

        const isHighlighted =
          highlightIndex === i ||
          isSameEliminatedCol ||
          (highlightPredicate && highlightPredicate(i));

        return (
          <div
            key={i}
            className={`transition-transform duration-300 ${
              isSameEliminatedCol ? 'scale-105 animate-pulse' : ''
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
          </div>
        );
      })}
    </div>
  );
}