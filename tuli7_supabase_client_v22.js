// FIXED SUPABASE CLIENT
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const supabaseUrl = 'https://fczmfxhgrpdljgtvpihl.supabase.co'
export const supabaseKey = 'sb_publishable_g4QxKz3RxiCx_a3GgH75wg_XnduFosO'

export const supabase = createClient(supabaseUrl, supabaseKey)

export async function createSession(sessionName, pin) {
  const cleanName = (sessionName || '').trim().toUpperCase()
  const cleanPin = String(pin || '').trim()

  const { data, error } = await supabase
    .from('sessions')
    .insert([{ session_name: cleanName, pin: cleanPin, status: 'active' }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function joinSession(sessionName, pin) {
  const cleanName = (sessionName || '').trim().toUpperCase()
  const cleanPin = String(pin || '').trim()

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('session_name', cleanName)
    .eq('pin', cleanPin)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function listSessionPlayers(sessionId) {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function listSessionZones(sessionId) {
  const { data, error } = await supabase
    .from('zones')
    .select('*')
    .eq('session_id', sessionId)
    .in('state', ['pending', 'active'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function addPlayer(sessionId, playerCode, side) {
  const { data, error } = await supabase
    .from('players')
    .insert([{
      session_id: sessionId,
      player_code: playerCode,
      side,
      status: 'OK',
      cause: 'NONE'
    }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updatePlayerState(playerId, patch) {
  const { error } = await supabase
    .from('players')
    .update({ ...patch, last_seen: new Date().toISOString() })
    .eq('id', playerId)
  if (error) throw error
}

export async function createZone(sessionId, zone) {
  const payload = {
    session_id: sessionId,
    type: zone.type,
    state: zone.state ?? 'active',
    geometry_json: zone.geometry_json,
    weapon: zone.weapon ?? null,
    delay_sec: zone.delay_sec ?? 0,
    activated_at: zone.activated_at ?? null,
    expires_at: zone.expires_at ?? null
  }
  const { data, error } = await supabase
    .from('zones')
    .insert([payload])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateSessionStatus(sessionId, status) {
  const { error } = await supabase
    .from('sessions')
    .update({ status })
    .eq('id', sessionId)
  if (error) throw error
}

export async function logEvent(sessionId, eventType, payload = {}) {
  const { error } = await supabase
    .from('events')
    .insert([{ session_id: sessionId, event_type: eventType, payload_json: payload }])
  if (error) throw error
}

export function subscribeToSession(sessionId, handlers = {}) {
  const channel = supabase.channel(`tuli7-session-${sessionId}`)

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` },
    payload => handlers.onPlayers?.(payload)
  )

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'zones', filter: `session_id=eq.${sessionId}` },
    payload => handlers.onZones?.(payload)
  )

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'events', filter: `session_id=eq.${sessionId}` },
    payload => handlers.onEvents?.(payload)
  )

  channel.subscribe(status => handlers.onStatus?.(status))
  return channel
}
