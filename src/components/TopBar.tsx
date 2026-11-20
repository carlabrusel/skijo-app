import { Player, GameState, AdaptiveMemory } from '@/game/types';
import { getVisibleScore } from '@/game/board';
import { BookOpen, RotateCcw, Layers, Bot, User, Zap, Target, Sparkles } from 'lucide-react';

interface TopBarProps {
  state: GameState;
  memory: AdaptiveMemory;
  onRules: () => void;
  onReset: () => void;
}

export function TopBar({ state, memory, onRules, onReset }: TopBarProps) {
  const player = state.players.find(p => p.id === 'player')!;
  const opponents = state.players.filter(p => p.isBot);

  const aiIcon = state.config.aiLevel === 'easy' ? <Sparkles size={11} /> : state.config.aiLevel === 'hard' ? <Target size={11} /> : <Zap size={11} />;
  const aiLabel = state.config.aiLevel === 'easy' ? 'Fácil' : state.config.aiLevel === 'hard' ? 'Difícil' : `Adapt. Nv.`;

  return (
    <div className="px-3 py-2 bg-slate-950/80 backdrop-blur border-b border-slate-800">
      <div className="flex items-center justify-between gap-2">
        {/* Scores */}
        <div className="flex items-center gap-2 overflow-x-auto">
          <div className="flex flex-col items-center min-w-[2.5rem]">
            <span className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center gap-0.5"><User size={9} />Tú</span>
            <span className="text-base font-bold text-emerald-400 leading-none">{player.score}</span>
          </div>
          {opponents.map(bot => (
            <div key={bot.id} className="flex flex-col items-center min-w-[2.5rem]">
              <span className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center gap-0.5"><Bot size={9} />{bot.name.replace('Bot ', '')}</span>
              <span className="text-base font-bold text-rose-400 leading-none">{bot.score}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1 bg-slate-800/80 px-2 py-1 rounded-full">
            <Layers size={12} className="text-amber-400" />
            <span className="text-[10px] font-semibold text-slate-200">R{state.roundNumber}</span>
          </div>
          <div className="flex items-center gap-0.5 bg-slate-800/80 px-2 py-1 rounded-full text-emerald-400">
            {aiIcon}
            <span className="text-[10px] font-semibold">{aiLabel}{state.config.aiLevel === 'adaptive' ? memory?.level : ''}</span>
          </div>
          <button onClick={onRules} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors" aria-label="Reglas">
            <BookOpen size={14} />
          </button>
          <button onClick={onReset} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors" aria-label="Reiniciar">
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
