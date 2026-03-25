const supabaseUrl = 'https://fczmfxhgrpdljgtvpihl.supabase.co'
const supabaseKey = 'sb_publishable_g4QxKz3RxiCx_a3GgH75wg_XnduFosO'

const supabase = window.supabase.createClient(supabaseUrl, supabaseKey)

async function createSession(sessionName, pin) {
  const { data, error } = await supabase.rpc('create_session_rpc', {
    p_session_name: sessionName.toUpperCase(),
    p_pin: pin
  })

  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

async function joinSession(sessionName, pin) {
  const { data, error } = await supabase.rpc('join_session_rpc', {
    p_session_name: sessionName.toUpperCase(),
    p_pin: pin
  })

  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

async function listSessionPlayers(sessionId) {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })

  if (error) throw error
  return data || []
}

async function listSessionZones(sessionId) {
  const { data, error } = await supabase
    .from('zones')
    .select('*')
    .eq('session_id', sessionId)
    .in('state', ['pending', 'active'])
    .order('created_at', { ascending: true })

  if (error) throw error
  return data || []
}

async function addPlayer(sessionId, playerCode, side) {
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

async function updatePlayerState(playerId, patch) {
  const { error } = await supabase
    .from('players')
    .update({ ...patch, last_seen: new Date().toISOString() })
    .eq('id', playerId)

  if (error) throw error
}

async function createZone(sessionId, zone) {
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

async function updateSessionStatus(sessionId, status) {
  const { error } = await supabase
    .from('sessions')
    .update({ status })
    .eq('id', sessionId)

  if (error) throw error
}

async function logEvent(sessionId, eventType, payload = {}) {
  const { error } = await supabase
    .from('events')
    .insert([{
      session_id: sessionId,
      event_type: eventType,
      payload_json: payload
    }])

  if (error) throw error
}

function subscribeToSession(sessionId, handlers = {}) {
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


window.Tuli7Supabase = {
  ready: true,
  supabase,
  createSession,
  joinSession,
  listSessionPlayers,
  listSessionZones,
  addPlayer,
  updatePlayerState,
  createZone,
  updateSessionStatus,
  logEvent,
  subscribeToSession
};
