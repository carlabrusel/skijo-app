import { useEffect, useRef } from 'react';
import { X, BookOpen, ArrowRight, RotateCcw, Crown, Trophy, Home } from 'lucide-react';
import { RoundResult, PLAYER_ID } from '@/game/types';
import confetti from 'canvas-confetti';

export function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto p-5 text-slate-200 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2 text-white"><BookOpen size={20} /> Reglas de Skyjo</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>
        <div className="space-y-3 text-sm leading-relaxed">
          <p><span className="font-semibold text-emerald-400">Objetivo:</span> Termina la partida con menos puntos. Se pierde al llegar a 100.</p>
          <p><span className="font-semibold text-emerald-400">Preparación:</span> 12 cartas boca abajo en cuadrícula 3×4. Voltea 2 al iniciar. Empieza quien tenga la suma más alta.</p>
          <p><span className="font-semibold text-emerald-400">Turno:</span> Coge del descarte o roba del mazo.</p>
          <ul className="ml-4 list-disc space-y-1 text-slate-300">
            <li>Del descarte: intercámbiala por una carta de tu tablero.</li>
            <li>Del mazo: colócala en tu tablero, o descártala y voltea una carta oculta.</li>
          </ul>
          <p><span className="font-semibold text-emerald-400">Columnas:</span> Si 3 cartas de una columna tienen el mismo valor y están boca arriba, ¡se eliminan!</p>
          <p><span className="font-semibold text-emerald-400">Fin de ronda:</span> Cuando un jugador tiene todo boca arriba. Los demás juegan un último turno cada uno.</p>
          <p><span className="font-semibold text-emerald-400">Duplicar:</span> Si cierras la ronda pero no tienes la puntuación más baja que todos, ¡tus puntos se duplican!</p>
          <div className="pt-2">
            <p className="font-semibold text-emerald-400 mb-1">Colores:</p>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <span className="bg-gradient-to-br from-indigo-700 to-purple-800 border-2 border-white px-2 py-1 rounded text-white text-center font-bold">-2, -1</span>
              <span className="bg-gradient-to-br from-sky-400 to-cyan-500 border-2 border-white px-2 py-1 rounded text-white text-center font-bold">0</span>
              <span className="bg-gradient-to-br from-emerald-400 to-green-600 border-2 border-white px-2 py-1 rounded text-white text-center font-bold">1 – 4</span>
              <span className="bg-gradient-to-br from-yellow-300 to-amber-500 border-2 border-white px-2 py-1 rounded text-amber-950 text-center font-bold">5 – 8</span>
              <span className="bg-gradient-to-br from-red-500 to-rose-700 border-2 border-white px-2 py-1 rounded text-white text-center font-bold col-span-2">9 – 12</span>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="mt-5 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-lg transition-colors">Entendido</button>
      </div>
    </div>
  );
}

export function RoundModal({
  result,
  roundNumber,
  onNext,
}: {
  result: RoundResult;
  roundNumber: number;
  onNext: () => void;
}) {
  if (!result) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 text-slate-200 shadow-2xl">
        <h2 className="text-xl font-bold text-center mb-1 text-white">Ronda {roundNumber}</h2>
        <p className="text-center text-xs text-slate-400 mb-4 flex items-center justify-center gap-1">
          <Trophy size={12} /> Libreta de puntuación
        </p>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-700">
            <span>Jugador</span>
            <span className="text-right">Ronda</span>
            <span className="text-right">Total</span>
          </div>
          {result.players.map((p, i) => (
            <div key={p.id} className={`grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2.5 items-center ${i % 2 === 0 ? 'bg-slate-800/30' : ''} ${p.closed ? 'ring-1 ring-amber-500/30 bg-amber-900/10' : ''}`}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`text-xs font-bold ${i === 0 ? 'text-emerald-400' : 'text-slate-300'}`}>{i + 1}.</span>
                <span className="text-sm font-medium text-white truncate">{p.name}</span>
                {p.closed && <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-semibold">cerró</span>}
                {p.doubled && <span className="text-[9px] bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded font-semibold">x2</span>}
              </div>
              <span className={`text-sm font-bold text-right ${p.roundScore > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {p.roundScore > 0 ? '+' : ''}{p.roundScore}
              </span>
              <span className="text-sm font-bold text-right text-white">{p.finalScore}</span>
            </div>
          ))}
        </div>

        <button onClick={onNext} className="mt-5 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
          {result.isFinal ? 'Ver resultado final' : 'Siguiente ronda'} <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

const CARD_COLORS = [
  'from-indigo-700 to-purple-800',
  'from-sky-400 to-cyan-500',
  'from-emerald-400 to-green-600',
  'from-yellow-300 to-amber-500',
  'from-red-500 to-rose-700',
];

function CardRainOverlay() {
  const cards = Array.from({ length: 12 }, (_, i) => i);
  return (
    <div className="fixed inset-0 z-40 pointer-events-none overflow-hidden">
      {cards.map(i => {
        const left = (i * 8.5 + 4) % 100;
        const delay = (i * 0.8) % 6;
        const duration = 5 + (i % 3);
        const scale = 0.5 + (i % 4) * 0.15;
        return (
          <div
            key={i}
            className="absolute animate-card-rain"
            style={{
              left: `${left}%`,
              top: '-10vh',
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              transform: `scale(${scale})`,
            }}
          >
            <div className={`w-8 h-12 rounded-lg border-2 border-white/40 bg-gradient-to-br ${CARD_COLORS[i % CARD_COLORS.length]} shadow-lg opacity-60`} />
          </div>
        );
      })}
    </div>
  );
}

export function GameOverModal({
  result,
  onPlayAgain,
  onReset,
}: {
  result: RoundResult;
  onPlayAgain: () => void;
  onReset: () => void;
}) {
  const winner = result.players.find(p => p.id === result.winner);
  const youWon = result.winner === PLAYER_ID;
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (youWon) {
      const duration = 3000;
      const end = Date.now() + duration;
      const fire = () => {
        confetti({
          particleCount: 60,
          spread: 70,
          origin: { y: 0.6 },
          zIndex: 60,
          colors: ['#34d399', '#fbbf24', '#f59e0b', '#0ea5e9', '#ef4444', '#a78bfa'],
        });
        if (Date.now() < end) requestAnimationFrame(fire);
      };
      fire();
      setTimeout(() => {
        confetti({
          particleCount: 100,
          spread: 100,
          origin: { y: 0.5 },
          zIndex: 60,
          colors: ['#fbbf24', '#f59e0b', '#34d399'],
        });
      }, 500);
    }
  }, [youWon]);

  return (
    <>
      {!youWon && <CardRainOverlay />}
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className={`bg-slate-900 border ${youWon ? 'border-amber-500/40' : 'border-slate-700'} rounded-2xl max-w-sm w-full p-6 text-center shadow-2xl`}>
          <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 ${youWon ? 'bg-gradient-to-br from-amber-400 to-yellow-600 shadow-lg shadow-amber-500/40' : 'bg-slate-700'}`}>
            {youWon ? <Trophy size={32} className="text-white" /> : <Crown size={32} className="text-slate-400" />}
          </div>

          <h2 className={`text-2xl font-bold mb-1 ${youWon ? 'text-amber-300' : 'text-white'}`}>
            {youWon ? '¡Has ganado la partida!' : `¡Fin de la partida!`}
          </h2>
          {!youWon && (
            <p className="text-slate-400 mb-1 text-sm">
              Ganó <span className="font-semibold text-slate-200">{winner?.name}</span>
            </p>
          )}
          <p className="text-slate-400 mb-5 text-sm">
            {youWon ? 'Felicidades, mantuviste tu puntuación baja.' : 'El bot fue mejor esta vez. ¡Inténtalo de nuevo!'}
          </p>

          <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden mb-5">
            {result.players.map((p, i) => (
              <div key={p.id} className={`flex justify-between items-center px-4 py-2.5 ${i % 2 === 0 ? 'bg-slate-800/30' : ''} ${i === 0 ? 'ring-1 ring-emerald-500/30' : ''}`}>
                <div className="flex items-center gap-2">
                  {i === 0 && <Trophy size={14} className="text-amber-400" />}
                  <span className="text-sm font-medium text-white">{i + 1}. {p.name}</span>
                </div>
                <span className={`text-lg font-bold ${i === 0 ? 'text-emerald-400' : 'text-slate-300'}`}>{p.finalScore}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={onPlayAgain}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw size={18} /> Volver a jugar
            </button>
            <button
              onClick={onReset}
              className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Home size={18} /> Volver al inicio
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
