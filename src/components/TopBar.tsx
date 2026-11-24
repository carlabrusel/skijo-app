import { BookOpen, RotateCcw, Layers, Sparkles, Target, Zap, History } from 'lucide-react';
import { GameState, AdaptiveMemory } from '@/game/types';

interface TopBarProps {
  state: GameState;
  memory: AdaptiveMemory;
  onRules: () => void;
  onHistory: () => void;
  onReset: () => void;
}

export function TopBar({ state, memory, onRules, onHistory, onReset }: TopBarProps) {
  const levelLabel =
    state.config.aiLevel === 'easy'
      ? 'Fácil'
      : state.config.aiLevel === 'hard'
        ? 'Difícil'
        : `Adapt. Nv.${memory.level}`;

  const LevelIcon =
    state.config.aiLevel === 'easy'
      ? Sparkles
      : state.config.aiLevel === 'hard'
        ? Target
        : Zap;

  const hasHistory = (state.roundHistory?.length ?? 0) > 0;

  return (
    <header className="flex items-center justify-between gap-2 px-1 py-1 bg-slate-900/60 rounded-xl border border-slate-800/80">
      <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar">
        {state.players.map((p, idx) => {
          const isTurn = state.phase === 'playing' && idx === state.currentPlayerIndex;
          return (
            <div
              key={p.id}
              className={`flex flex-col items-center px-2 py-0.5 rounded-lg shrink-0 transition-colors ${
                isTurn ? 'bg-amber-500/15 ring-1 ring-amber-400/50' : ''
              }`}
            >
              <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold truncate max-w-[4.5rem]">
                {idx === 0 ? 'TÚ' : p.name}
              </span>
              <span
                className={`text-sm font-extrabold tabular-nums leading-tight ${
                  p.score >= 80 ? 'text-rose-400' : idx === 0 ? 'text-emerald-400' : 'text-rose-300'
                }`}
              >
                {p.score}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onHistory}
          title="Ver libreta de rondas"
          className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border transition-colors ${
            hasHistory
              ? 'bg-amber-500/20 border-amber-400/50 text-amber-200 hover:bg-amber-500/30'
              : 'bg-slate-800/90 border-slate-700 text-slate-300 hover:text-white'
          }`}
        >
          <Layers size={11} className="text-amber-400" />
          <span>R{state.roundNumber}</span>
          {hasHistory && <History size={10} className="text-amber-300" />}
        </button>

        <span className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full bg-slate-800/90 border border-slate-700 text-[11px] font-semibold text-emerald-300">
          <LevelIcon size={11} />
          <span>{levelLabel}</span>
        </span>

        <button
          onClick={onRules}
          className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
          title="Reglas"
        >
          <BookOpen size={14} />
        </button>

        <button
          onClick={onReset}
          className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
          title="Nueva partida"
        >
          <RotateCcw size={14} />
        </button>
      </div>
    </header>
  );
}