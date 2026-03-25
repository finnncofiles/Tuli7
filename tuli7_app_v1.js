(function (global) {
  'use strict';

  const APP_VERSION = 'v1 clean rebuild';
  const SUPABASE_URL = 'https://fczmfxhgrpdljgtvpihl.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_g4QxKz3RxiCx_a3GgH75wg_XnduFosO';

  function text(value) {
    return String(value == null ? '' : value);
  }

  function normalizeSessionName(name) {
    return text(name).trim().toUpperCase();
  }

  function validateSessionName(name) {
    const clean = normalizeSessionName(name);
    if (!clean) return 'Session name is required';
    if (clean.length < 3) return 'Session name must be at least 3 characters';
    if (!/^[A-Z0-9_-]+$/.test(clean)) return 'Use only A-Z, 0-9, hyphen or underscore';
    return '';
  }

  function validatePin(pin) {
    if (!/^\d{6}$/.test(text(pin).trim())) return 'PIN must be 6 digits';
    return '';
  }

  function randomPin6() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function createSupabaseAdapter(client) {
    return {
      async createSession(sessionName, pin) {
        const { data, error } = await client.rpc('create_session_rpc', {
          p_session_name: normalizeSessionName(sessionName),
          p_pin: text(pin).trim()
        });
        if (error) throw error;
        return Array.isArray(data) ? data[0] : data;
      },
      async joinSession(sessionName, pin) {
        const { data, error } = await client.rpc('join_session_rpc', {
          p_session_name: normalizeSessionName(sessionName),
          p_pin: text(pin).trim()
        });
        if (error) throw error;
        return Array.isArray(data) ? data[0] : data;
      },
      async listPlayers(sessionId) {
        const { data, error } = await client
          .from('players')
          .select('*')
          .eq('session_id', sessionId)
          .order('joined_at', { ascending: true });
        if (error) throw error;
        return data || [];
      },
      async addPlayer(sessionId, playerCode, side) {
        const { data, error } = await client
          .from('players')
          .insert([{
            session_id: sessionId,
            player_code: playerCode,
            side: side,
            status: 'OK',
            cause: 'NONE'
          }])
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    };
  }

  function safeErrorMessage(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    return JSON.stringify(error);
  }

  function createAppController(adapter) {
    const state = {
      sessionId: '',
      sessionName: '',
      sessionPin: '',
      role: '',
      players: [],
      playerCode: '',
      playerDbId: ''
    };

    return {
      state,
      async createSession(sessionName, pin) {
        const nameError = validateSessionName(sessionName);
        if (nameError) throw new Error(nameError);
        const pinError = validatePin(pin);
        if (pinError) throw new Error(pinError);

        const cleanName = normalizeSessionName(sessionName);
        const cleanPin = text(pin).trim();

        const row = await adapter.createSession(cleanName, cleanPin);
        if (!row || !row.id) throw new Error('Create session returned no session id');

        state.sessionId = row.id;
        state.sessionName = cleanName;
        state.sessionPin = cleanPin;
        state.role = 'trainer';
        state.playerCode = '';
        state.playerDbId = '';
        state.players = [];
        return row;
      },
      async joinSession(sessionName, pin) {
        const nameError = validateSessionName(sessionName);
        if (nameError) throw new Error(nameError);
        const pinError = validatePin(pin);
        if (pinError) throw new Error(pinError);

        const cleanName = normalizeSessionName(sessionName);
        const cleanPin = text(pin).trim();

        const row = await adapter.joinSession(cleanName, cleanPin);
        if (!row || !row.id) throw new Error('Session not found');

        state.sessionId = row.id;
        state.sessionName = cleanName;
        state.sessionPin = cleanPin;
        state.role = 'player';
        state.playerCode = '';
        state.playerDbId = '';
        state.players = [];
        return row;
      },
      async fetchPlayers() {
        if (!state.sessionId) throw new Error('No active session');
        const players = await adapter.listPlayers(state.sessionId);
        state.players = players;
        return players;
      },
      async addPlayerToSide(side) {
        if (!state.sessionId) throw new Error('No active session');
        if (side !== 'BLUE' && side !== 'RED') throw new Error('Invalid side');

        const players = await adapter.listPlayers(state.sessionId);
        const nextNumber = players.filter(function (player) {
          return player.side === side;
        }).length + 1;

        const code = side + ' ' + nextNumber;
        const row = await adapter.addPlayer(state.sessionId, code, side);
        if (!row || !row.id) throw new Error('Player insert failed');

        state.playerCode = code;
        state.playerDbId = row.id;
        state.players = await adapter.listPlayers(state.sessionId);
        return row;
      }
    };
  }

  function startBrowserApp() {
    const supabaseFactory = global.supabase && global.supabase.createClient;
    if (!supabaseFactory) {
      const target = document.getElementById('bootMessage');
      if (target) target.textContent = 'Supabase library failed to load';
      return;
    }

    const client = supabaseFactory(SUPABASE_URL, SUPABASE_KEY);
    const adapter = createSupabaseAdapter(client);
    const controller = createAppController(adapter);

    const state = controller.state;
    let rosterTimer = null;

    function $(id) {
      return document.getElementById(id);
    }

    const screens = Array.prototype.slice.call(document.querySelectorAll('.screen'));

    function show(screenId) {
      screens.forEach(function (screen) {
        screen.classList.toggle('active', screen.id === screenId);
      });
      if (screenId === 'trainerScreen') {
        startRosterPolling();
      } else {
        stopRosterPolling();
      }
    }

    function setMessage(id, message, isError) {
      const node = $(id);
      if (!node) return;
      node.textContent = message || '';
      node.classList.toggle('error', !!isError);
      node.classList.toggle('ok', !!message && !isError);
    }

    function syncLabels() {
      $('createdSessionName').textContent = state.sessionName || '-';
      $('createdSessionPin').textContent = state.sessionPin || '------';
      $('trainerSessionName').textContent = state.sessionName || '-';
      $('trainerSessionPin').textContent = state.sessionPin || '------';
      $('trainerTitle').textContent = state.sessionName ? state.sessionName + ' / TRAINER' : 'TRAINER';
      $('playerSessionInfo').textContent = state.sessionName ? 'Session: ' + state.sessionName : 'Session: -';
      $('playerCode').textContent = state.playerCode || '-';
    }

    function renderRoster(players) {
      const list = $('rosterList');
      const empty = $('rosterEmpty');
      list.innerHTML = '';

      if (!players || !players.length) {
        empty.style.display = 'block';
        $('rosterBlue').textContent = 'BLUE: 0';
        $('rosterRed').textContent = 'RED: 0';
        $('rosterTotal').textContent = 'TOTAL: 0';
        return;
      }

      empty.style.display = 'none';
      const blue = players.filter(function (player) { return player.side === 'BLUE'; }).length;
      const red = players.filter(function (player) { return player.side === 'RED'; }).length;
      $('rosterBlue').textContent = 'BLUE: ' + blue;
      $('rosterRed').textContent = 'RED: ' + red;
      $('rosterTotal').textContent = 'TOTAL: ' + players.length;

      players.forEach(function (player) {
        const row = document.createElement('div');
        row.className = 'roster-row';

        const left = document.createElement('div');
        left.innerHTML = '<strong>' + text(player.player_code) + '</strong><div class="muted-line">' + text(player.side) + ' · ' + text(player.status || 'OK') + '</div>';

        const right = document.createElement('div');
        right.className = 'badge ' + (player.side === 'BLUE' ? 'badge-blue' : 'badge-red');
        right.textContent = player.side;

        row.appendChild(left);
        row.appendChild(right);
        list.appendChild(row);
      });
    }

    async function refreshRoster() {
      try {
        const players = await controller.fetchPlayers();
        renderRoster(players);
        setMessage('trainerMsg', 'Roster updated', false);
      } catch (error) {
        setMessage('trainerMsg', safeErrorMessage(error), true);
      }
    }

    function startRosterPolling() {
      if (rosterTimer) return;
      refreshRoster();
      rosterTimer = global.setInterval(refreshRoster, 3000);
    }

    function stopRosterPolling() {
      if (!rosterTimer) return;
      global.clearInterval(rosterTimer);
      rosterTimer = null;
    }

    function resetJoinFlowMessages() {
      setMessage('createMsg', '', false);
      setMessage('joinMsg', '', false);
      setMessage('sideMsg', '', false);
      setMessage('playerMsg', '', false);
      setMessage('trainerMsg', '', false);
    }

    $('bootMessage').textContent = 'App ready · ' + APP_VERSION;

    $('goCreateBtn').addEventListener('click', function () {
      resetJoinFlowMessages();
      show('createScreen');
    });

    $('goJoinBtn').addEventListener('click', function () {
      resetJoinFlowMessages();
      show('joinScreen');
    });

    $('createBackBtn').addEventListener('click', function () {
      show('homeScreen');
    });

    $('joinBackBtn').addEventListener('click', function () {
      show('homeScreen');
    });

    $('randomPinBtn').addEventListener('click', function () {
      $('createPinInput').value = randomPin6();
    });

    $('createSessionBtn').addEventListener('click', async function () {
      const name = $('createNameInput').value;
      const pin = $('createPinInput').value;
      setMessage('createMsg', 'Creating session...', false);
      try {
        await controller.createSession(name, pin);
        syncLabels();
        setMessage('createMsg', 'Session created', false);
        show('createdScreen');
      } catch (error) {
        setMessage('createMsg', safeErrorMessage(error), true);
      }
    });

    $('createdHomeBtn').addEventListener('click', function () {
      show('homeScreen');
    });

    $('openTrainerBtn').addEventListener('click', function () {
      syncLabels();
      show('trainerScreen');
    });

    $('joinSessionBtn').addEventListener('click', async function () {
      const name = $('joinNameInput').value;
      const pin = $('joinPinInput').value;
      setMessage('joinMsg', 'Joining session...', false);
      try {
        await controller.joinSession(name, pin);
        syncLabels();
        setMessage('joinMsg', 'Session found', false);
        show('sideScreen');
      } catch (error) {
        setMessage('joinMsg', safeErrorMessage(error), true);
      }
    });

    $('sideBackBtn').addEventListener('click', function () {
      show('joinScreen');
    });

    function bindSideButton(buttonId, side) {
      $(buttonId).addEventListener('click', async function () {
        setMessage('sideMsg', 'Adding player...', false);
        try {
          await controller.addPlayerToSide(side);
          syncLabels();
          setMessage('playerMsg', 'Player joined successfully', false);
          show('playerScreen');
        } catch (error) {
          setMessage('sideMsg', safeErrorMessage(error), true);
        }
      });
    }

    bindSideButton('joinBlueBtn', 'BLUE');
    bindSideButton('joinRedBtn', 'RED');

    $('playerHomeBtn').addEventListener('click', function () {
      show('homeScreen');
    });

    $('trainerRefreshBtn').addEventListener('click', refreshRoster);
    $('trainerHomeBtn').addEventListener('click', function () {
      show('homeScreen');
    });

    syncLabels();
    renderRoster([]);
    show('homeScreen');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      APP_VERSION,
      normalizeSessionName,
      validateSessionName,
      validatePin,
      randomPin6,
      createAppController,
      createSupabaseAdapter,
      safeErrorMessage
    };
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', startBrowserApp);
  }
})(typeof window !== 'undefined' ? window : globalThis);
