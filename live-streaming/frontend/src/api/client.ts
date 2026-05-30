const API = '/api'  // proxied to http://localhost:8082 by Vite; change for Docker build
export const WS_URL = 'ws://localhost:8083'
export const HLS_URL = 'http://localhost:8084'

export interface Channel {
  id: string
  username: string
  title: string
  live: boolean
  viewerCount: number
  hlsUrl: string
}

export interface AuthResponse {
  token: string
  userId: string
  username: string
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = localStorage.getItem('token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data as T
}

export async function register(username: string, email: string, password: string) {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ username, email, password }),
  })
  return handleResponse<AuthResponse>(res)
}

export async function login(username: string, password: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ username, password }),
  })
  return handleResponse<AuthResponse>(res)
}

export async function listLiveChannels() {
  const res = await fetch(`${API}/channels`)
  return handleResponse<Channel[]>(res)
}

export async function getChannel(id: string) {
  const res = await fetch(`${API}/channels/${id}`)
  return handleResponse<Channel>(res)
}

export async function getMyChannel() {
  const res = await fetch(`${API}/channels/me`, { headers: headers() })
  return handleResponse<Channel>(res)
}

export async function getStreamKey() {
  const res = await fetch(`${API}/channels/me/stream-key`, { headers: headers() })
  return handleResponse<{ streamKey: string; rtmpUrl: string }>(res)
}

export async function updateChannelTitle(title: string) {
  const res = await fetch(`${API}/channels/me`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ title }),
  })
  return handleResponse<Channel>(res)
}

export async function regenerateStreamKey() {
  const res = await fetch(`${API}/channels/me/stream-key/regenerate`, {
    method: 'POST',
    headers: headers(),
  })
  return handleResponse<{ streamKey: string; rtmpUrl: string }>(res)
}
