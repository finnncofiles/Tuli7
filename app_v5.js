const TULI7_V5_SUPABASE_URL = 'https://fczmfxhgrpdljgtvpihl.supabase.co'
const TULI7_V5_SUPABASE_ANON_KEY = 'sb_publishable_g4QxKz3RxiCx_a3GgH75wg_XnduFosO'
const TULI7_V5_CHANNEL_NAME = 'tuli7_v5'

const supabase = window.supabase.createClient(TULI7_V5_SUPABASE_URL, TULI7_V5_SUPABASE_ANON_KEY)

const state = {
  session: null,
  player: null,
  role: null,
  players: [],
  zones: [],
  events: [],
  map: null,
  baseLayer: null,
  trainerMarker: null,
  sessionChannel: null,
  mode: 'ARTY',
  gpsWatchId: null,
  playerMarker: null,
  zoneLayers: []
}

const q = id => document.getElementById(id)

function show(id){
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'))
  q(id).classList.add('active')
  if (id === 'trainerScreen') ensureMap()
}

function msg(el, text){ q(el).textContent = text }

function logEvent(text){
  state.events.unshift(new Date().toLocaleTimeString('en-GB') + '  ' + text)
  state.events = state.events.slice(0, 20)
  const root = q('eventLog')
  if (!root) return
  root.innerHTML = ''
  state.events.forEach(item => {
    const div = document.createElement('div')
    div.className = 'row mono'
    div.textContent = item
    root.appendChild(div)
  })
}

function updateSessionLabels(){
  const name = state.session?.session_name || '-'
  const pin = state.session?.pin || '----'
  if (q('createdName')) q('createdName').textContent = name
  if (q('createdPin')) q('createdPin').textContent = pin
  if (q('trainerSessionName')) q('trainerSessionName').textContent = name
  if (q('trainerSessionPin')) q('trainerSessionPin').textContent = pin
  if (q('trainerTitle')) q('trainerTitle').textContent = name + ' / TRAINER / TULI7 V5'
  if (q('playerSessionInfo')) q('playerSessionInfo').textContent = 'Session: ' + name
}

function playerColor(status){
  if (status === 'OK') return '#86efac'
  if (status === 'SUP') return '#fde68a'
  if (status === 'WIA') return '#fca5a5'
  if (status === 'KIA') return '#cbd5e1'
  return '#9aa6bf'
}

function renderRoster(){
  const blue = state.players.filter(p => p.side === 'BLUE').length
  const red = state.players.filter(p => p.side === 'RED').length
  if (q('blueCount')) q('blueCount').textContent = 'BLUE: ' + blue
  if (q('redCount')) q('redCount').textContent = 'RED: ' + red
  if (q('totalCount')) q('totalCount').textContent = 'TOTAL: ' + state.players.length

  const list = q('rosterList')
  if (!list) return
  list.innerHTML = ''
  state.players.forEach(p => {
    const div = document.createElement('div')
    div.className = 'row'
    div.innerHTML = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${playerColor(p.status)};margin-right:8px"></span><strong>${p.player_code}</strong>  ${p.side}  ${p.status}  ${p.cause || 'NONE'}`
    list.appendChild(div)
  })
}

function setPlayerStatus(status, cause){
  if (q('playerStatus')) {
    q('playerStatus').textContent = 'STATUS: ' + status
    q('playerStatus').className = 'status ' + (
      status === 'OK' ? 'ok' :
      status === 'SUP' ? 'warn' :
      status === 'WIA' ? 'danger' :
      'danger'
    )
  }
  if (q('playerCause')) q('playerCause').textContent = 'CAUSE: ' + cause
  if (q('playerBanner')) q('playerBanner').textContent = status === 'OK' ? 'READY' : status
}

async function refreshPlayers(){
  if (!state.session) return
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('session_id', state.session.id)
    .order('joined_at', { ascending: true })
  if (error) {
    logEvent('ERR players: ' + error.message)
    return
  }
  state.players = data || []
  renderRoster()
}

async function refreshZones(){
  if (!state.session) return
  const { data, error } = await supabase
    .from('zones')
    .select('*')
    .eq('session_id', state.session.id)
    .order('created_at', { ascending: true })
  if (error) {
    logEvent('ERR zones: ' + error.message)
    return
  }
  state.zones = data || []
  drawZones()
}

function ensureMap(){
  if (!q('map')) return
  if (state.map) {
    setTimeout(() => state.map.invalidateSize(), 50)
    return
  }
  state.map = L.map('map', { zoomControl: true }).setView([60.1699, 24.9384], 13)
  state.baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'OSM'
  }).addTo(state.map)

  state.map.on('click', async (e) => {
    if (state.role !== 'trainer' || !state.session) return
    await createZoneAt(e.latlng)
  })
}

function clearZoneLayers(){
  state.zoneLayers.forEach(layer => {
    if (state.map && state.map.hasLayer(layer)) state.map.removeLayer(layer)
  })
  state.zoneLayers = []
}

function drawZones(){
  if (!state.map) return
  clearZoneLayers()
  state.zones.forEach(z => {
    const g = z.geometry_json || {}
    if (!g.center || !g.radius) return
    const center = [g.center.lat, g.center.lon]
    const color = z.type === 'ARTY' ? '#ef4444' : z.type === 'MINES' ? '#a855f7' : '#22d3ee'
    const circle = L.circle(center, { radius: g.radius, color, weight: 2, fillOpacity: 0.12 }).addTo(state.map)
    const label = L.marker(center, {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:rgba(0,0,0,.75);border:1px solid #223147;border-radius:999px;padding:4px 8px;color:white;font-size:12px;font-weight:700">${z.type}</div>`
      })
    }).addTo(state.map)
    state.zoneLayers.push(circle, label)
  })
}

async function createSession(){
  const session_name = q('createSessionName').value.trim().toUpperCase()
  const pin = q('createPin').value.trim()
  if (!session_name) { msg('createMsg', 'Session name is required'); return }
  if (!pin) { msg('createMsg', 'PIN is required'); return }

  const { data, error } = await supabase
    .from('sessions')
    .insert([{ session_name, pin, status: 'active' }])
    .select()
    .single()

  if (error) { msg('createMsg', error.message); return }

  state.session = data
  state.role = 'trainer'
  updateSessionLabels()
  msg('createMsg', 'Session created')
  await subscribeSession()
  show('createdScreen')
  logEvent('SESSION CREATED ' + state.session.session_name)
}

async function joinSession(){
  const session_name = q('joinSessionName').value.trim().toUpperCase()
  const pin = q('joinPin').value.trim()
  if (!session_name) { msg('joinMsg', 'Session name is required'); return }
  if (!pin) { msg('joinMsg', 'PIN is required'); return }

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('session_name', session_name)
    .eq('pin', pin)
    .eq('status', 'active')
    .maybeSingle()

  if (error) { msg('joinMsg', error.message); return }
  if (!data) { msg('joinMsg', 'Session not found'); return }

  state.session = data
  state.role = 'player'
  updateSessionLabels()
  await subscribeSession()
  msg('joinMsg', 'Session OK')
  show('sideScreen')
  logEvent('JOINED SESSION ' + state.session.session_name)
}

async function addPlayer(side){
  if (!state.session) return
  const existing = state.players.filter(p => p.side === side).length + 1
  const player_code = side + ' ' + existing

  const { data, error } = await supabase
    .from('players')
    .insert([{
      session_id: state.session.id,
      player_code,
      side,
      status: 'OK',
      cause: 'NONE'
    }])
    .select()
    .single()

  if (error) {
    alert('Add player failed: ' + error.message)
    return
  }

  state.player = data
  if (q('playerId')) q('playerId').textContent = player_code
  setPlayerStatus('OK', 'NONE')
  await refreshPlayers()
  show('playerScreen')
  logEvent('PLAYER ADDED ' + player_code)
}

async function createZoneAt(latlng){
  if (!state.session) return
  const radius = state.mode === 'ARTY' ? 120 : state.mode === 'MINES' ? 60 : 90
  const geometry_json = {
    center: { lat: latlng.lat, lon: latlng.lng },
    radius
  }

  const { data, error } = await supabase
    .from('zones')
    .insert([{
      session_id: state.session.id,
      type: state.mode,
      geometry_json
    }])
    .select()
    .single()

  if (error) {
    logEvent('ERR create zone: ' + error.message)
    return
  }

  logEvent('ZONE CREATED ' + data.type)
  await refreshZones()
}

function pointDistanceMeters(lat1, lon1, lat2, lon2){
  const R = 6371000
  const toRad = deg => deg * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

async function evaluateGeofence(lat, lon){
  if (!state.player) return
  let activeZone = 'NONE'

  for (const zone of state.zones) {
    const g = zone.geometry_json || {}
    if (!g.center || !g.radius) continue
    const d = pointDistanceMeters(lat, lon, g.center.lat, g.center.lon)
    if (d <= g.radius) {
      activeZone = zone.type
      if (zone.type === 'ARTY') {
        await updatePlayer('KIA', 'ARTY')
      } else if (zone.type === 'MINES') {
        if (Math.random() < 0.25) await updatePlayer('WIA', 'MINE')
      } else if (zone.type === 'CBRN') {
        if (q('zoneInfo')) q('zoneInfo').textContent = 'Zone: CBRN'
        if (q('playerBanner')) q('playerBanner').textContent = 'CBRN'
      }
      break
    }
  }

  if (q('zoneInfo')) q('zoneInfo').textContent = 'Zone: ' + activeZone
}

async function updatePlayer(status, cause){
  if (!state.player) return
  const { error } = await supabase
    .from('players')
    .update({
      status,
      cause,
      last_seen: new Date().toISOString()
    })
    .eq('id', state.player.id)

  if (error) {
    logEvent('ERR update player: ' + error.message)
    return
  }

  state.player.status = status
  state.player.cause = cause
  setPlayerStatus(status, cause)
  logEvent('PLAYER STATUS ' + status + ' ' + cause)
}

function subscribeSession(){
  if (!state.session || state.sessionChannel) return Promise.resolve()

  state.sessionChannel = supabase
    .channel(TULI7_V5_CHANNEL_NAME + '_' + state.session.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `session_id=eq.${state.session.id}` }, async () => {
      await refreshPlayers()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'zones', filter: `session_id=eq.${state.session.id}` }, async () => {
      await refreshZones()
    })
    .subscribe((status) => {
      logEvent('CHANNEL ' + status)
    })

  return Promise.all([refreshPlayers(), refreshZones()])
}

function startGps(){
  if (!navigator.geolocation) {
    if (q('gpsInfo')) q('gpsInfo').textContent = 'GPS unavailable'
    return
  }
  if (state.gpsWatchId !== null) {
    if (q('gpsInfo')) q('gpsInfo').textContent = 'GPS already active'
    return
  }
  state.gpsWatchId = navigator.geolocation.watchPosition(async (pos) => {
    const lat = pos.coords.latitude
    const lon = pos.coords.longitude
    const acc = Math.round(pos.coords.accuracy || 0)
    if (q('gpsInfo')) q('gpsInfo').textContent = `GPS: ${lat.toFixed(5)}, ${lon.toFixed(5)} ±${acc}m`

    if (state.player) {
      const { error } = await supabase
        .from('players')
        .update({ lat, lon, last_seen: new Date().toISOString() })
        .eq('id', state.player.id)

      if (!error && state.map) {
        const ll = [lat, lon]
        if (!state.playerMarker) {
          state.playerMarker = L.circleMarker(ll, { radius: 8, color: '#ffffff', weight: 2, fillColor: '#3b82f6', fillOpacity: 1 }).addTo(state.map)
        } else {
          state.playerMarker.setLatLng(ll)
        }
      }
      await evaluateGeofence(lat, lon)
    }
  }, () => {
    if (q('gpsInfo')) q('gpsInfo').textContent = 'GPS denied'
  }, {
    enableHighAccuracy: true,
    maximumAge: 3000,
    timeout: 5000
  })
}

function stopGps(){
  if (state.gpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.gpsWatchId)
  }
  state.gpsWatchId = null
  if (q('gpsInfo')) q('gpsInfo').textContent = 'GPS inactive'
}

async function endSession(){
  if (!state.session) return
  const { error } = await supabase
    .from('sessions')
    .update({ status: 'ended' })
    .eq('id', state.session.id)
  if (error) {
    logEvent('ERR end session: ' + error.message)
    return
  }
  logEvent('SESSION ENDED')
}

function bind(){
  q('goCreateBtn').onclick = () => show('createScreen')
  q('goJoinBtn').onclick = () => show('joinScreen')
  q('backFromCreate').onclick = () => show('home')
  q('backFromJoin').onclick = () => show('home')
  q('backFromSide').onclick = () => show('joinScreen')
  q('createdHomeBtn').onclick = () => show('home')
  q('openTrainerBtn').onclick = () => show('trainerScreen')
  q('trainerHomeBtn').onclick = () => show('home')
  q('playerHomeBtn').onclick = () => show('home')

  q('createSessionBtn').onclick = createSession
  q('joinSessionBtn').onclick = joinSession
  q('blueBtn').onclick = () => addPlayer('BLUE')
  q('redBtn').onclick = () => addPlayer('RED')
  q('gpsStartBtn').onclick = startGps
  q('gpsStopBtn').onclick = stopGps
  q('playerRefreshBtn').onclick = refreshZones
  q('supBtn').onclick = () => updatePlayer('SUP', 'MANUAL')
  q('wiaBtn').onclick = () => updatePlayer('WIA', 'MANUAL')
  q('kiaBtn').onclick = () => updatePlayer('KIA', 'MANUAL')
  q('resetPlayerBtn').onclick = () => updatePlayer('OK', 'NONE')
  q('endSessionBtn').onclick = endSession
  q('clearMapBtn').onclick = clearZoneLayers

  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.onclick = () => {
      state.mode = btn.dataset.mode
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      logEvent('MODE ' + state.mode)
    }
  })
}

bind()
