import { useEffect, useState } from 'react';
import {
  Users, Brain, Zap, RotateCcw, Sparkles, Target, Globe,
  Copy, Check, Play, LogIn, Plus, Bot, Loader2, ArrowLeft,
} from 'lucide-react';
import { AILevel, AdaptiveMemory } from '@/game/types';
import {
  OnlineRoomRow,
  createRoom,
  getRoom,
  joinRoom,
  getOrCreateClientId,
} from '@/lib/supabase';

interface SetupModalProps {
  open: boolean;
  onStart: (playerCount: number, aiLevel: AILevel) => void;
  onStartOnline: (room: OnlineRoomRow, myPlayerId: string, fillWithBots: boolean) => void;
  onJoinStartedOnline: (room: OnlineRoomRow, myPlayerId: string) => void;
  memory: AdaptiveMemory;
  onResetMemory: () => void;
}

export function SetupModal({
  open,
  onStart,
  onStartOnline,
  onJoinStartedOnline,
  memory,
  onResetMemory,
}: SetupModalProps) {
  const [mode, setMode] = useState<'solo' | 'online'>('solo');
  const [playerCount, setPlayerCount] = useState(2);
  const [aiLevel, setAiLevel] = useState<AILevel>('hard');

  // Estado online
  const [myId] = useState(() => getOrCreateClientId());
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('skyjo_player_name') || '');
  const [joinCode, setJoinCode] = useState('');
  const [room, setRoom] = useState<OnlineRoomRow | null>(null);
  const [fillWithBots, setFillWithBots] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Detectar si abren enlace con ?sala=XXXX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('sala');
    if (codeParam) {
      setMode('online');
      setJoinCode(codeParam.toUpperCase());
    }
  }, []);

  // Sincronizar sala de espera cada 1.2s mientras estamos en el lobby
  useEffect(() => {
    if (!open || !room) return;
    let active = true;
    const interval = setInterval(async () => {
      if (!active) return;
      const fresh = await getRoom(room.code);
      if (!fresh || !active) return;
      setRoom(fresh);
      if (fresh.status === 'playing' && fresh.game_state) {
        active = false;
        clearInterval(interval);
        setRoom(null);
        onJoinStartedOnline(fresh, myId);
      }
    }, 1200);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [open, room, myId, onJoinStartedOnline]);

  if (!open) return null;

  const saveName = (val: string) => {
    setPlayerName(val);
    localStorage.setItem('skyjo_player_name', val);
  };

  const handleCreateRoom = async () => {
    if (!playerName.trim()) {
      setError('Escribe tu nombre antes de crear la sala.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const created = await createRoom(myId, playerName);
      setRoom(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al crear sala');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!playerName.trim()) {
      setError('Escribe tu nombre antes de entrar.');
      return;
    }
    if (joinCode.trim().length < 4) {
      setError('Introduce el código de 4 letras.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const joined = await joinRoom(joinCode, myId, playerName);
      setRoom(joined);
      if (joined.status === 'playing' && joined.game_state) {
        setRoom(null);
        onJoinStartedOnline(joined, myId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo entrar en la sala');
    } finally {
      setLoading(false);
    }
  };

  const copyInviteLink = () => {
    if (!room) return;
    const url = `${window.location.origin}${window.location.pathname}?sala=${room.code}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const isHost = room?.host_id === myId;

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-950 to-slate-900 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md my-auto">
        {/* Logo header */}
        <div className="text-center mb-4">
          <div className="inline-flex items-center gap-2 mb-1">
            <div
              className="w-10 h-14 rounded-lg border-2 border-white shadow-lg flex items-center justify-center"
              style={{ background: 'conic-gradient(from 45deg, #1e3a8a, #059669, #f59e0b, #dc2626, #7c3aed, #1e3a8a)' }}
            >
              <span className="text-white font-bold text-[8px] tracking-widest" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                SKYJO
              </span>
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-widest">SKYJO</h1>
          <p className="text-slate-400 text-xs">El juego de cartas</p>
        </div>

        {/* Selector de modo */}
        {!room && (
          <div className="grid grid-cols-2 gap-1.5 bg-slate-800/80 p-1 rounded-xl border border-slate-700 mb-3">
            <button
              onClick={() => { setMode('solo'); setError(null); }}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                mode === 'solo' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Bot size={14} /> Contra Bots
            </button>
            <button
              onClick={() => { setMode('online'); setError(null); }}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                mode === 'online' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Globe size={14} /> Online con Amigos
            </button>
          </div>
        )}

        <div className="bg-slate-800/60 backdrop-blur border border-slate-700 rounded-2xl p-5 space-y-4">
          {mode === 'solo' ? (
            <>
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
                      className={`py-2.5 rounded-lg font-semibold text-sm transition-all border-2 ${
                        playerCount === n
                          ? 'bg-emerald-600 border-emerald-400 text-white shadow-lg shadow-emerald-600/30'
                          : 'bg-slate-700/50 border-slate-600 text-slate-300 hover:border-slate-500'
                      }`}
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
                    className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                      aiLevel === 'easy' ? 'border-emerald-400 bg-emerald-900/30' : 'border-slate-600 bg-slate-700/30 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles size={15} className={aiLevel === 'easy' ? 'text-emerald-400' : 'text-slate-400'} />
                      <span className="font-semibold text-sm text-white">Fácil (Casual)</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 ml-7">Juega relajado, a veces cierra sin calcular.</p>
                  </button>
                  <button
                    onClick={() => setAiLevel('hard')}
                    className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                      aiLevel === 'hard' ? 'border-emerald-400 bg-emerald-900/30' : 'border-slate-600 bg-slate-700/30 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Target size={15} className={aiLevel === 'hard' ? 'text-emerald-400' : 'text-slate-400'} />
                      <span className="font-semibold text-sm text-white">Difícil (Experto)</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 ml-7">Cuenta cartas y calcula riesgo contra todos.</p>
                  </button>
                  <button
                    onClick={() => setAiLevel('adaptive')}
                    className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                      aiLevel === 'adaptive' ? 'border-emerald-400 bg-emerald-900/30' : 'border-slate-600 bg-slate-700/30 hover:border-slate-500'
                    }`}
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
            </>
          ) : !room ? (
            /* Pantalla Crear / Unirse Online */
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Tu nombre en la mesa</label>
                <input
                  type="text"
                  maxLength={14}
                  value={playerName}
                  onChange={e => saveName(e.target.value)}
                  placeholder="Ej. Carla"
                  className="w-full bg-slate-900/80 border border-slate-600 focus:border-sky-400 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none"
                />
              </div>

              {error && (
                <div className="bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs px-3 py-2 rounded-lg">
                  {error}
                </div>
              )}

              <button
                onClick={handleCreateRoom}
                disabled={loading}
                className="w-full bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-sky-600/30 flex items-center justify-center gap-2 text-sm"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Crear sala nueva
              </button>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-slate-700" />
                <span className="flex-shrink mx-3 text-[11px] text-slate-500 uppercase">o únete con código</span>
                <div className="flex-grow border-t border-slate-700" />
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={4}
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="CÓDIGO"
                  className="w-28 bg-slate-900/80 border border-slate-600 focus:border-emerald-400 rounded-xl px-3 py-2.5 text-center font-mono font-bold tracking-widest text-base text-white uppercase outline-none"
                />
                <button
                  onClick={handleJoinRoom}
                  disabled={loading}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5 text-sm"
                >
                  <LogIn size={16} /> Entrar a sala
                </button>
              </div>
            </div>
          ) : (
            /* Sala de espera (Lobby) */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setRoom(null)}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                >
                  <ArrowLeft size={14} /> Salir
                </button>
                <span className="text-[11px] bg-sky-500/20 text-sky-300 px-2.5 py-0.5 rounded-full font-semibold">
                  Sala de espera ({room.players.length}/4)
                </span>
              </div>

              <div className="bg-slate-900/90 border border-slate-700 rounded-xl p-4 text-center">
                <p className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Código de la sala</p>
                <p className="text-3xl font-mono font-black tracking-[0.25em] text-amber-300">{room.code}</p>
                <button
                  onClick={copyInviteLink}
                  className="mt-2.5 inline-flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-emerald-300 px-3 py-1.5 rounded-lg border border-slate-600 transition-colors"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? '¡Enlace copiado para WhatsApp!' : 'Copiar enlace de invitación'}
                </button>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-300">Jugadores conectados:</p>
                {room.players.map((p, idx) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between bg-slate-900/60 border border-slate-700/80 rounded-lg px-3 py-2"
                  >
                    <span className="text-sm font-semibold text-white flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      {p.name} {p.id === myId && <span className="text-[10px] text-slate-400">(Tú)</span>}
                    </span>
                    {idx === 0 && (
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">
                        Anfitrión
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {isHost ? (
                <>
                  {room.players.length < 4 && (
                    <label className="flex items-center gap-2 text-xs text-slate-300 bg-slate-900/40 p-2.5 rounded-lg border border-slate-700/60 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={fillWithBots}
                        onChange={e => setFillWithBots(e.target.checked)}
                        className="rounded accent-emerald-500"
                      />
                      Rellenar huecos libres hasta 4 jugadores con bots
                    </label>
                  )}

                  <button
                    onClick={() => {
                      const currentRoom = room;
                      setRoom(null);
                      onStartOnline(currentRoom, myId, fillWithBots);
                    }}
                    disabled={room.players.length < 2 && !fillWithBots}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 text-sm"
                  >
                    <Play size={16} /> Empezar partida online
                  </button>
                </>
              ) : (
                <div className="text-center py-2 text-xs text-slate-400 flex items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin text-sky-400" />
                  Esperando a que el anfitrión empiece la partida...
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}