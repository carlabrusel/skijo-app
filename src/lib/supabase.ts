const SUPABASE_URL = 'https://wlvketelauqbueskunyo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_yjEq7NshLjbsyj9958aSPw__c7DbhFV';

const REST_URL = `${SUPABASE_URL}/rest/v1/skyjo_rooms`;

const headers: Record<string, string> = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

export interface OnlineLobbyPlayer {
  id: string;
  name: string;
  joinedAt: number;
}

export interface OnlineRoomRow {
  code: string;
  host_id: string;
  status: 'lobby' | 'playing';
  players: OnlineLobbyPlayer[];
  game_state: unknown | null;
  updated_at: string;
}

export function getOrCreateClientId(): string {
  const key = 'skyjo_client_id';
  let id = sessionStorage.getItem(key) || localStorage.getItem(key);
  if (!id) {
    id = 'p_' + Math.random().toString(36).substring(2, 10);
    sessionStorage.setItem(key, id);
    localStorage.setItem(key, id);
  }
  return id;
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function createRoom(hostId: string, hostName: string): Promise<OnlineRoomRow> {
  const code = generateRoomCode();
  const payload = {
    code,
    host_id: hostId,
    status: 'lobby',
    players: [{ id: hostId, name: hostName.trim() || 'Anfitrión', joinedAt: Date.now() }],
    game_state: null,
    updated_at: new Date().toISOString(),
  };

  const res = await fetch(REST_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error('No se pudo crear la sala. Revisa la tabla en Supabase.');
  }
  const data = await res.json();
  return data[0];
}

export async function getRoom(code: string): Promise<OnlineRoomRow | null> {
  const clean = code.trim().toUpperCase();
  const res = await fetch(
    `${REST_URL}?code=eq.${encodeURIComponent(clean)}&select=*&_t=${Date.now()}`,
    {
      headers,
      cache: 'no-store',
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] ?? null;
}

export async function joinRoom(code: string, playerId: string, playerName: string): Promise<OnlineRoomRow> {
  const room = await getRoom(code);
  if (!room) throw new Error('Sala no encontrada. Comprueba el código.');

  const exists = room.players.some(p => p.id === playerId);
  if (!exists) {
    if (room.status !== 'lobby') {
      throw new Error('La partida ya ha empezado.');
    }
    if (room.players.length >= 4) {
      throw new Error('La sala ya está llena (máximo 4 jugadores).');
    }
  }

  const updatedPlayers = exists
    ? room.players.map(p => (p.id === playerId ? { ...p, name: playerName.trim() || p.name } : p))
    : [...room.players, { id: playerId, name: playerName.trim() || 'Jugador', joinedAt: Date.now() }];

  const res = await fetch(`${REST_URL}?code=eq.${encodeURIComponent(room.code)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      players: updatedPlayers,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) throw new Error('Error al entrar en la sala.');
  const data = await res.json();
  return data[0];
}

export async function updateRoomState(
  code: string,
  patch: Partial<Pick<OnlineRoomRow, 'status' | 'players' | 'game_state'>>
): Promise<OnlineRoomRow | null> {
  const res = await fetch(`${REST_URL}?code=eq.${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      ...patch,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] ?? null;
}