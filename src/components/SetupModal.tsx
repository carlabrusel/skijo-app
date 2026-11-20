import { useState } from 'react';
import { Users, Brain, Zap, Trophy, RotateCcw, Sparkles, Bot, User, Crown, Target, X, ArrowRight, BookOpen, AlertTriangle, Layers } from 'lucide-react';
import { AILevel, AdaptiveMemory, RoundResult } from '@/game/types';

interface SetupModalProps {
  open: boolean;
  onStart: (playerCount: number, aiLevel: AILevel) => void;
  memory: AdaptiveMemory;
  onResetMemory: () => void;
}

export function SetupModal({ open, onStart, memory, onResetMemory }: SetupModalProps) {
  const [playerCount, setPlayerCount] = useState(2);
  const [aiLevel, setAiLevel] = useState<AILevel>('hard');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo header */}
        <div className="text-center mb-5">
          <div className="inline-flex items-center gap-2 mb-1">
            <div className="w-10 h-14 rounded-lg border-2 border-white shadow-lg flex items-center justify-center"
              style={{ background: 'conic-gradient(from 45deg, #1e3a8a, #059669, #f59e0b, #dc2626, #7c3aed, #1e3a8a)' }}>
              <span className="text-white font-bold text-[8px] tracking-widest" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>SKYJO</span>
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-widest">SKYJO</h1>
          <p className="text-slate-400 text-sm">El juego de cartas</p>
        </div>

        <div className="bg-slate-800/60 backdrop-blur border border-slate-700 rounded-2xl p-5 space-y-5">
          {/* Player count */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-2">
              <Users size={16} className="text-emerald-400" /> Jugadores
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[2, 3, 4].map(n => (
                <button
                  key={n}
                  onClick={() => setPlayerCount(n)}
                  className={`py-2.5 rounded-lg font-semibold text-sm transition-all border-2
                    ${playerCount === n
                      ? 'bg-emerald-600 border-emerald-400 text-white shadow-lg shadow-emerald-600/30'
                      : 'bg-slate-700/50 border-slate-600 text-slate-300 hover:border-slate-500'}
                  `}
                >
                  {n} Jug.
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1.5">
              {playerCount === 2 ? 'Tú vs 1 bot' : playerCount === 3 ? 'Tú vs 2 bots (Ana, Leo)' : 'Tú vs 3 bots (Ana, Leo, Max)'}
            </p>
          </div>

          {/* AI level */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-2">
              <Brain size={16} className="text-emerald-400" /> Inteligencia del bot
            </label>
            <div className="space-y-2">
              <button
                onClick={() => setAiLevel('easy')}
                className={`w-full text-left p-3 rounded-lg border-2 transition-all
                  ${aiLevel === 'easy' ? 'border-emerald-400 bg-emerald-900/30' : 'border-slate-600 bg-slate-700/30 hover:border-slate-500'}`}
              >
                <div className="flex items-center gap-2">
                  <Sparkles size={15} className={aiLevel === 'easy' ? 'text-emerald-400' : 'text-slate-400'} />
                  <span className="font-semibold text-sm text-white">Fácil (Casual)</span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 ml-7">Juega relajado, a veces cierra sin calcular.</p>
              </button>
              <button
                onClick={() => setAiLevel('hard')}
                className={`w-full text-left p-3 rounded-lg border-2 transition-all
                  ${aiLevel === 'hard' ? 'border-emerald-400 bg-emerald-900/30' : 'border-slate-600 bg-slate-700/30 hover:border-slate-500'}`}
              >
                <div className="flex items-center gap-2">
                  <Target size={15} className={aiLevel === 'hard' ? 'text-emerald-400' : 'text-slate-400'} />
                  <span className="font-semibold text-sm text-white">Difícil (Experto)</span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 ml-7">Cuenta cartas y calcula riesgo contra todos.</p>
              </button>
              <button
                onClick={() => setAiLevel('adaptive')}
                className={`w-full text-left p-3 rounded-lg border-2 transition-all
                  ${aiLevel === 'adaptive' ? 'border-emerald-400 bg-emerald-900/30' : 'border-slate-600 bg-slate-700/30 hover:border-slate-500'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap size={15} className={aiLevel === 'adaptive' ? 'text-emerald-400' : 'text-slate-400'} />
                    <span className="font-semibold text-sm text-white">Adaptativo (Aprende)</span>
                  </div>
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-semibold">
                    Nv. {memory.level}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 ml-7">Se adapta a tu estilo. Guarda progreso en el dispositivo.</p>
              </button>
            </div>
          </div>

          {/* Adaptive memory reset */}
          {aiLevel === 'adaptive' && (
            <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2 border border-slate-700">
              <div>
                <p className="text-xs text-slate-300 font-medium">Memoria de la IA</p>
                <p className="text-[10px] text-slate-500">{memory.roundsPlayed} rondas jugadas · {memory.gamesPlayed} partidas</p>
              </div>
              <button onClick={onResetMemory} className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 font-medium">
                <RotateCcw size={12} /> Resetear
              </button>
            </div>
          )}

          <button
            onClick={() => onStart(playerCount, aiLevel)}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-emerald-600/30"
          >
            Empezar partida
          </button>
        </div>
      </div>
    </div>
  );
}
