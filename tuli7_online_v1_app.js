(function(){
  const SUPABASE_URL = 'https://fczmfxhgrpdljgtvpihl.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_g4QxKz3RxiCx_a3GgH75wg_XnduFosO';
  const state = { supabase:null, sessionId:null, sessionName:'', sessionPin:'', joinedSessionName:'', currentPlayerId:null, currentPlayerCode:'', rosterTimer:null, debugLines:[] };

  function q(id){ return document.getElementById(id); }
  function show(id){ document.querySelectorAll('.screen').forEach(el => el.classList.remove('active')); q(id).classList.add('active'); if(id === 'trainerScreen') startRosterPolling(); else stopRosterPolling(); }
  function setMsg(id, text){ q(id).textContent = text || ''; }
  function readableError(err){ if(!err) return 'Unknown error'; if(typeof err === 'string') return err; return err.message || err.error_description || JSON.stringify(err); }
  function debug(text){ const line = '[' + new Date().toLocaleTimeString('fi-FI') + '] ' + text; state.debugLines.unshift(line); state.debugLines = state.debugLines.slice(0, 12); q('homeStatus').textContent = state.debugLines.join('\n'); console.log(line); }
  function randomPin6(){ return String(Math.floor(100000 + Math.random() * 900000)); }
  function validPin6(pin){ return /^\d{6}$/.test(pin); }

  function initSupabase(){
    if(!window.supabase || !window.supabase.createClient) throw new Error('Supabase CDN not loaded');
    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    debug('Supabase client initialized');
  }

  async function healthCheck(){
    const { error } = await state.supabase.from('sessions').select('id', { count:'exact', head:true });
    if(error) throw error;
    debug('Supabase check OK');
  }

  async function createSession(sessionName, pin){
    debug('Create start for ' + sessionName);
    const { data, error } = await state.supabase.rpc('create_session_rpc', { p_session_name: sessionName.toUpperCase(), p_pin: pin });
    if(error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if(!row || !row.id) throw new Error('RPC returned no row');
    debug('Create OK, session id ' + row.id);
    return row;
  }

  async function joinSession(sessionName, pin){
    debug('Join start for ' + sessionName);
    const { data, error } = await state.supabase.rpc('join_session_rpc', { p_session_name: sessionName.toUpperCase(), p_pin: pin });
    if(error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if(!row || !row.id) throw new Error('Session not found or wrong PIN');
    debug('Join OK, session id ' + row.id);
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
    const { data, error } = await state.supabase.from('players').insert([{ session_id: sessionId, player_code: code, side, status: 'OK', cause: 'NONE' }]).select().single();
    if(error) throw error;
    debug('Player added ' + code);
    return data;
  }

  async function updatePlayer(playerId, patch){
    const { error } = await state.supabase.from('players').update({ ...patch, last_seen: new Date().toISOString() }).eq('id', playerId);
    if(error) throw error;
  }

  function setCreatedView(name, pin){
    q('createdName').textContent = name;
    q('createdPin').textContent = pin;
    q('trainerSessionName').textContent = name;
    q('trainerPin').textContent = pin;
    q('playerSessionLine').textContent = 'Session: ' + name;
  }

  function escapeHtml(str){
    return String(str).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'", '&#39;');
  }

  async function renderTrainer(){
    if(!state.sessionId){
      setMsg('trainerMsg', 'No active trainer session.');
      q('rosterList').innerHTML = '';
      q('blueCountBtn').textContent = 'BLUE: 0';
      q('redCountBtn').textContent = 'RED: 0';
      q('totalCountBtn').textContent = 'TOTAL: 0';
      return;
    }
    try{
      const players = await listPlayers(state.sessionId);
      const list = q('rosterList');
      list.innerHTML = '';
      const blue = players.filter(p => p.side === 'BLUE').length;
      const red = players.filter(p => p.side === 'RED').length;
      q('blueCountBtn').textContent = 'BLUE: ' + blue;
      q('redCountBtn').textContent = 'RED: ' + red;
      q('totalCountBtn').textContent = 'TOTAL: ' + players.length;
      if(players.length === 0){ setMsg('trainerMsg', 'Ei pelaajia vielä.'); return; }
      players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'item';
        div.innerHTML = '<strong>' + escapeHtml(p.player_code || '') + '</strong><br>Side: ' + escapeHtml(p.side || '') + '<br>Status: ' + escapeHtml(p.status || '') + '<br>Cause: ' + escapeHtml(p.cause || '');
        list.appendChild(div);
      });
      setMsg('trainerMsg', 'Roster updated from Supabase.');
    }catch(err){
      setMsg('trainerMsg', 'Roster failed: ' + readableError(err));
      debug('Roster FAIL: ' + readableError(err));
    }
  }

  function startRosterPolling(){ stopRosterPolling(); renderTrainer(); state.rosterTimer = setInterval(renderTrainer, 3000); }
  function stopRosterPolling(){ if(state.rosterTimer){ clearInterval(state.rosterTimer); state.rosterTimer = null; } }

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
      await updatePlayer(state.currentPlayerId, { status, cause });
      setMsg('playerMsg', 'Player state updated.');
    }catch(err){
      setMsg('playerMsg', 'Player update failed: ' + readableError(err));
      debug('Player update FAIL: ' + readableError(err));
    }
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
    q('healthCheckBtn').addEventListener('click', async () => { try{ await healthCheck(); }catch(err){ debug('Supabase check FAIL: ' + readableError(err)); } });
    q('clearDebugBtn').addEventListener('click', () => { state.debugLines = []; q('homeStatus').textContent = 'Debug cleared.'; });

    q('createSessionBtn').addEventListener('click', async () => {
      const name = q('createName').value.trim().toUpperCase();
      const pin = q('createPin').value.trim();
      if(!name){ setMsg('createMsg', 'Anna session name.'); return; }
      if(!validPin6(pin)){ setMsg('createMsg', 'PIN pitää olla 6 numeroa.'); return; }
      setMsg('createMsg', 'Creating...');
      try{
        const row = await createSession(name, pin);
        state.sessionId = row.id;
        state.sessionName = row.session_name || name;
        state.sessionPin = pin;
        setCreatedView(state.sessionName, state.sessionPin);
        setMsg('createMsg', 'Session created.');
        show('createdScreen');
      }catch(err){
        setMsg('createMsg', 'Create failed: ' + readableError(err));
        debug('Create FAIL: ' + readableError(err));
      }
    });

    q('openTrainerBtn').addEventListener('click', () => show('trainerScreen'));

    q('joinContinueBtn').addEventListener('click', async () => {
      const name = q('joinName').value.trim().toUpperCase();
      const pin = q('joinPin').value.trim();
      if(!name || !pin){ setMsg('joinMsg', 'Anna session name ja PIN.'); return; }
      if(!validPin6(pin)){ setMsg('joinMsg', 'PIN pitää olla 6 numeroa.'); return; }
      setMsg('joinMsg', 'Joining...');
      try{
        const row = await joinSession(name, pin);
        state.sessionId = row.id;
        state.joinedSessionName = row.session_name || name;
        state.sessionName = row.session_name || name;
        state.sessionPin = pin;
        q('playerSessionLine').textContent = 'Session: ' + state.joinedSessionName;
        q('trainerSessionName').textContent = state.joinedSessionName;
        q('trainerPin').textContent = pin;
        setMsg('joinMsg', 'Session OK.');
        show('sideScreen');
      }catch(err){
        setMsg('joinMsg', 'Join failed: ' + readableError(err));
        debug('Join FAIL: ' + readableError(err));
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
        setMsg('playerMsg', 'Joined as ' + row.player_code);
        show('playerScreen');
      }catch(err){
        setMsg('sideMsg', 'BLUE join failed: ' + readableError(err));
        debug('BLUE join FAIL: ' + readableError(err));
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
        setMsg('playerMsg', 'Joined as ' + row.player_code);
        show('playerScreen');
      }catch(err){
        setMsg('sideMsg', 'RED join failed: ' + readableError(err));
        debug('RED join FAIL: ' + readableError(err));
      }
    });

    q('playerSupBtn').addEventListener('click', () => setPlayerStatus('SUP', 'MANUAL'));
    q('playerWiaBtn').addEventListener('click', () => setPlayerStatus('WIA', 'MANUAL'));
    q('playerKiaBtn').addEventListener('click', () => setPlayerStatus('KIA', 'MANUAL'));
    q('playerResetBtn').addEventListener('click', () => setPlayerStatus('OK', 'NONE'));
    q('trainerRefreshBtn').addEventListener('click', renderTrainer);
  }

  function boot(){
    try{
      bindUi();
      initSupabase();
      debug('Boot OK');
    }catch(err){
      debug('Boot FAIL: ' + readableError(err));
      setMsg('homeStatus', 'Boot failed: ' + readableError(err));
    }
  }

  window.addEventListener('load', boot);
})();