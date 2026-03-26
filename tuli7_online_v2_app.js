(function(){
  const SUPABASE_URL = 'https://fczmfxhgrpdljgtvpihl.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_g4QxKz3RxiCx_a3GgH75wg_XnduFosO';
  const WEAPONS = {
    '81mm': {name:'81mm', r1:25, r2:60, r3:110},
    '120mm': {name:'120mm', r1:35, r2:80, r3:140},
    '122mm': {name:'122mm', r1:45, r2:95, r3:170},
    '155mm': {name:'155mm', r1:55, r2:120, r3:210}
  };
  const state = {
    supabase:null, sessionId:null, sessionName:'', sessionPin:'', currentPlayerId:null, currentPlayerCode:'',
    rosterTimer:null, zoneTimer:null, eventTimer:null, trainerMap:null, playerMap:null,
    localZonesLayer:null, playerZonesLayer:null, meMarker:null, gpsWatchId:null,
    mode:'arty', weapon:'81mm', delay:0, drawStart:null, drawPreview:null, pendingBounds:null,
    zoneState:{}, debugLines:[]
  };

  function q(id){ return document.getElementById(id); }
  function setMsg(id, text){ q(id).textContent = text || ''; }
  function log(text){
    const line = '[' + new Date().toLocaleTimeString('fi-FI') + '] ' + text;
    state.debugLines.unshift(line);
    state.debugLines = state.debugLines.slice(0, 14);
    q('homeStatus').textContent = state.debugLines.join('\n');
    console.log(line);
  }
  function show(id){
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    q(id).classList.add('active');
    if(id === 'trainerScreen'){
      ensureTrainerMap();
      startTrainerLoops();
      setTimeout(() => state.trainerMap && state.trainerMap.invalidateSize(), 80);
    } else {
      stopTrainerLoops();
    }
    if(id === 'playerScreen'){
      ensurePlayerMap();
      setTimeout(() => state.playerMap && state.playerMap.invalidateSize(), 80);
    }
  }
  function readableError(err){
    if(!err) return 'Unknown error';
    if(typeof err === 'string') return err;
    const msg = err.message || err.error_description || JSON.stringify(err);
    if(/duplicate key value/i.test(msg)) return 'Session name already exists';
    return msg;
  }
  function validPin6(pin){ return /^\d{6}$/.test(pin); }
  function randomPin6(){ return String(Math.floor(100000 + Math.random() * 900000)); }
  function escapeHtml(str){
    return String(str).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }

  function initSupabase(){
    if(!window.supabase || !window.supabase.createClient) throw new Error('Supabase CDN not loaded');
    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    log('Supabase client initialized');
  }

  async function healthCheck(){
    const { error } = await state.supabase.from('sessions').select('id', { count:'exact', head:true });
    if(error) throw error;
    log('Supabase check OK');
  }

  async function createSession(sessionName, pin){
    const { data, error } = await state.supabase.rpc('create_session_rpc', {
      p_session_name: sessionName.toUpperCase(),
      p_pin: pin
    });
    if(error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if(!row || !row.id) throw new Error('RPC returned no row');
    return row;
  }

  async function joinSession(sessionName, pin){
    const { data, error } = await state.supabase.rpc('join_session_rpc', {
      p_session_name: sessionName.toUpperCase(),
      p_pin: pin
    });
    if(error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if(!row || !row.id) throw new Error('Session not found or wrong PIN');
    return row;
  }

  async function listPlayers(sessionId){
    const { data, error } = await state.supabase.from('players').select('*').eq('session_id', sessionId).order('joined_at', { ascending:true });
    if(error) throw error;
    return data || [];
  }

  async function addPlayer(sessionId, side){
    const existing = await listPlayers(sessionId);
    const next = existing.filter(p => p.side === side).length + 1;
    const code = side + ' ' + next;
    const { data, error } = await state.supabase.from('players').insert([{
      session_id: sessionId, player_code: code, side: side, status:'OK', cause:'NONE'
    }]).select().single();
    if(error) throw error;
    return data;
  }

  async function updatePlayer(playerId, patch){
    const { error } = await state.supabase.from('players').update({
      ...patch, last_seen: new Date().toISOString()
    }).eq('id', playerId);
    if(error) throw error;
  }

  async function listZones(sessionId){
    const { data, error } = await state.supabase.from('zones').select('*').eq('session_id', sessionId).in('state', ['active','pending']).order('created_at', { ascending:false });
    if(error) throw error;
    return data || [];
  }

  async function createZone(payload){
    const { data, error } = await state.supabase.from('zones').insert([payload]).select().single();
    if(error) throw error;
    return data;
  }

  async function listEvents(sessionId){
    const { data, error } = await state.supabase.from('events').select('*').eq('session_id', sessionId).order('created_at', { ascending:false }).limit(12);
    if(error) throw error;
    return data || [];
  }

  async function logEvent(eventType, payload){
    const { error } = await state.supabase.from('events').insert([{
      session_id: state.sessionId, event_type: eventType, payload_json: payload || {}
    }]);
    if(error) throw error;
  }

  function setCreatedView(name, pin){
    q('createdName').textContent = name;
    q('createdPin').textContent = pin;
    q('trainerSessionName').textContent = name;
    q('trainerPin').textContent = pin;
    q('playerSessionLine').textContent = 'Session: ' + name;
  }

  function setMode(mode){
    state.mode = mode;
    document.querySelectorAll('[data-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    setMsg('mapMsg', mode === 'arty' ? 'ARTY: tap map to place impact.' : mode.toUpperCase() + ': tap point 1, tap point 2, then confirm.');
    cancelDraw();
  }
  function setWeapon(weapon){
    state.weapon = weapon;
    document.querySelectorAll('[data-weapon]').forEach(btn => btn.classList.toggle('active', btn.dataset.weapon === weapon));
  }
  function setDelay(delay){
    state.delay = Number(delay);
    document.querySelectorAll('[data-delay]').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.delay) === Number(delay)));
  }

  function ensureTrainerMap(){
    if(state.trainerMap) return;
    state.trainerMap = L.map('trainerMap').setView([60.1699, 24.9384], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'OSM' }).addTo(state.trainerMap);
    state.localZonesLayer = L.layerGroup().addTo(state.trainerMap);
    state.trainerMap.on('click', async e => {
      if(!state.sessionId){ setMsg('mapMsg', 'No active session.'); return; }
      if(state.mode === 'arty') await placeArty(e.latlng);
      else handleDrawClick(e.latlng);
    });
  }

  function ensurePlayerMap(){
    if(state.playerMap) return;
    state.playerMap = L.map('playerMap').setView([60.1699, 24.9384], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'OSM' }).addTo(state.playerMap);
    state.playerZonesLayer = L.layerGroup().addTo(state.playerMap);
  }

  function handleDrawClick(latlng){
    if(!state.drawStart){
      state.drawStart = latlng;
      setMsg('mapMsg', state.mode.toUpperCase() + ': point 1 placed. Tap point 2.');
      return;
    }
    if(state.drawPreview){
      state.localZonesLayer.removeLayer(state.drawPreview);
      state.drawPreview = null;
    }
    state.pendingBounds = L.latLngBounds(state.drawStart, latlng);
    const color = state.mode === 'mines' ? '#a855f7' : '#22d3ee';
    state.drawPreview = L.rectangle(state.pendingBounds, { color:color, weight:2, dashArray:'6,6', fillOpacity:0.16 }).addTo(state.localZonesLayer);
    state.drawStart = null;
    setMsg('mapMsg', state.mode.toUpperCase() + ': preview ready. Confirm draw.');
  }

  function cancelDraw(){
    state.drawStart = null;
    state.pendingBounds = null;
    if(state.drawPreview && state.localZonesLayer) state.localZonesLayer.removeLayer(state.drawPreview);
    state.drawPreview = null;
  }

  async function confirmDraw(){
    if(!state.pendingBounds){ setMsg('mapMsg', 'No pending draw.'); return; }
    try{
      await createZone({
        session_id: state.sessionId,
        type: state.mode,
        state: 'active',
        geometry_json: {
          bounds: [
            [state.pendingBounds.getSouthWest().lat, state.pendingBounds.getSouthWest().lng],
            [state.pendingBounds.getNorthEast().lat, state.pendingBounds.getNorthEast().lng]
          ]
        }
      });
      await logEvent(state.mode + '_zone_created', { mode: state.mode });
      setMsg('mapMsg', state.mode.toUpperCase() + ' zone saved.');
      cancelDraw();
      await renderZones();
      await renderEvents();
    }catch(err){
      setMsg('mapMsg', 'Save draw failed: ' + readableError(err));
      log('Draw save FAIL: ' + readableError(err));
    }
  }

  async function placeArty(latlng){
    const w = WEAPONS[state.weapon];
    try{
      await createZone({
        session_id: state.sessionId,
        type: 'arty',
        state: 'active',
        weapon: state.weapon,
        delay_sec: state.delay,
        geometry_json: { center:[latlng.lat, latlng.lng], r1:w.r1, r2:w.r2, r3:w.r3 },
        activated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + Math.max(10000, state.delay * 1000 + 15000)).toISOString()
      });
      await logEvent('arty_created', { weapon:state.weapon, delay:state.delay });
      setMsg('mapMsg', 'ARTY saved: ' + w.name + ' / ' + (state.delay === 0 ? 'NOW' : state.delay + 's'));
      await renderZones();
      await renderEvents();
    }catch(err){
      setMsg('mapMsg', 'ARTY failed: ' + readableError(err));
      log('ARTY FAIL: ' + readableError(err));
    }
  }

  async function renderRoster(){
    if(!state.sessionId){
      setMsg('trainerMsg', 'No active trainer session.');
      q('rosterList').innerHTML = '';
      q('blueCountStat').textContent = 'BLUE: 0';
      q('redCountStat').textContent = 'RED: 0';
      q('totalCountStat').textContent = 'TOTAL: 0';
      return;
    }
    try{
      const players = await listPlayers(state.sessionId);
      q('rosterList').innerHTML = '';
      q('blueCountStat').textContent = 'BLUE: ' + players.filter(p => p.side === 'BLUE').length;
      q('redCountStat').textContent = 'RED: ' + players.filter(p => p.side === 'RED').length;
      q('totalCountStat').textContent = 'TOTAL: ' + players.length;
      if(players.length === 0){ setMsg('trainerMsg', 'Ei pelaajia vielä.'); return; }
      players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'item';
        const statusClass = (p.status || 'OK').toLowerCase();
        div.innerHTML =
          '<div class="rosterhead"><span>' + escapeHtml(p.player_code || '') + '</span><span class="tag">' + escapeHtml(p.side || '') + '</span></div>' +
          '<div class="meta">Status: <strong class="' + statusClass + '">' + escapeHtml(p.status || '') + '</strong><br>Cause: ' + escapeHtml(p.cause || '') + '</div>';
        q('rosterList').appendChild(div);
      });
      setMsg('trainerMsg', 'Roster updated.');
    }catch(err){
      setMsg('trainerMsg', 'Roster failed: ' + readableError(err));
      log('Roster FAIL: ' + readableError(err));
    }
  }

  function normalizeZone(row){
    const g = row.geometry_json || {};
    if(row.type === 'arty' && g.center){
      return { type:'arty', center:g.center, r1:g.r1, r2:g.r2, r3:g.r3 };
    }
    if((row.type === 'mines' || row.type === 'cbrn') && g.bounds){
      return { type:row.type, bounds:g.bounds };
    }
    return null;
  }

  async function renderZones(){
    try{
      const zones = await listZones(state.sessionId);
      if(state.localZonesLayer) state.localZonesLayer.clearLayers();
      if(state.playerZonesLayer) state.playerZonesLayer.clearLayers();

      zones.forEach(row => {
        const z = normalizeZone(row);
        if(!z) return;
        if(z.type === 'arty'){
          const center = L.latLng(z.center[0], z.center[1]);
          [ {r:z.r3,c:'#eab308'}, {r:z.r2,c:'#f97316'}, {r:z.r1,c:'#ef4444'} ].forEach(x => {
            if(state.localZonesLayer) L.circle(center, { radius:x.r, color:x.c, weight:2, fillOpacity:0.06 }).addTo(state.localZonesLayer);
            if(state.playerZonesLayer) L.circle(center, { radius:x.r, color:x.c, weight:2, fillOpacity:0.03 }).addTo(state.playerZonesLayer);
          });
        } else {
          const color = z.type === 'mines' ? '#a855f7' : '#22d3ee';
          const bounds = L.latLngBounds(z.bounds);
          if(state.localZonesLayer) L.rectangle(bounds, { color:color, weight:2, dashArray:'6,6', fillOpacity:0.12 }).addTo(state.localZonesLayer);
          if(state.playerZonesLayer) L.rectangle(bounds, { color:color, weight:2, dashArray:'6,6', fillOpacity:0.08 }).addTo(state.playerZonesLayer);
        }
      });
    }catch(err){
      log('Zones FAIL: ' + readableError(err));
    }
  }

  async function renderEvents(){
    if(!state.sessionId) return;
    try{
      const events = await listEvents(state.sessionId);
      q('eventList').innerHTML = '';
      if(events.length === 0){ setMsg('eventMsg', 'No events yet.'); return; }
      events.forEach(ev => {
        const div = document.createElement('div');
        div.className = 'item';
        div.innerHTML =
          '<div class="rosterhead"><span>' + escapeHtml(ev.event_type || '') + '</span><span class="tag">' + escapeHtml(new Date(ev.created_at).toLocaleTimeString('fi-FI')) + '</span></div>' +
          '<div class="meta">' + escapeHtml(new Date(ev.created_at).toLocaleString('fi-FI')) + '</div>';
        q('eventList').appendChild(div);
      });
      setMsg('eventMsg', 'Latest events loaded.');
    }catch(err){
      setMsg('eventMsg', 'Event load failed: ' + readableError(err));
    }
  }

  function startTrainerLoops(){
    stopTrainerLoops();
    renderRoster(); renderZones(); renderEvents();
    state.rosterTimer = setInterval(renderRoster, 3000);
    state.zoneTimer = setInterval(renderZones, 4000);
    state.eventTimer = setInterval(renderEvents, 4000);
  }
  function stopTrainerLoops(){
    ['rosterTimer','zoneTimer','eventTimer'].forEach(k => { if(state[k]) clearInterval(state[k]); state[k] = null; });
  }

  function setPlayerStatusUi(status, cause){
    const el = q('playerStatus');
    el.className = 'status';
    if(status === 'OK') el.classList.add('ok');
    if(status === 'SUP') el.classList.add('sup');
    if(status === 'WIA') el.classList.add('wia');
    if(status === 'KIA') el.classList.add('kia');
    el.textContent = 'STATUS: ' + status;
    q('playerCause').textContent = 'CAUSE: ' + cause;
    q('playerBanner').textContent = status === 'OK' ? 'READY' : status;
  }

  async function setPlayerStatus(status, cause){
    setPlayerStatusUi(status, cause);
    if(!state.currentPlayerId) return;
    try{
      await updatePlayer(state.currentPlayerId, { status:status, cause:cause });
      setMsg('playerMsg', 'Player state updated.');
    }catch(err){
      setMsg('playerMsg', 'Player update failed: ' + readableError(err));
      log('Player update FAIL: ' + readableError(err));
    }
  }

  async function requestAlerts(){
    try{
      if(!('Notification' in window)){ setMsg('playerMsg', 'Notifications unsupported.'); return; }
      const res = await Notification.requestPermission();
      setMsg('playerMsg', 'Alerts: ' + res);
    }catch(err){
      setMsg('playerMsg', 'Alert permission failed.');
    }
  }

  function notify(title, body){
    try{
      if('Notification' in window && Notification.permission === 'granted'){
        new Notification(title, { body: body });
      }
      if(navigator.vibrate) navigator.vibrate([180,80,180]);
    }catch(err){}
  }

  function zoneContains(boundsArray, latlng){ return L.latLngBounds(boundsArray).contains(latlng); }
  function distanceToArty(centerArr, latlng){ return latlng.distanceTo(L.latLng(centerArr[0], centerArr[1])); }

  async function evaluatePlayerZones(latlng){
    if(!state.sessionId) return;
    try{
      const zones = await listZones(state.sessionId);
      let labels = [];
      let targetStatus = null;
      let targetCause = null;

      zones.forEach(row => {
        const z = normalizeZone(row);
        if(!z) return;
        if(z.type === 'mines' && zoneContains(z.bounds, latlng)) labels.push('MINES');
        if(z.type === 'cbrn' && zoneContains(z.bounds, latlng)){
          labels.push('CBRN');
          if(!targetStatus){ targetStatus = 'SUP'; targetCause = 'CBRN'; }
        }
        if(z.type === 'arty'){
          const d = distanceToArty(z.center, latlng);
          if(d <= z.r3){
            labels.push('ARTY');
            if(d <= z.r1){ targetStatus = 'KIA'; targetCause = 'ARTY'; }
            else if(d <= z.r2 && targetStatus !== 'KIA'){ targetStatus = 'WIA'; targetCause = 'ARTY'; }
            else if(!targetStatus){ targetStatus = 'SUP'; targetCause = 'ARTY'; }
          }
        }
      });

      q('zoneInfo').textContent = 'Zone: ' + (labels.length ? [...new Set(labels)].join(' + ') : 'NONE');
      const zoneKey = labels.sort().join('|') + '|' + (targetStatus || 'OK');
      if(state.zoneState.lastKey !== zoneKey){
        state.zoneState.lastKey = zoneKey;
        if(targetStatus){
          await setPlayerStatus(targetStatus, targetCause);
          notify('TULI7 ALERT', 'STATUS: ' + targetStatus + ' / ' + targetCause);
        }
      }
    }catch(err){
      log('Zone eval FAIL: ' + readableError(err));
    }
  }

  function startGps(){
    if(!navigator.geolocation){ q('gpsInfo').textContent = 'GPS unavailable'; return; }
    if(state.gpsWatchId){ q('gpsInfo').textContent = 'GPS already active'; return; }
    state.gpsWatchId = navigator.geolocation.watchPosition(async pos => {
      const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
      q('gpsInfo').textContent = 'GPS: ' + pos.coords.latitude.toFixed(5) + ', ' + pos.coords.longitude.toFixed(5) + ' ±' + Math.round(pos.coords.accuracy) + 'm';
      ensurePlayerMap();
      if(!state.meMarker){
        state.meMarker = L.circleMarker(latlng, { radius:8, color:'#fff', weight:2, fillColor:'#3b82f6', fillOpacity:1 }).addTo(state.playerMap);
        state.playerMap.setView(latlng, 14);
      } else {
        state.meMarker.setLatLng(latlng);
      }
      await renderZones();
      await evaluatePlayerZones(latlng);
    }, err => {
      q('gpsInfo').textContent = 'GPS denied';
    }, { enableHighAccuracy:true, maximumAge:3000, timeout:6000 });
    q('gpsToggleBtn').textContent = 'STOP GPS';
  }

  function stopGps(){
    if(state.gpsWatchId && navigator.geolocation) navigator.geolocation.clearWatch(state.gpsWatchId);
    state.gpsWatchId = null;
    q('gpsInfo').textContent = 'GPS inactive';
    q('gpsToggleBtn').textContent = 'START GPS';
  }

  function bindUi(){
    q('openCreateBtn').addEventListener('click', () => show('createScreen'));
    q('openJoinBtn').addEventListener('click', () => show('joinScreen'));
    q('createBackBtn').addEventListener('click', () => show('home'));
    q('joinBackBtn').addEventListener('click', () => show('home'));
    q('sideBackBtn').addEventListener('click', () => show('joinScreen'));
    q('createdHomeBtn').addEventListener('click', () => show('home'));
    q('trainerHomeBtn').addEventListener('click', () => show('home'));
    q('playerHomeBtn').addEventListener('click', () => show('home'));

    q('randomPinBtn').addEventListener('click', () => { q('createPin').value = randomPin6(); setMsg('createMsg', 'Arvottu 6-numeroinen PIN.'); });
    q('healthCheckBtn').addEventListener('click', async () => { try{ await healthCheck(); }catch(err){ log('Supabase check FAIL: ' + readableError(err)); } });
    q('clearDebugBtn').addEventListener('click', () => { state.debugLines = []; q('homeStatus').textContent = 'Debug cleared. Waiting next event.'; });

    q('createSessionBtn').addEventListener('click', async () => {
      const name = q('createName').value.trim().toUpperCase();
      const pin = q('createPin').value.trim();
      if(!name){ setMsg('createMsg', 'Anna session name.'); return; }
      if(!validPin6(pin)){ setMsg('createMsg', 'PIN pitää olla 6 numeroa.'); return; }
      setMsg('createMsg', 'Creating session...');
      try{
        const row = await createSession(name, pin);
        state.sessionId = row.id;
        state.sessionName = row.session_name || name;
        state.sessionPin = pin;
        setCreatedView(state.sessionName, state.sessionPin);
        await logEvent('session_created', { session_name: state.sessionName });
        setMsg('createMsg', 'Session created.');
        show('createdScreen');
      }catch(err){
        setMsg('createMsg', 'Create failed: ' + readableError(err));
        log('Create FAIL: ' + readableError(err));
      }
    });

    q('openTrainerBtn').addEventListener('click', () => show('trainerScreen'));

    q('joinContinueBtn').addEventListener('click', async () => {
      const name = q('joinName').value.trim().toUpperCase();
      const pin = q('joinPin').value.trim();
      if(!name || !pin){ setMsg('joinMsg', 'Anna session name ja PIN.'); return; }
      if(!validPin6(pin)){ setMsg('joinMsg', 'PIN pitää olla 6 numeroa.'); return; }
      setMsg('joinMsg', 'Joining session...');
      try{
        const row = await joinSession(name, pin);
        state.sessionId = row.id;
        state.sessionName = row.session_name || name;
        state.sessionPin = pin;
        q('playerSessionLine').textContent = 'Session: ' + state.sessionName;
        q('trainerSessionName').textContent = state.sessionName;
        q('trainerPin').textContent = pin;
        setMsg('joinMsg', 'Session OK.');
        show('sideScreen');
      }catch(err){
        setMsg('joinMsg', 'Join failed: ' + readableError(err));
        log('Join FAIL: ' + readableError(err));
      }
    });

    q('blueBtn').addEventListener('click', async () => {
      setMsg('sideMsg', 'Adding BLUE player...');
      try{
        const row = await addPlayer(state.sessionId, 'BLUE');
        state.currentPlayerId = row.id;
        state.currentPlayerCode = row.player_code;
        q('playerCode').textContent = row.player_code;
        setPlayerStatusUi('OK', 'NONE');
        await logEvent('player_joined', { player_code: row.player_code, side:'BLUE' });
        setMsg('playerMsg', 'Joined as ' + row.player_code);
        show('playerScreen');
      }catch(err){
        setMsg('sideMsg', 'BLUE join failed: ' + readableError(err));
        log('BLUE join FAIL: ' + readableError(err));
      }
    });

    q('redBtn').addEventListener('click', async () => {
      setMsg('sideMsg', 'Adding RED player...');
      try{
        const row = await addPlayer(state.sessionId, 'RED');
        state.currentPlayerId = row.id;
        state.currentPlayerCode = row.player_code;
        q('playerCode').textContent = row.player_code;
        setPlayerStatusUi('OK', 'NONE');
        await logEvent('player_joined', { player_code: row.player_code, side:'RED' });
        setMsg('playerMsg', 'Joined as ' + row.player_code);
        show('playerScreen');
      }catch(err){
        setMsg('sideMsg', 'RED join failed: ' + readableError(err));
        log('RED join FAIL: ' + readableError(err));
      }
    });

    q('playerSupBtn').addEventListener('click', () => setPlayerStatus('SUP', 'MANUAL'));
    q('playerWiaBtn').addEventListener('click', () => setPlayerStatus('WIA', 'MANUAL'));
    q('playerKiaBtn').addEventListener('click', () => setPlayerStatus('KIA', 'MANUAL'));
    q('playerResetBtn').addEventListener('click', () => setPlayerStatus('OK', 'NONE'));

    q('enableAlertsBtn').addEventListener('click', requestAlerts);
    q('gpsToggleBtn').addEventListener('click', () => state.gpsWatchId ? stopGps() : startGps());

    document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
    document.querySelectorAll('[data-weapon]').forEach(btn => btn.addEventListener('click', () => setWeapon(btn.dataset.weapon)));
    document.querySelectorAll('[data-delay]').forEach(btn => btn.addEventListener('click', () => setDelay(btn.dataset.delay)));

    q('drawConfirmBtn').addEventListener('click', confirmDraw);
    q('drawCancelBtn').addEventListener('click', cancelDraw);
    q('clearZonesBtn').addEventListener('click', () => {
      if(state.localZonesLayer) state.localZonesLayer.clearLayers();
      if(state.playerZonesLayer) state.playerZonesLayer.clearLayers();
      cancelDraw();
      setMsg('mapMsg', 'Local drawings cleared.');
    });
    q('trainerRefreshBtn').addEventListener('click', async () => { await renderRoster(); await renderZones(); await renderEvents(); });
    q('centerMapBtn').addEventListener('click', () => {
      if(!navigator.geolocation){ setMsg('mapMsg', 'Geolocation unavailable.'); return; }
      navigator.geolocation.getCurrentPosition(pos => {
        ensureTrainerMap();
        state.trainerMap.setView([pos.coords.latitude, pos.coords.longitude], 14);
      }, () => setMsg('mapMsg', 'Location denied.'));
    });
  }

  function boot(){
    try{
      bindUi();
      initSupabase();
      log('Boot OK');
    }catch(err){
      log('Boot FAIL: ' + readableError(err));
      q('homeStatus').textContent = 'Boot failed: ' + readableError(err);
    }
  }
  window.addEventListener('load', boot);
})();