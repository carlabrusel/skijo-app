import { Card } from '@/game/types';
import { cardGradient } from '@/game/deck';

interface CardViewProps {
  card: Card | null;
  revealed: boolean;
  eliminated?: boolean;
  onClick?: () => void;
  highlighted?: boolean;
  activeTurn?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'opp' | 'player';
  dimmed?: boolean;
}

export function CardView({ card, revealed, eliminated, onClick, highlighted, activeTurn, size = 'md', dimmed }: CardViewProps) {
  const dims = {
    sm: 'w-9 h-13 text-base',
    md: 'w-14 h-20 text-2xl',
    lg: 'h-[11dvh] max-h-24 aspect-[2/3] text-2xl',
    opp: 'h-[8.5dvh] max-h-16 aspect-[2/3] text-lg',
    'opp-sm': 'h-[7dvh] max-h-14 aspect-[2/3] text-base',
    player: 'h-[10.5dvh] max-h-22 aspect-[2/3] text-xl',
  }[size as 'sm' | 'md' | 'lg' | 'opp' | 'opp-sm' | 'player'];

  const cornerSize = size === 'sm' ? 'text-[7px]' : size === 'md' ? 'text-[9px]' : size === 'opp' || size === 'opp-sm' ? 'text-[8px]' : 'text-[10px]';

  if (eliminated) {
    return (
      <div className={`${dims} rounded-lg border-2 border-dashed border-white/10 bg-transparent flex items-center justify-center`}>
        <span className="text-white/15 text-xs">·</span>
      </div>
    );
  }

  if (!revealed || !card) {
    return (
      <button
        onClick={onClick}
        className={`${dims} relative rounded-lg border-2 border-white shadow-md transition-all duration-300 overflow-hidden
          ${highlighted ? 'ring-4 ring-emerald-400/70 scale-105 shadow-emerald-400/40' : ''}
          ${activeTurn ? 'ring-2 ring-amber-400/60' : ''}
          ${onClick ? 'cursor-pointer hover:scale-105 active:scale-95' : 'cursor-default'}
          ${dimmed ? 'opacity-50' : ''}
        `}
      >
        <div className="absolute inset-0"
          style={{
            background: 'conic-gradient(from 45deg, #1e3a8a, #059669, #f59e0b, #dc2626, #7c3aed, #1e3a8a)',
          }}
        />
        <div className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: 'radial-gradient(circle at 50% 50%, transparent 30%, rgba(0,0,0,0.5) 100%)',
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-bold tracking-widest drop-shadow-lg"
            style={{ fontSize: size === 'sm' ? '7px' : size === 'md' ? '10px' : size === 'opp' || size === 'opp-sm' ? '8px' : '11px', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
            SKYJO
          </span>
        </div>
      </button>
    );
  }

  const c = cardGradient(card.value);
  return (
    <button
      onClick={onClick}
      className={`${dims} relative rounded-lg border-2 border-white shadow-md transition-all duration-300 bg-gradient-to-br ${c.bg}
        ${highlighted ? 'ring-4 ring-emerald-400/70 scale-105 shadow-emerald-400/40' : ''}
        ${activeTurn ? 'ring-2 ring-amber-400/60' : ''}
        ${onClick ? 'cursor-pointer hover:scale-105 active:scale-95' : 'cursor-default'}
        ${dimmed ? 'opacity-50' : ''}
        flex items-center justify-center font-extrabold ${c.text}
      `}
    >
      <span className="drop-shadow-md leading-none" style={{ textShadow: c.isDarkText ? '0 1px 2px rgba(255,255,255,0.4)' : '0 1px 3px rgba(0,0,0,0.4)' }}>
        {card.value}
      </span>
      <span className={`absolute top-0.5 left-1 ${cornerSize} font-bold opacity-80`}
        style={{ textShadow: c.isDarkText ? '0 1px 1px rgba(255,255,255,0.3)' : '0 1px 1px rgba(0,0,0,0.3)' }}>
        {card.value}
      </span>
      <span className={`absolute bottom-0.5 right-1 ${cornerSize} font-bold opacity-80 rotate-180`}
        style={{ textShadow: c.isDarkText ? '0 1px 1px rgba(255,255,255,0.3)' : '0 1px 1px rgba(0,0,0,0.3)' }}>
        {card.value}
      </span>
    </button>
  );
}
