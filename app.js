const SUPABASE_URL = "https://fczmfxhgrpdljgtvpihl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_g4QxKz3RxiCx_a3GgH75wg_XnduFosO";

(function () {
  "use strict";

  if (!window.supabase) {
    window.addEventListener("DOMContentLoaded", () => {
      alert("Supabase library missing. Add <script src=\"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2\"></script> before app.js");
    });
    return;
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const STORAGE_KEY = "tuli7_launch_state_v1";

  const state = {
    deviceId: getOrCreateDeviceId(),
    currentScreen: "home",
    sessionId: null,
    sessionName: "",
    sessionPin: "",
    role: null,
    side: null,
    playerId: null,
    playerCallsign: "",
    playerStatus: "OK",
    trainerChannel: null,
    playerChannel: null,
  };

  const q = (id) => document.getElementById(id);
  const qa = (selector) => Array.from(document.querySelectorAll(selector));

  function getOrCreateDeviceId() {
    const key = "tuli7_device_id";
    let id = localStorage.getItem(key);
    if (!id) {
      id = "dev_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now().toString(36);
      localStorage.setItem(key, id);
    }
    return id;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sessionId: state.sessionId,
      sessionName: state.sessionName,
      sessionPin: state.sessionPin,
      role: state.role,
      side: state.side,
      playerId: state.playerId,
      playerCallsign: state.playerCallsign,
      playerStatus: state.playerStatus,
    }));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state.sessionId = parsed.sessionId || null;
      state.sessionName = parsed.sessionName || "";
      state.sessionPin = parsed.sessionPin || "";
      state.role = parsed.role || null;
      state.side = parsed.side || null;
      state.playerId = parsed.playerId || null;
      state.playerCallsign = parsed.playerCallsign || "";
      state.playerStatus = parsed.playerStatus || "OK";
    } catch (err) {
      console.error("State load failed", err);
    }
  }

  function clearState() {
    state.sessionId = null;
    state.sessionName = "";
    state.sessionPin = "";
    state.role = null;
    state.side = null;
    state.playerId = null;
    state.playerCallsign = "";
    state.playerStatus = "OK";
    localStorage.removeItem(STORAGE_KEY);
  }

  function show(screenId) {
    qa(".screen").forEach((el) => el.classList.remove("active"));
    const screen = q(screenId);
    if (screen) screen.classList.add("active");
    state.currentScreen = screenId;
  }

  function setText(id, value) {
    const el = q(id);
    if (el) el.textContent = value;
  }

  function setJoinMessage(msg, isError = false) {
    const el = q("joinMsg");
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "#fca5a5" : "";
  }

  function setCreateMessage(msg, isError = false) {
    let el = q("createMsg");
    if (!el) {
      const card = document.querySelector("#createSessionScreen .card");
      if (!card) return;
      el = document.createElement("div");
      el.id = "createMsg";
      el.className = "muted";
      el.style.marginTop = "10px";
      card.appendChild(el);
    }
    el.textContent = msg;
    el.style.color = isError ? "#fca5a5" : "";
  }

  function normalizeSessionName(value) {
    return String(value || "").trim().toUpperCase();
  }

  function normalizePin(value) {
    return String(value || "").trim();
  }

  function sessionLabelsSync() {
    setText("createdSessionName", state.sessionName);
    setText("createdSessionPin", state.sessionPin);
    setText("trainerSessionName", state.sessionName);
    setText("trainerSessionPin", state.sessionPin);
    setText("trainerRoomTitle", `${state.sessionName} / TRAINER`);
    setText("playerSessionInfo", `Session: ${state.sessionName}`);
  }

  function updatePlayerView() {
    setText("playerId", state.playerCallsign || "PLAYER");
    setText("playerStatus", `STATUS: ${state.playerStatus}`);

    const statusEl = q("playerStatus");
    if (statusEl) {
      statusEl.classList.remove("ok", "sup", "wia", "kia");
      const cls = state.playerStatus.toLowerCase();
      if (["ok", "sup", "wia", "kia"].includes(cls)) statusEl.classList.add(cls);
    }

    const banner = q("playerBanner");
    if (banner) banner.textContent = state.playerStatus === "OK" ? "READY" : state.playerStatus;
  }

  function rosterStatusColor(status) {
    switch (status) {
      case "OK": return "#86efac";
      case "SUP": return "#fde68a";
      case "WIA": return "#fca5a5";
      case "KIA": return "#cbd5e1";
      default: return "#94a3b8";
    }
  }

  async function fetchRoster() {
    if (!state.sessionId) return [];

    const { data, error } = await supabase
      .from("tuli7_players")
      .select("id, side, callsign, status, player_number")
      .eq("session_id", state.sessionId)
      .order("side", { ascending: true })
      .order("player_number", { ascending: true });

    if (error) {
      console.error("Roster fetch failed", error);
      return [];
    }
    return data || [];
  }

  async function renderRoster() {
    const players = await fetchRoster();

    const blueCount = players.filter((p) => p.side === "BLUE").length;
    const redCount = players.filter((p) => p.side === "RED").length;

    setText("blueCountStat", `BLUE: ${blueCount}`);
    setText("redCountStat", `RED: ${redCount}`);
    setText("totalCountStat", `TOTAL: ${players.length}`);

    const rosterList = q("rosterList");
    if (!rosterList) return;

    if (!players.length) {
      rosterList.innerHTML = `<div class="muted">No players yet.</div>`;
      setText("rosterMoreLine", "");
      return;
    }

    rosterList.innerHTML = players.map((p) => {
      const dotColor = rosterStatusColor(p.status);
      return `
        <div class="roster-row">
          <div class="roster-left">
            <div class="roster-dot" style="background:${dotColor}"></div>
            <div>
              <div class="roster-name">${escapeHtml(p.callsign)}</div>
              <div class="roster-status">${escapeHtml(p.side)} / ${escapeHtml(p.status)}</div>
            </div>
          </div>
          <div class="roster-status">${escapeHtml(String(p.player_number))}</div>
        </div>
      `;
    }).join("");

    setText("rosterMoreLine", `${players.length} player(s) connected`);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function createSession() {
    const sessionName = normalizeSessionName(q("sessionNameInput")?.value);
    const pin = normalizePin(q("sessionPinInput")?.value);

    if (!sessionName) {
      setCreateMessage("Session name required.", true);
      return;
    }
    if (pin.length < 4) {
      setCreateMessage("PIN must be at least 4 digits.", true);
      return;
    }

    setCreateMessage("Creating session...");

    const { data, error } = await supabase.rpc("tuli7_create_session", {
      p_session_name: sessionName,
      p_pin: pin,
      p_trainer_device_id: state.deviceId,
    });

    if (error) {
      console.error(error);
      setCreateMessage(error.message || "Create failed.", true);
      return;
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row?.session_id) {
      setCreateMessage("Session creation failed.", true);
      return;
    }

    state.sessionId = row.session_id;
    state.sessionName = row.session_name;
    state.sessionPin = pin;
    state.role = "trainer";
    state.side = null;
    state.playerId = null;
    state.playerCallsign = "";
    state.playerStatus = "OK";
    saveState();

    sessionLabelsSync();
    show("sessionCreatedScreen");
  }

  async function verifySession() {
    const sessionName = normalizeSessionName(q("joinSessionNameInput")?.value);
    const pin = normalizePin(q("joinSessionPinInput")?.value);

    if (!sessionName || !pin) {
      setJoinMessage("Enter session name and PIN.", true);
      return;
    }

    setJoinMessage("Checking session...");

    const { data, error } = await supabase.rpc("tuli7_verify_session", {
      p_session_name: sessionName,
      p_pin: pin,
    });

    if (error) {
      console.error(error);
      setJoinMessage(error.message || "Session check failed.", true);
      return;
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row?.ok || !row?.session_id) {
      setJoinMessage("Session or PIN incorrect.", true);
      return;
    }

    state.sessionId = row.session_id;
    state.sessionName = sessionName;
    state.sessionPin = pin;
    state.role = "player";
    saveState();

    sessionLabelsSync();
    setJoinMessage("Session found.");
    show("sideScreen");
  }

  async function joinSession(side) {
    if (!state.sessionName || !state.sessionPin) {
      setJoinMessage("Missing session data.", true);
      show("joinSessionScreen");
      return;
    }

    const { data, error } = await supabase.rpc("tuli7_join_session", {
      p_session_name: state.sessionName,
      p_pin: state.sessionPin,
      p_side: side,
      p_device_id: state.deviceId,
    });

    if (error) {
      console.error(error);
      setJoinMessage(error.message || "Join failed.", true);
      show("joinSessionScreen");
      return;
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row?.player_id) {
      setJoinMessage("Join failed.", true);
      show("joinSessionScreen");
      return;
    }

    state.role = "player";
    state.side = row.side;
    state.playerId = row.player_id;
    state.playerCallsign = row.callsign;
    state.playerStatus = row.status || "OK";
    saveState();

    sessionLabelsSync();
    updatePlayerView();
    show("playerScreen");
    subscribePlayerRealtime();
  }

  async function setPlayerStatus(status) {
    if (!state.playerId) return;

    const { error } = await supabase
      .from("tuli7_players")
      .update({ status })
      .eq("id", state.playerId);

    if (error) {
      console.error("Status update failed", error);
      return;
    }

    state.playerStatus = status;
    saveState();
    updatePlayerView();
  }

  async function resetPlayerStatus() {
    await setPlayerStatus("OK");
  }

  async function endExercise() {
    if (!state.sessionId) return;
    if (!window.confirm("End exercise?")) return;

    const { error } = await supabase
      .from("tuli7_sessions")
      .update({ status: "ended" })
      .eq("id", state.sessionId);

    if (error) {
      console.error(error);
      alert("Could not end exercise.");
      return;
    }

    teardownRealtime();
    clearState();
    show("home");
  }

  async function resetSessionStatuses() {
    if (!state.sessionId) return;
    if (!window.confirm("Reset all player statuses to OK?")) return;

    const { error } = await supabase
      .from("tuli7_players")
      .update({ status: "OK" })
      .eq("session_id", state.sessionId);

    if (error) {
      console.error(error);
      alert("Reset failed.");
      return;
    }

    renderRoster();
  }

  function subscribeTrainerRealtime() {
    unsubscribeTrainerRealtime();
    if (!state.sessionId) return;

    state.trainerChannel = supabase
      .channel(`tuli7-trainer-${state.sessionId}`)
      .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "tuli7_players",
          filter: `session_id=eq.${state.sessionId}`,
        }, async () => {
          await renderRoster();
        })
      .on("postgres_changes", {
          event: "UPDATE",
          schema: "public",
          table: "tuli7_sessions",
          filter: `id=eq.${state.sessionId}`,
        }, (payload) => {
          if (payload.new?.status === "ended") {
            teardownRealtime();
            alert("Exercise ended.");
            clearState();
            show("home");
          }
        })
      .subscribe(async () => {
        await renderRoster();
      });
  }

  function subscribePlayerRealtime() {
    unsubscribePlayerRealtime();
    if (!state.playerId || !state.sessionId) return;

    state.playerChannel = supabase
      .channel(`tuli7-player-${state.playerId}`)
      .on("postgres_changes", {
          event: "UPDATE",
          schema: "public",
          table: "tuli7_players",
          filter: `id=eq.${state.playerId}`,
        }, (payload) => {
          const nextStatus = payload.new?.status || "OK";
          state.playerStatus = nextStatus;
          saveState();
          updatePlayerView();
        })
      .on("postgres_changes", {
          event: "UPDATE",
          schema: "public",
          table: "tuli7_sessions",
          filter: `id=eq.${state.sessionId}`,
        }, (payload) => {
          if (payload.new?.status === "ended") {
            teardownRealtime();
            alert("Exercise ended.");
            clearState();
            show("home");
          }
        })
      .subscribe();
  }

  function unsubscribeTrainerRealtime() {
    if (state.trainerChannel) {
      supabase.removeChannel(state.trainerChannel);
      state.trainerChannel = null;
    }
  }

  function unsubscribePlayerRealtime() {
    if (state.playerChannel) {
      supabase.removeChannel(state.playerChannel);
      state.playerChannel = null;
    }
  }

  function teardownRealtime() {
    unsubscribeTrainerRealtime();
    unsubscribePlayerRealtime();
  }

  function bindButton(id, handler) {
    const el = q(id);
    if (el) el.addEventListener("click", handler);
  }

  function bindUi() {
    bindButton("createFlowBtn", () => {
      setCreateMessage("");
      show("createSessionScreen");
    });

    bindButton("joinFlowBtn", () => {
      setJoinMessage("Enter session name and PIN.");
      show("joinSessionScreen");
    });

    bindButton("createBackBtn", () => show("home"));
    bindButton("joinBackBtn", () => show("home"));
    bindButton("sideBackBtn", () => show("joinSessionScreen"));

    bindButton("createSessionBtn", createSession);
    bindButton("joinContinueBtn", verifySession);
    bindButton("blueBtn", () => joinSession("BLUE"));
    bindButton("redBtn", () => joinSession("RED"));

    bindButton("createdBackHomeBtn", () => show("home"));

    bindButton("createdOpenTrainerBtn", async () => {
      sessionLabelsSync();
      show("trainerScreen");
      await renderRoster();
      subscribeTrainerRealtime();
    });

    bindButton("playerDoneBtn", () => {
      teardownRealtime();
      show("home");
    });

    bindButton("homeTrainerBtn", () => {
      teardownRealtime();
      show("home");
    });

    bindButton("supBtn", () => setPlayerStatus("SUP"));
    bindButton("wiaBtn", () => setPlayerStatus("WIA"));
    bindButton("kiaBtn", () => setPlayerStatus("KIA"));
    bindButton("resetPlayerBtn", resetPlayerStatus);
    bindButton("resetSessionBtn", resetSessionStatuses);
    bindButton("endExerciseBtn", endExercise);

    bindButton("rosterToggleBtn", () => {
      const panel = q("rosterPanel");
      const btn = q("rosterToggleBtn");
      if (!panel || !btn) return;
      const isOpen = panel.classList.toggle("show");
      btn.textContent = isOpen ? "▲ ROSTER" : "▼ ROSTER";
    });

    bindButton("testToggleBtn", () => {
      const panel = q("testPanel");
      const btn = q("testToggleBtn");
      if (!panel || !btn) return;
      const isOpen = panel.classList.toggle("show");
      btn.textContent = isOpen ? "▲ TEST ALERTS" : "▼ TEST ALERTS";
    });

    bindButton("enableAlertsBtn", async () => {
      if (!("Notification" in window)) {
        alert("Notifications not supported on this device/browser.");
        return;
      }
      const result = await Notification.requestPermission();
      const el = q("enableAlertsBtn");
      if (el) el.textContent = result === "granted" ? "ALERTS ENABLED" : "ALERTS BLOCKED";
    });
  }

  async function restoreSession() {
    loadState();

    if (!state.sessionId || !state.role) {
      show("home");
      return;
    }

    sessionLabelsSync();

    if (state.role === "trainer") {
      show("trainerScreen");
      await renderRoster();
      subscribeTrainerRealtime();
      return;
    }

    if (state.role === "player") {
      updatePlayerView();
      show("playerScreen");
      subscribePlayerRealtime();
      return;
    }

    show("home");
  }

  window.addEventListener("beforeunload", () => {
    teardownRealtime();
  });

  window.addEventListener("DOMContentLoaded", async () => {
    bindUi();
    await restoreSession();
  });
})();
