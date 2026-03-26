(() => {
  const SUPABASE_URL = "PASTE_YOUR_SUPABASE_URL_HERE";
  const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";

  const q = (id) => document.getElementById(id);
  const state = {
    supabase: null,
    sessionName: "",
    sessionPin: "",
    sessionId: null,
    trainerDeviceId: null,
    playerId: null,
    playerCallsign: "",
    playerSide: "",
    trainerPoll: null,
    playerPoll: null,
  };

  function ensureSupabase() {
    if (!window.supabase) throw new Error("Supabase library missing");
    if (SUPABASE_URL.includes("PASTE_YOUR") || SUPABASE_ANON_KEY.includes("PASTE_YOUR")) {
      throw new Error("Set SUPABASE_URL and SUPABASE_ANON_KEY in app.js before publishing.");
    }
    if (!state.supabase) {
      state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return state.supabase;
  }

  function show(screenId) {
    document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
    q(screenId).classList.add("active");
    if (screenId !== "trainerScreen") stopTrainerPolling();
    if (screenId !== "playerScreen") stopPlayerPolling();
  }

  function getDeviceId(role) {
    const key = `tuli7_${role}_device_id`;
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  }

  function setMessage(id, text, type = "") {
    const el = q(id);
    el.textContent = text || "";
    el.className = `message ${type}`.trim();
  }

  function sanitizeSessionName(value) {
    return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
  }

  function sanitizePin(value) {
    return value.trim().replace(/[^0-9]/g, "").slice(0, 8);
  }

  function syncSessionLabels() {
    q("createdSessionName").textContent = state.sessionName;
    q("createdSessionPin").textContent = state.sessionPin;
    q("trainerSessionName").textContent = state.sessionName;
    q("trainerSessionPin").textContent = state.sessionPin;
    q("trainerRoomTitle").textContent = `${state.sessionName} / TRAINER`;
    q("playerSessionInfo").textContent = `Session: ${state.sessionName}`;
  }

  function playerColor(status) {
    if (status === "OK") return "#86efac";
    if (status === "SUP") return "#fde68a";
    if (status === "WIA") return "#fca5a5";
    if (status === "KIA") return "#cbd5e1";
    return "#9ca3af";
  }

  function renderRoster(players) {
    const blue = players.filter((p) => p.side === "BLUE").length;
    const red = players.filter((p) => p.side === "RED").length;
    q("blueCountStat").textContent = `BLUE: ${blue}`;
    q("redCountStat").textContent = `RED: ${red}`;
    q("totalCountStat").textContent = `TOTAL: ${players.length}`;

    const list = q("rosterList");
    list.innerHTML = "";
    if (!players.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No players joined yet.";
      list.appendChild(empty);
      return;
    }

    players.forEach((p) => {
      const row = document.createElement("div");
      row.className = "roster-row";

      const left = document.createElement("div");
      left.className = "roster-left";

      const dot = document.createElement("div");
      dot.className = "roster-dot";
      dot.style.background = playerColor(p.status);

      const textWrap = document.createElement("div");
      textWrap.innerHTML = `<div class="roster-name">${p.callsign}</div><div class="roster-status">${p.side} · ${p.status}</div>`;

      const updated = document.createElement("div");
      updated.className = "roster-status";
      updated.textContent = new Date(p.updated_at).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

      left.appendChild(dot);
      left.appendChild(textWrap);
      row.appendChild(left);
      row.appendChild(updated);
      list.appendChild(row);
    });
  }

  function setPlayerStatusUI(status) {
    const el = q("playerStatus");
    el.className = "status";
    const map = { OK: "ok", SUP: "sup", WIA: "wia", KIA: "kia" };
    el.classList.add(map[status] || "ok");
    el.textContent = `STATUS: ${status}`;

    ["supBtn", "wiaBtn", "kiaBtn"].forEach((id) => q(id).classList.remove("active"));
    if (status === "SUP") q("supBtn").classList.add("active");
    if (status === "WIA") q("wiaBtn").classList.add("active");
    if (status === "KIA") q("kiaBtn").classList.add("active");
  }

  async function createSession() {
    try {
      ensureSupabase();
      setMessage("createMsg", "Creating session...");
      const name = sanitizeSessionName(q("sessionNameInput").value);
      const pin = sanitizePin(q("sessionPinInput").value);
      if (!name || !pin || pin.length < 4) {
        setMessage("createMsg", "Use session name and at least 4 digit PIN.", "error");
        return;
      }

      const trainerDeviceId = getDeviceId("trainer");
      const { data, error } = await state.supabase.rpc("tuli7_create_session", {
        p_session_name: name,
        p_pin: pin,
        p_trainer_device_id: trainerDeviceId,
      });
      if (error) throw error;

      const created = Array.isArray(data) ? data[0] : data;
      state.sessionName = created.session_name;
      state.sessionPin = pin;
      state.sessionId = created.session_id;
      state.trainerDeviceId = trainerDeviceId;
      syncSessionLabels();
      setMessage("createMsg", "Session created.", "success");
      show("sessionCreatedScreen");
    } catch (err) {
      setMessage("createMsg", err.message || "Failed to create session.", "error");
    }
  }

  async function verifyJoin() {
    try {
      ensureSupabase();
      setMessage("joinMsg", "Checking session...");
      const name = sanitizeSessionName(q("joinSessionNameInput").value);
      const pin = sanitizePin(q("joinSessionPinInput").value);
      if (!name || !pin) {
        setMessage("joinMsg", "Enter session name and PIN.", "error");
        return;
      }

      const { data, error } = await state.supabase.rpc("tuli7_verify_session", {
        p_session_name: name,
        p_pin: pin,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.ok) throw new Error("Session not found or PIN incorrect.");

      state.sessionName = name;
      state.sessionPin = pin;
      state.sessionId = row.session_id;
      syncSessionLabels();
      setMessage("joinMsg", "Session OK.", "success");
      show("sideScreen");
    } catch (err) {
      setMessage("joinMsg", err.message || "Join failed.", "error");
    }
  }

  async function joinSide(side) {
    try {
      ensureSupabase();
      setMessage("sideMsg", `Joining ${side}...`);
      const deviceId = getDeviceId("player");
      const { data, error } = await state.supabase.rpc("tuli7_join_session", {
        p_session_name: state.sessionName,
        p_pin: state.sessionPin,
        p_side: side,
        p_device_id: deviceId,
      });
      if (error) throw error;

      const joined = Array.isArray(data) ? data[0] : data;
      state.playerId = joined.player_id;
      state.playerCallsign = joined.callsign;
      state.playerSide = joined.side;
      q("playerId").textContent = joined.callsign;
      q("playerBanner").textContent = "READY";
      setPlayerStatusUI(joined.status || "OK");
      setMessage("playerMsg", "Connected.", "success");
      show("playerScreen");
      startPlayerPolling();
    } catch (err) {
      setMessage("sideMsg", err.message || "Failed to join side.", "error");
    }
  }

  async function loadTrainerRoster() {
    if (!state.sessionId) return;
    const { data, error } = await state.supabase
      .from("tuli7_players")
      .select("id,callsign,side,status,updated_at")
      .eq("session_id", state.sessionId)
      .order("callsign", { ascending: true });
    if (error) throw error;
    renderRoster(data || []);
  }

  function startTrainerPolling() {
    stopTrainerPolling();
    loadTrainerRoster().catch((err) => setMessage("trainerMsg", err.message || "Roster refresh failed.", "error"));
    state.trainerPoll = setInterval(() => {
      loadTrainerRoster().catch(() => {});
    }, 3000);
  }

  function stopTrainerPolling() {
    if (state.trainerPoll) clearInterval(state.trainerPoll);
    state.trainerPoll = null;
  }

  async function refreshPlayer() {
    if (!state.playerId) return;
    const { data, error } = await state.supabase
      .from("tuli7_players")
      .select("id,callsign,side,status,updated_at")
      .eq("id", state.playerId)
      .single();
    if (error) throw error;
    q("playerId").textContent = data.callsign;
    setPlayerStatusUI(data.status);
    q("playerRoleInfo").textContent = `${data.side} · synced ${new Date(data.updated_at).toLocaleTimeString("fi-FI")}`;
  }

  function startPlayerPolling() {
    stopPlayerPolling();
    refreshPlayer().catch((err) => setMessage("playerMsg", err.message || "Player refresh failed.", "error"));
    state.playerPoll = setInterval(() => {
      refreshPlayer().catch(() => {});
    }, 4000);
  }

  function stopPlayerPolling() {
    if (state.playerPoll) clearInterval(state.playerPoll);
    state.playerPoll = null;
  }

  async function updatePlayerStatus(status) {
    try {
      ensureSupabase();
      const { error } = await state.supabase
        .from("tuli7_players")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", state.playerId);
      if (error) throw error;
      q("playerBanner").textContent = status === "OK" ? "READY" : status;
      setPlayerStatusUI(status);
      setMessage("playerMsg", `Status updated to ${status}.`, "success");
    } catch (err) {
      setMessage("playerMsg", err.message || "Status update failed.", "error");
    }
  }

  async function endSession() {
    try {
      ensureSupabase();
      if (!state.sessionId) return;
      const { error } = await state.supabase
        .from("tuli7_sessions")
        .update({ status: "ended", updated_at: new Date().toISOString() })
        .eq("id", state.sessionId);
      if (error) throw error;
      setMessage("trainerMsg", "Session ended.", "success");
      stopTrainerPolling();
      show("home");
    } catch (err) {
      setMessage("trainerMsg", err.message || "Failed to end session.", "error");
    }
  }

  function openTrainer() {
    syncSessionLabels();
    show("trainerScreen");
    startTrainerPolling();
  }

  function bind() {
    q("createFlowBtn").addEventListener("click", () => show("createSessionScreen"));
    q("joinFlowBtn").addEventListener("click", () => show("joinSessionScreen"));
    q("createBackBtn").addEventListener("click", () => show("home"));
    q("joinBackBtn").addEventListener("click", () => show("home"));
    q("sideBackBtn").addEventListener("click", () => show("joinSessionScreen"));
    q("createdBackHomeBtn").addEventListener("click", () => show("home"));
    q("createdOpenTrainerBtn").addEventListener("click", openTrainer);
    q("homeTrainerBtn").addEventListener("click", () => show("home"));
    q("playerDoneBtn").addEventListener("click", () => show("home"));

    q("createSessionBtn").addEventListener("click", createSession);
    q("joinContinueBtn").addEventListener("click", verifyJoin);
    q("blueBtn").addEventListener("click", () => joinSide("BLUE"));
    q("redBtn").addEventListener("click", () => joinSide("RED"));

    q("supBtn").addEventListener("click", () => updatePlayerStatus("SUP"));
    q("wiaBtn").addEventListener("click", () => updatePlayerStatus("WIA"));
    q("kiaBtn").addEventListener("click", () => updatePlayerStatus("KIA"));
    q("resetPlayerBtn").addEventListener("click", () => updatePlayerStatus("OK"));
    q("refreshPlayerBtn").addEventListener("click", () => refreshPlayer().catch((err) => setMessage("playerMsg", err.message || "Refresh failed.", "error")));
    q("refreshTrainerBtn").addEventListener("click", () => loadTrainerRoster().then(() => setMessage("trainerMsg", "Roster refreshed.", "success")).catch((err) => setMessage("trainerMsg", err.message || "Refresh failed.", "error")));
    q("endSessionBtn").addEventListener("click", endSession);
  }

  bind();
})();
