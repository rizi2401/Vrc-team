const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const HOST = "0.0.0.0";
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const STORE_PATH = process.env.STORE_PATH ? path.resolve(process.env.STORE_PATH) : path.join(ROOT, "data", "store.json");
const DATA_DIR = path.dirname(STORE_PATH);

const staticFiles = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/styles.css": "styles.css"
};

const sessionStore = new Map();
const streamClients = new Set();

ensureDataStore();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (staticFiles[url.pathname]) {
      serveStatic(res, staticFiles[url.pathname]);
      return;
    }

    sendJson(res, 404, { error: "Nicht gefunden." });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Serverfehler." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server laeuft auf http://${HOST}:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/stream") {
    const auth = requireAuth(req);
    if (!auth) {
      sendJson(res, 401, { error: "Nicht angemeldet." });
      return;
    }

    openEventStream(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(req);
    const store = readStore();
    const username = normalizeUsername(body.username);
    const user = store.users.find((entry) => entry.username === username);

    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      sendJson(res, 401, { error: "Benutzername oder Passwort ist falsch." });
      return;
    }

    const sessionId = createSession(user.id);
    sendPortalData(res, 200, user, store, { "Set-Cookie": createSessionCookie(sessionId) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const body = await readJson(req);
    const store = readStore();
    const normalized = validateRegistrationPayload(body, store);
    const nextStore = structuredClone(store);

    const user = {
      id: crypto.randomUUID(),
      username: normalized.username,
      displayName: normalized.displayName,
      role: "viewer",
      vrchatName: normalized.vrchatName,
      discordName: normalized.discordName,
      passwordHash: hashPassword(normalized.password)
    };

    nextStore.users.push(user);
    const savedStore = writeStore(nextStore);
    const sessionId = createSession(user.id);
    sendPortalData(res, 201, user, savedStore, { "Set-Cookie": createSessionCookie(sessionId) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const sessionId = getSessionId(req);
    if (sessionId) sessionStore.delete(sessionId);
    sendJson(res, 200, { ok: true }, { "Set-Cookie": createSessionCookie("", true) });
    return;
  }

  const auth = requireAuth(req);
  if (!auth) {
    sendJson(res, 401, { error: "Nicht angemeldet." });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    sendPortalData(res, 200, auth.user, auth.store);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/reset-demo") {
    requireRole(auth.user, "admin");
    const sessionId = getSessionId(req);
    const nextStore = buildDefaultStore();
    const adminUser = nextStore.users.find((entry) => entry.username === "admin");

    writeStore(nextStore);
    if (sessionId && adminUser) {
      sessionStore.set(sessionId, { userId: adminUser.id, createdAt: Date.now() });
    }

    sendPortalData(res, 200, adminUser, nextStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/shifts") {
    requireRole(auth.user, "planner");
    const body = await readJson(req);
    const shift = validateShiftPayload(body, auth.store);
    const nextStore = structuredClone(auth.store);

    nextStore.shifts.unshift({
      id: crypto.randomUUID(),
      ...shift
    });

    const savedStore = writeStore(nextStore);
    void notifyDiscord(buildShiftDiscordMessage("created", savedStore.shifts[0], savedStore));
    broadcastEvent("portal", { type: "shift-created" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  const shiftMatch = url.pathname.match(/^\/api\/shifts\/([^/]+)$/);
  if (shiftMatch) {
    requireRole(auth.user, "planner");
    const shiftId = decodeURIComponent(shiftMatch[1]);
    const nextStore = structuredClone(auth.store);
    const shift = nextStore.shifts.find((entry) => entry.id === shiftId);

    if (!shift) {
      sendJson(res, 404, { error: "Schicht nicht gefunden." });
      return;
    }

    if (req.method === "PATCH") {
      const body = await readJson(req);
      const normalized = validateShiftPayload(body, auth.store);
      const previousShift = { ...shift };
      const memberChanged = shift.memberId !== normalized.memberId;

      shift.date = normalized.date;
      shift.memberId = normalized.memberId;
      shift.shiftType = normalized.shiftType;
      shift.world = normalized.world;
      shift.task = normalized.task;
      shift.notes = normalized.notes;

      if (memberChanged) {
        nextStore.timeEntries = nextStore.timeEntries.filter((entry) => entry.shiftId !== shiftId);
      }

      const savedStore = writeStore(nextStore);
      void notifyDiscord(buildShiftDiscordMessage("updated", shift, savedStore, previousShift));
      broadcastEvent("portal", { type: "shift-updated" });
      sendPortalData(res, 200, auth.user, savedStore);
      return;
    }

    if (req.method === "DELETE") {
      const deletedShift = { ...shift };
      nextStore.shifts = nextStore.shifts.filter((entry) => entry.id !== shiftId);
      nextStore.timeEntries = nextStore.timeEntries.filter((entry) => entry.shiftId !== shiftId);
      nextStore.swapRequests = nextStore.swapRequests.filter((entry) => entry.shiftId !== shiftId);
      nextStore.chatMessages = nextStore.chatMessages.map((entry) =>
        entry.relatedShiftId === shiftId ? { ...entry, relatedShiftId: "" } : entry
      );

      const savedStore = writeStore(nextStore);
      void notifyDiscord(buildShiftDiscordMessage("deleted", deletedShift, auth.store));
      broadcastEvent("portal", { type: "shift-deleted" });
      sendPortalData(res, 200, auth.user, savedStore);
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/requests") {
    const body = await readJson(req);
    const normalized = validateRequestPayload(body);
    const nextStore = structuredClone(auth.store);

    nextStore.requests.unshift({
      id: crypto.randomUUID(),
      userId: auth.user.id,
      type: normalized.type,
      date: normalized.date,
      content: normalized.content,
      status: "offen",
      adminNote: "",
      createdAt: new Date().toISOString()
    });

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "request-created" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  const requestMatch = url.pathname.match(/^\/api\/requests\/([^/]+)$/);
  if (requestMatch && req.method === "PATCH") {
    requireRole(auth.user, "planner");
    const requestId = decodeURIComponent(requestMatch[1]);
    const nextStore = structuredClone(auth.store);
    const request = nextStore.requests.find((entry) => entry.id === requestId);

    if (!request) {
      sendJson(res, 404, { error: "Rueckmeldung nicht gefunden." });
      return;
    }

    const body = await readJson(req);
    request.status = validateRequestStatus(body.status);
    request.adminNote = String(body.adminNote || "").trim();

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "request-updated" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/announcements") {
    requireRole(auth.user, "planner");
    const body = await readJson(req);
    const normalized = validateAnnouncementPayload(body);
    const nextStore = structuredClone(auth.store);

    nextStore.announcements.unshift({
      id: crypto.randomUUID(),
      title: normalized.title,
      body: normalized.body,
      pinned: normalized.pinned,
      authorId: auth.user.id,
      createdAt: new Date().toISOString()
    });

    const savedStore = writeStore(nextStore);
    void notifyDiscord(buildAnnouncementDiscordMessage(savedStore.announcements[0], auth.user));
    broadcastEvent("portal", { type: "announcement-created" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  const announcementMatch = url.pathname.match(/^\/api\/announcements\/([^/]+)$/);
  if (announcementMatch && req.method === "DELETE") {
    requireRole(auth.user, "planner");
    const announcementId = decodeURIComponent(announcementMatch[1]);
    const nextStore = structuredClone(auth.store);

    nextStore.announcements = nextStore.announcements.filter((entry) => entry.id !== announcementId);
    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "announcement-deleted" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson(req);
    const normalized = validateChatPayload(body, auth.user, auth.store);
    const nextStore = structuredClone(auth.store);

    nextStore.chatMessages.unshift({
      id: crypto.randomUUID(),
      authorId: auth.user.id,
      relatedShiftId: normalized.relatedShiftId,
      content: normalized.content,
      createdAt: new Date().toISOString()
    });

    const savedStore = writeStore(nextStore);
    broadcastEvent("chat", { ok: true });
    broadcastEvent("portal", { type: "chat" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/swap-requests") {
    const body = await readJson(req);
    const normalized = validateSwapRequestPayload(body, auth.user, auth.store);
    const nextStore = structuredClone(auth.store);

    nextStore.swapRequests.unshift({
      id: crypto.randomUUID(),
      shiftId: normalized.shiftId,
      requesterId: auth.user.id,
      message: normalized.message,
      status: "offen",
      candidateIds: [],
      approvedCandidateId: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "swap-request" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  const swapOfferMatch = url.pathname.match(/^\/api\/swap-requests\/([^/]+)\/offer$/);
  if (swapOfferMatch && req.method === "POST") {
    const swapRequestId = decodeURIComponent(swapOfferMatch[1]);
    const nextStore = structuredClone(auth.store);
    const swapRequest = nextStore.swapRequests.find((entry) => entry.id === swapRequestId);

    if (!swapRequest) {
      sendJson(res, 404, { error: "Tauschwunsch nicht gefunden." });
      return;
    }

    validateSwapOffer(swapRequest, auth.user, nextStore);
    swapRequest.candidateIds = uniqueStrings([...(swapRequest.candidateIds || []), auth.user.id]);
    swapRequest.status = "angeboten";
    swapRequest.updatedAt = new Date().toISOString();

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "swap-offer" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  const swapDecisionMatch = url.pathname.match(/^\/api\/swap-requests\/([^/]+)$/);
  if (swapDecisionMatch && req.method === "PATCH") {
    requireRole(auth.user, "planner");
    const swapRequestId = decodeURIComponent(swapDecisionMatch[1]);
    const nextStore = structuredClone(auth.store);
    const swapRequest = nextStore.swapRequests.find((entry) => entry.id === swapRequestId);

    if (!swapRequest) {
      sendJson(res, 404, { error: "Tauschwunsch nicht gefunden." });
      return;
    }

    const body = await readJson(req);
    const decision = validateSwapDecision(body);
    const shift = nextStore.shifts.find((entry) => entry.id === swapRequest.shiftId);

    if (!shift) {
      sendJson(res, 404, { error: "Die zugehoerige Schicht existiert nicht mehr." });
      return;
    }

    if (decision.status === "genehmigt") {
      if (!swapRequest.candidateIds.includes(decision.candidateId)) {
        sendJson(res, 400, { error: "Diese Person hat keine Uebernahme angeboten." });
        return;
      }

      shift.memberId = decision.candidateId;
      nextStore.timeEntries = nextStore.timeEntries.filter((entry) => entry.shiftId !== shift.id);
      swapRequest.status = "genehmigt";
      swapRequest.approvedCandidateId = decision.candidateId;
    } else {
      swapRequest.status = "abgelehnt";
      swapRequest.approvedCandidateId = "";
    }

    swapRequest.updatedAt = new Date().toISOString();
    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "swap-decision" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/time/check-in") {
    const body = await readJson(req);
    const shiftId = String(body.shiftId || "");
    const shift = auth.store.shifts.find((entry) => entry.id === shiftId);

    if (!shift || shift.memberId !== auth.user.id) {
      sendJson(res, 403, { error: "Du kannst nur in deine eigene Schicht einstempeln." });
      return;
    }

    if (shift.date !== todayKey()) {
      sendJson(res, 400, { error: "Einstempeln ist nur am Einsatztag moeglich." });
      return;
    }

    if (auth.store.timeEntries.some((entry) => entry.userId === auth.user.id && !entry.checkOutAt)) {
      sendJson(res, 400, { error: "Du bist bereits in einer Schicht eingestempelt." });
      return;
    }

    const nextStore = structuredClone(auth.store);
    nextStore.timeEntries.unshift({
      id: crypto.randomUUID(),
      userId: auth.user.id,
      shiftId,
      checkInAt: new Date().toISOString(),
      checkOutAt: ""
    });

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "check-in" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/time/check-out") {
    const body = await readJson(req);
    const shiftId = String(body.shiftId || "");
    const nextStore = structuredClone(auth.store);
    const entry = nextStore.timeEntries.find(
      (item) => item.shiftId === shiftId && item.userId === auth.user.id && !item.checkOutAt
    );

    if (!entry) {
      sendJson(res, 404, { error: "Kein offener Zeiteintrag fuer diese Schicht gefunden." });
      return;
    }

    entry.checkOutAt = new Date().toISOString();
    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "check-out" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  const settingsAddMatch = url.pathname.match(/^\/api\/settings\/([^/]+)$/);
  if (settingsAddMatch && req.method === "POST") {
    requireRole(auth.user, "planner");
    const key = decodeURIComponent(settingsAddMatch[1]);
    validateSettingsKey(key);

    const body = await readJson(req);
    const value = String(body.value || "").trim();
    if (!value) {
      sendJson(res, 400, { error: "Bitte einen gueltigen Wert eingeben." });
      return;
    }

    const nextStore = structuredClone(auth.store);
    const exists = nextStore.settings[key].some((entry) => entry.toLowerCase() === value.toLowerCase());
    if (exists) {
      sendJson(res, 409, { error: "Dieser Wert existiert bereits." });
      return;
    }

    nextStore.settings[key].push(value);
    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "settings-updated" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  const settingsRemoveMatch = url.pathname.match(/^\/api\/settings\/([^/]+)\/(.+)$/);
  if (settingsRemoveMatch && req.method === "DELETE") {
    requireRole(auth.user, "planner");
    const key = decodeURIComponent(settingsRemoveMatch[1]);
    const value = decodeURIComponent(settingsRemoveMatch[2]);
    validateSettingsKey(key);

    if (isSettingsValueInUse(key, value, auth.store)) {
      sendJson(res, 400, { error: "Dieser Wert wird noch in Schichten verwendet." });
      return;
    }

    const nextStore = structuredClone(auth.store);
    nextStore.settings[key] = nextStore.settings[key].filter((entry) => entry !== value);
    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "settings-updated" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/users") {
    requireRole(auth.user, "admin");
    const body = await readJson(req);
    const normalized = validateAdminUserPayload(body, auth.store);
    const nextStore = structuredClone(auth.store);

    nextStore.users.push({
      id: crypto.randomUUID(),
      username: normalized.username,
      displayName: normalized.displayName,
      role: normalized.role,
      vrchatName: normalized.vrchatName,
      discordName: normalized.discordName,
      passwordHash: hashPassword(normalized.password)
    });

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "user-created" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserMatch) {
    requireRole(auth.user, "admin");
    const userId = decodeURIComponent(adminUserMatch[1]);
    const nextStore = structuredClone(auth.store);
    const target = nextStore.users.find((entry) => entry.id === userId);

    if (!target) {
      sendJson(res, 404, { error: "Benutzer nicht gefunden." });
      return;
    }

    if (req.method === "PATCH") {
      const body = await readJson(req);
      if (body.role) {
        const nextRole = validateRole(body.role);
        ensureAdminStillExists(nextStore.users, target, nextRole);
        target.role = nextRole;
      }

      if (body.vrchatName !== undefined) {
        const vrchatName = String(body.vrchatName || "").trim();
        if (!vrchatName) {
          sendJson(res, 400, { error: "VRChat-Name darf nicht leer sein." });
          return;
        }
        target.vrchatName = vrchatName;
      }

      if (body.discordName !== undefined) {
        const discordName = String(body.discordName || "").trim();
        if (!discordName) {
          sendJson(res, 400, { error: "Discord-Name darf nicht leer sein." });
          return;
        }
        target.discordName = discordName;
      }

      if (body.password) {
        const password = String(body.password || "").trim();
        validatePassword(password);
        target.passwordHash = hashPassword(password);
      }

      const savedStore = writeStore(nextStore);
      broadcastEvent("portal", { type: "user-updated" });
      sendPortalData(res, 200, auth.user, savedStore);
      return;
    }

    if (req.method === "DELETE") {
      if (target.id === auth.user.id || target.username === "admin") {
        sendJson(res, 400, { error: "Dieser Benutzer kann nicht geloescht werden." });
        return;
      }

      ensureUserIsNotLinked(target.id, nextStore);
      nextStore.users = nextStore.users.filter((entry) => entry.id !== target.id);
      const savedStore = writeStore(nextStore);
      broadcastEvent("portal", { type: "user-deleted" });
      sendPortalData(res, 200, auth.user, savedStore);
      return;
    }
  }

  sendJson(res, 404, { error: "API-Route nicht gefunden." });
}

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  let store = {};
  if (fs.existsSync(STORE_PATH)) {
    try {
      store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8") || "{}");
    } catch {
      store = {};
    }
  }

  const normalized = normalizeStore(store);
  fs.writeFileSync(STORE_PATH, JSON.stringify(normalized, null, 2));
}

function buildDefaultStore() {
  const users = [
    buildSeedUser("admin", "System Admin", "admin", "admin123!", "System Admin", "system-admin"),
    buildSeedUser("aiko", "Aiko", "viewer", "mod123!", "Aiko", "aiko_vrc"),
    buildSeedUser("mika", "Mika", "viewer", "mod123!", "Mika", "mika_vrc"),
    buildSeedUser("ren", "Ren", "viewer", "mod123!", "Ren", "ren_vrc"),
    buildSeedUser("sora", "Sora", "viewer", "mod123!", "Sora", "sora_vrc")
  ];

  const userByName = new Map(users.map((entry) => [entry.displayName, entry.id]));
  const today = todayKey();

  return {
    users,
    settings: {
      shiftTypes: ["Frueh", "Prime Time", "Spaet", "Event"],
      worlds: ["Community Hub", "Sunset Lounge", "Event Arena", "Support Room"],
      tasks: ["Begruessung", "Patrouille", "Support", "Event-Leitung", "Koordination"]
    },
    shifts: [
      buildShift(addDays(today, 0), "Prime Time", "Community Hub", "Begruessung", userByName.get("Aiko"), "Neue User zuerst einsammeln."),
      buildShift(addDays(today, 0), "Prime Time", "Sunset Lounge", "Patrouille", userByName.get("Mika"), "Fokus auf Stoerungen in Public Bereichen."),
      buildShift(addDays(today, 1), "Event", "Event Arena", "Event-Leitung", userByName.get("Ren"), "Team 15 Minuten frueher briefen."),
      buildShift(addDays(today, 2), "Frueh", "Support Room", "Support", userByName.get("Sora"), "Meldungen sammeln und weiterreichen."),
      buildShift(addDays(today, 3), "Spaet", "Community Hub", "Koordination", userByName.get("Aiko"), "Kurzes Debriefing im Anschluss.")
    ],
    requests: [
      {
        id: crypto.randomUUID(),
        userId: userByName.get("Aiko"),
        type: "Wunsch",
        date: addDays(today, 3),
        content: "Wenn moeglich keine Spaetschicht am Wochenende, ich bin nur bis 22 Uhr sicher online.",
        status: "in_planung",
        adminNote: "Beim naechsten Update beruecksichtigen.",
        createdAt: new Date().toISOString()
      },
      {
        id: crypto.randomUUID(),
        userId: userByName.get("Ren"),
        type: "Notiz",
        date: addDays(today, 1),
        content: "Ich uebernehme Events gerne, brauche aber vorher die Sprecherliste.",
        status: "offen",
        adminNote: "",
        createdAt: new Date().toISOString()
      }
    ],
    announcements: [
      {
        id: crypto.randomUUID(),
        title: "Aenderungen direkt im Hub",
        body: "Bitte alle Schichtupdates, Weltwechsel und Event-Infos nur noch hier posten, damit das ganze Team denselben Stand sieht.",
        pinned: true,
        authorId: users[0].id,
        createdAt: new Date().toISOString()
      },
      {
        id: crypto.randomUUID(),
        title: "Event-Woche",
        body: "Fuer Events bitte 10 Minuten vor Schichtbeginn online sein. Ein- und Ausstempeln ist ab sofort Pflicht fuer alle Moderatoren.",
        pinned: false,
        authorId: users[0].id,
        createdAt: new Date().toISOString()
      }
    ],
    chatMessages: [],
    swapRequests: [],
    timeEntries: []
  };
}

function buildSeedUser(username, displayName, role, password, vrchatName = "", discordName = "") {
  return {
    id: crypto.randomUUID(),
    username,
    displayName,
    role,
    vrchatName,
    discordName,
    passwordHash: hashPassword(password)
  };
}

function buildShift(date, shiftType, world, task, memberId, notes = "") {
  return {
    id: crypto.randomUUID(),
    date,
    shiftType,
    world,
    task,
    memberId,
    notes
  };
}

function normalizeStore(store) {
  const hasUsers = Array.isArray(store.users) && store.users.length;
  if (!hasUsers) {
    return buildDefaultStore();
  }

  const users = normalizeUsers(store.users, store.lists?.moderators || []);
  const settings = normalizeSettings(store.settings || store.lists || {}, Array.isArray(store.slots) ? store.slots : []);
  const shifts = Array.isArray(store.shifts)
    ? normalizeShifts(store.shifts, users)
    : migrateLegacyPlanning(store, users, settings);

  return {
    users,
    settings,
    shifts,
    requests: Array.isArray(store.requests) ? normalizeRequests(store.requests, users) : [],
    announcements: Array.isArray(store.announcements) ? normalizeAnnouncements(store.announcements, users) : [],
    chatMessages: Array.isArray(store.chatMessages) ? normalizeChatMessages(store.chatMessages, users, shifts) : [],
    swapRequests: Array.isArray(store.swapRequests) ? normalizeSwapRequests(store.swapRequests, users, shifts) : [],
    timeEntries: Array.isArray(store.timeEntries) ? normalizeTimeEntries(store.timeEntries, users, shifts) : []
  };
}

function normalizeSwapRequests(entries, users, shifts) {
  const validUserIds = new Set(users.map((entry) => entry.id));
  const validShiftIds = new Set(shifts.map((entry) => entry.id));
  const validStatuses = new Set(["offen", "angeboten", "genehmigt", "abgelehnt"]);

  return entries
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      shiftId: String(entry.shiftId || "").trim(),
      requesterId: String(entry.requesterId || "").trim(),
      message: String(entry.message || "").trim(),
      status: validStatuses.has(String(entry.status || "").trim()) ? String(entry.status).trim() : "offen",
      candidateIds: uniqueStrings(Array.isArray(entry.candidateIds) ? entry.candidateIds : []),
      approvedCandidateId: String(entry.approvedCandidateId || "").trim(),
      createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString(),
      updatedAt: isIsoDate(entry.updatedAt) ? entry.updatedAt : new Date().toISOString()
    }))
    .filter((entry) => validShiftIds.has(entry.shiftId) && validUserIds.has(entry.requesterId))
    .map((entry) => ({
      ...entry,
      candidateIds: entry.candidateIds.filter((candidateId) => validUserIds.has(candidateId) && candidateId !== entry.requesterId),
      approvedCandidateId: validUserIds.has(entry.approvedCandidateId) ? entry.approvedCandidateId : ""
    }));
}

function normalizeUsers(users, legacyModeratorNames) {
  const normalized = [];
  const usedUsernames = new Set();

  for (const entry of users) {
    const username = normalizeUsername(entry.username);
    const displayName = String(entry.displayName || "").trim();
    const vrchatName = String(entry.vrchatName || displayName).trim();
    const discordName = String(entry.discordName || username).trim();
    const passwordHash = String(entry.passwordHash || "").trim();
    const role = ["viewer", "planner", "admin"].includes(entry.role) ? entry.role : "viewer";

    if (!username || !displayName || !passwordHash || usedUsernames.has(username)) continue;

    usedUsernames.add(username);
    normalized.push({
      id: String(entry.id || crypto.randomUUID()),
      username,
      displayName,
      role,
      vrchatName,
      discordName,
      passwordHash
    });
  }

  if (!normalized.some((entry) => entry.role === "admin")) {
    normalized.unshift(buildSeedUser("admin", "System Admin", "admin", "admin123!"));
  }

  for (const name of uniqueStrings(legacyModeratorNames)) {
    if (normalized.some((entry) => entry.displayName.toLowerCase() === name.toLowerCase())) continue;

    const username = createUniqueUsername(name, normalized.map((entry) => entry.username));
    normalized.push({
      id: crypto.randomUUID(),
      username,
      displayName: name,
      role: "viewer",
      vrchatName: name,
      discordName: username,
      passwordHash: hashPassword("mod123!")
    });
  }

  return normalized;
}

function normalizeSettings(source, legacySlots) {
  const defaults = buildDefaultStore().settings;
  const shiftTypes = uniqueStrings(source.shiftTypes || source.shifts || []);
  const worlds = uniqueStrings(source.worlds || []);
  const tasks = uniqueStrings(source.tasks || legacySlots.map((slot) => slot.name || slot.task || ""));

  return {
    shiftTypes: shiftTypes.length ? shiftTypes : defaults.shiftTypes,
    worlds: worlds.length ? worlds : defaults.worlds,
    tasks: tasks.length ? tasks : defaults.tasks
  };
}

function normalizeShifts(shifts, users) {
  const validUserIds = new Set(users.map((entry) => entry.id));

  return shifts
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      date: String(entry.date || "").trim(),
      shiftType: String(entry.shiftType || "").trim(),
      world: String(entry.world || "").trim(),
      task: String(entry.task || "").trim(),
      memberId: String(entry.memberId || "").trim(),
      notes: String(entry.notes || "").trim()
    }))
    .filter(
      (entry) =>
        isDateKey(entry.date) &&
        entry.shiftType &&
        entry.world &&
        entry.task &&
        validUserIds.has(entry.memberId)
    );
}

function migrateLegacyPlanning(store, users, settings) {
  const shifts = [];
  const memberIdByName = new Map(users.map((entry) => [entry.displayName.toLowerCase(), entry.id]));
  const slotById = new Map((store.slots || []).map((slot) => [slot.id, slot]));

  for (const [monthKey, days] of Object.entries(store.planning || {})) {
    const [year, month] = monthKey.split("-").map(Number);
    if (!year || !month) continue;

    for (const [dayKey, slotEntries] of Object.entries(days || {})) {
      const day = Number(dayKey);
      if (!day) continue;

      for (const [slotId, rawEntry] of Object.entries(slotEntries || {})) {
        const moderatorName = String(rawEntry?.moderator || "").trim();
        const shiftType = String(rawEntry?.shift || "").trim() || settings.shiftTypes[0];
        const world = String(rawEntry?.world || "").trim() || settings.worlds[0];
        const memberId = memberIdByName.get(moderatorName.toLowerCase());
        const slot = slotById.get(slotId);

        if (!memberId) continue;

        shifts.push({
          id: crypto.randomUUID(),
          date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          shiftType,
          world,
          task: slot?.name || slot?.task || settings.tasks[0],
          memberId,
          notes: slot?.task || ""
        });
      }
    }
  }

  return normalizeShifts(shifts, users);
}

function normalizeRequests(requests, users) {
  const validUserIds = new Set(users.map((entry) => entry.id));

  return requests
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      userId: String(entry.userId || "").trim(),
      type: String(entry.type || "Notiz").trim() || "Notiz",
      date: String(entry.date || "").trim(),
      content: String(entry.content || "").trim(),
      status: validateRequestStatus(entry.status),
      adminNote: String(entry.adminNote || "").trim(),
      createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString()
    }))
    .filter((entry) => validUserIds.has(entry.userId) && entry.content);
}

function normalizeAnnouncements(announcements, users) {
  const validUserIds = new Set(users.map((entry) => entry.id));
  const fallbackAuthorId = users.find((entry) => entry.role === "admin")?.id || users[0]?.id || "";

  return announcements
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      title: String(entry.title || "").trim(),
      body: String(entry.body || "").trim(),
      pinned: Boolean(entry.pinned),
      authorId: validUserIds.has(String(entry.authorId || "").trim()) ? String(entry.authorId).trim() : fallbackAuthorId,
      createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString()
    }))
    .filter((entry) => entry.title && entry.body);
}

function normalizeChatMessages(messages, users, shifts) {
  const validUserIds = new Set(users.map((entry) => entry.id));
  const validShiftIds = new Set(shifts.map((entry) => entry.id));

  return messages
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      authorId: String(entry.authorId || "").trim(),
      relatedShiftId: validShiftIds.has(String(entry.relatedShiftId || "").trim()) ? String(entry.relatedShiftId).trim() : "",
      content: String(entry.content || "").trim(),
      createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString()
    }))
    .filter((entry) => validUserIds.has(entry.authorId) && entry.content);
}

function normalizeTimeEntries(entries, users, shifts) {
  const validUserIds = new Set(users.map((entry) => entry.id));
  const validShiftIds = new Set(shifts.map((entry) => entry.id));

  return entries
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      userId: String(entry.userId || "").trim(),
      shiftId: String(entry.shiftId || "").trim(),
      checkInAt: isIsoDate(entry.checkInAt) ? entry.checkInAt : "",
      checkOutAt: isIsoDate(entry.checkOutAt) ? entry.checkOutAt : ""
    }))
    .filter((entry) => validUserIds.has(entry.userId) && validShiftIds.has(entry.shiftId) && entry.checkInAt);
}

function readStore() {
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
}

function writeStore(store) {
  const normalized = normalizeStore(store);
  fs.writeFileSync(STORE_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}

function requireAuth(req) {
  const sessionId = getSessionId(req);
  if (!sessionId || !sessionStore.has(sessionId)) return null;

  const session = sessionStore.get(sessionId);
  const store = readStore();
  const user = store.users.find((entry) => entry.id === session.userId);

  if (!user) {
    sessionStore.delete(sessionId);
    return null;
  }

  return { user, store };
}

function requireRole(user, role) {
  const order = { viewer: 1, planner: 2, admin: 3 };
  if (order[user.role] < order[role]) {
    const error = new Error("Keine Berechtigung.");
    error.statusCode = 403;
    throw error;
  }
}

function projectDataForRole(user, store) {
  const notifications = buildNotifications(user, store);
  const announcements = store.announcements
    .slice()
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return new Date(right.createdAt) - new Date(left.createdAt);
    })
    .map((entry) => decorateAnnouncement(entry, store));

  const chatMessages = store.chatMessages
    .slice()
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .map((entry) => decorateChatMessage(entry, store));

  const base = {
    settings: store.settings,
    announcements,
    chatMessages,
    notifications,
    swapRequests: getSwapRequestsForUser(user, store)
  };

  if (user.role === "viewer") {
    return {
      ...base,
      shifts: store.shifts
        .filter((entry) => entry.memberId === user.id)
        .sort(compareShifts)
        .map((entry) => decorateShift(entry, store)),
      requests: store.requests
        .filter((entry) => entry.userId === user.id)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map((entry) => decorateRequest(entry, store)),
      timeEntries: store.timeEntries
        .filter((entry) => entry.userId === user.id)
        .sort((left, right) => new Date(right.checkInAt) - new Date(left.checkInAt))
        .map((entry) => decorateTimeEntry(entry, store))
    };
  }

  return {
    ...base,
    users: store.users
      .slice()
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "de"))
      .map(sanitizeUser),
    shifts: store.shifts.slice().sort(compareShifts).map((entry) => decorateShift(entry, store)),
    requests: store.requests
      .slice()
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .map((entry) => decorateRequest(entry, store)),
    timeEntries: store.timeEntries
      .slice()
      .sort((left, right) => new Date(right.checkInAt) - new Date(left.checkInAt))
      .map((entry) => decorateTimeEntry(entry, store))
  };
}

function decorateShift(shift, store) {
  return {
    ...shift,
    memberName: findUserName(store.users, shift.memberId)
  };
}

function decorateRequest(entry, store) {
  return {
    ...entry,
    userName: findUserName(store.users, entry.userId)
  };
}

function decorateAnnouncement(entry, store) {
  return {
    ...entry,
    authorName: findUserName(store.users, entry.authorId)
  };
}

function decorateChatMessage(entry, store) {
  const relatedShift = store.shifts.find((shift) => shift.id === entry.relatedShiftId);
  return {
    ...entry,
    authorName: findUserName(store.users, entry.authorId),
    relatedShift: relatedShift ? decorateShift(relatedShift, store) : null
  };
}

function decorateTimeEntry(entry, store) {
  const shift = store.shifts.find((item) => item.id === entry.shiftId);
  return {
    ...entry,
    memberName: findUserName(store.users, entry.userId),
    shift: shift ? decorateShift(shift, store) : null
  };
}

function decorateSwapRequest(entry, store) {
  const shift = store.shifts.find((item) => item.id === entry.shiftId);
  return {
    ...entry,
    requesterName: findUserName(store.users, entry.requesterId),
    approvedCandidateName: entry.approvedCandidateId ? findUserName(store.users, entry.approvedCandidateId) : "",
    shift: shift ? decorateShift(shift, store) : null,
    candidates: (entry.candidateIds || []).map((candidateId) => ({
      id: candidateId,
      name: findUserName(store.users, candidateId)
    }))
  };
}

function getSwapRequestsForUser(user, store) {
  const all = (store.swapRequests || [])
    .slice()
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
    .map((entry) => decorateSwapRequest(entry, store));

  if (user.role === "viewer") {
    return all.filter(
      (entry) =>
        entry.requesterId === user.id ||
        entry.shift?.memberId === user.id ||
        entry.candidates.some((candidate) => candidate.id === user.id) ||
        entry.approvedCandidateId === user.id
    );
  }

  return all;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    vrchatName: user.vrchatName || "",
    discordName: user.discordName || ""
  };
}

function sendPortalData(res, statusCode, user, store, headers = {}) {
  sendJson(
    res,
    statusCode,
    {
      session: sanitizeUser(user),
      data: projectDataForRole(user, store)
    },
    headers
  );
}

function findUserName(users, userId) {
  return users.find((entry) => entry.id === userId)?.displayName || "Unbekannt";
}

function buildNotifications(user, store) {
  if (user.role === "viewer") {
    return buildViewerNotifications(user, store);
  }

  return buildManagerNotifications(store);
}

function buildViewerNotifications(user, store) {
  const today = todayKey();
  const shifts = store.shifts
    .filter((entry) => entry.memberId === user.id)
    .sort(compareShifts);
  const notifications = [];

  for (const shift of shifts) {
    const diff = daysBetween(today, shift.date);
    if (diff < 0 || diff > 7) continue;

    let title = "";
    let tone = "info";
    if (diff === 0) {
      title = `Heute: ${shift.shiftType} in ${shift.world}`;
      tone = "teal";
    } else if (diff === 1) {
      title = `Morgen: ${shift.shiftType} in ${shift.world}`;
      tone = "amber";
    } else {
      title = `Demnaechst: ${shift.shiftType} in ${shift.world}`;
    }

    notifications.push({
      id: `shift-${shift.id}`,
      title,
      body: `${formatDisplayDate(shift.date)} · Aufgabe: ${shift.task}`,
      tone,
      createdAt: `${shift.date}T09:00:00.000Z`,
      category: "shift"
    });
  }

  const pinnedAnnouncements = store.announcements
    .filter((entry) => entry.pinned)
    .slice(0, 2)
    .map((entry) => ({
      id: `announcement-${entry.id}`,
      title: `Info: ${entry.title}`,
      body: entry.body,
      tone: "sky",
      createdAt: entry.createdAt,
      category: "announcement"
    }));

  return [...notifications, ...pinnedAnnouncements]
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, 6);
}

function buildManagerNotifications(store) {
  const today = todayKey();
  const openRequests = store.requests.filter((entry) => entry.status === "offen");
  const todayShifts = store.shifts.filter((entry) => entry.date === today);
  const liveEntries = store.timeEntries.filter((entry) => !entry.checkOutAt);
  const notifications = [];

  if (openRequests.length) {
    notifications.push({
      id: `requests-${openRequests.length}`,
      title: `${openRequests.length} offene Team-Rueckmeldungen`,
      body: "Neue Wuensche oder Hinweise warten auf Bearbeitung.",
      tone: "rose",
      createdAt: openRequests[0].createdAt,
      category: "request"
    });
  }

  if (todayShifts.length) {
    notifications.push({
      id: `today-shifts-${today}`,
      title: `${todayShifts.length} Schichten fuer heute`,
      body: "Pruefe Besetzung, Welten und letzte Briefings.",
      tone: "teal",
      createdAt: `${today}T08:00:00.000Z`,
      category: "shift"
    });
  }

  if (liveEntries.length) {
    notifications.push({
      id: `live-${liveEntries.length}`,
      title: `${liveEntries.length} Moderatoren sind eingestempelt`,
      body: "Aktive Schichten laufen gerade live.",
      tone: "sky",
      createdAt: new Date().toISOString(),
      category: "attendance"
    });
  }

  const openSwapRequests = (store.swapRequests || []).filter((entry) => ["offen", "angeboten"].includes(entry.status));
  if (openSwapRequests.length) {
    notifications.push({
      id: `swap-${openSwapRequests.length}`,
      title: `${openSwapRequests.length} offene Tauschwuesche`,
      body: "Pruefe, ob eine Uebernahme genehmigt werden soll.",
      tone: "amber",
      createdAt: openSwapRequests[0].updatedAt,
      category: "swap"
    });
  }

  return notifications.slice(0, 6);
}

function compareShifts(left, right) {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  if (left.shiftType !== right.shiftType) return left.shiftType.localeCompare(right.shiftType, "de");
  return left.world.localeCompare(right.world, "de");
}

function createSession(userId) {
  const sessionId = crypto.randomBytes(24).toString("hex");
  sessionStore.set(sessionId, { userId, createdAt: Date.now() });
  return sessionId;
}

function validateRegistrationPayload(body, store) {
  const displayName = String(body.displayName || "").trim();
  const username = normalizeUsername(body.username);
  const password = String(body.password || "").trim();
  const vrchatName = String(body.vrchatName || "").trim();
  const discordName = String(body.discordName || "").trim();

  if (!displayName || !username || !password || !vrchatName || !discordName) {
    const error = new Error("Bitte Anzeigename, Benutzername, Passwort, VRChat-Name und Discord-Name angeben.");
    error.statusCode = 400;
    throw error;
  }

  validatePassword(password);

  if (store.users.some((entry) => entry.username === username)) {
    const error = new Error("Dieser Benutzername existiert bereits.");
    error.statusCode = 409;
    throw error;
  }

  return { displayName, username, password, vrchatName, discordName };
}

function validateAdminUserPayload(body, store) {
  const normalized = validateRegistrationPayload(body, store);
  normalized.role = validateRole(body.role);
  return normalized;
}

function validateShiftPayload(body, store) {
  const date = String(body.date || "").trim();
  const memberId = String(body.memberId || "").trim();
  const shiftType = String(body.shiftType || "").trim();
  const world = String(body.world || "").trim();
  const task = String(body.task || "").trim();
  const notes = String(body.notes || "").trim();

  if (!isDateKey(date) || !memberId || !shiftType || !world || !task) {
    const error = new Error("Datum, Moderator, Schichttyp, Welt und Aufgabe sind erforderlich.");
    error.statusCode = 400;
    throw error;
  }

  if (!store.users.some((entry) => entry.id === memberId)) {
    const error = new Error("Der ausgewaehlte Benutzer existiert nicht.");
    error.statusCode = 400;
    throw error;
  }

  return { date, memberId, shiftType, world, task, notes };
}

function validateRequestPayload(body) {
  const type = String(body.type || "Notiz").trim() || "Notiz";
  const date = String(body.date || "").trim();
  const content = String(body.content || "").trim();

  if (!content) {
    const error = new Error("Bitte eine Rueckmeldung eintragen.");
    error.statusCode = 400;
    throw error;
  }

  if (date && !isDateKey(date)) {
    const error = new Error("Das angegebene Datum ist ungueltig.");
    error.statusCode = 400;
    throw error;
  }

  return { type, date, content };
}

function validateRequestStatus(status) {
  const normalized = String(status || "").trim();
  return ["offen", "in_planung", "beruecksichtigt"].includes(normalized) ? normalized : "offen";
}

function validateAnnouncementPayload(body) {
  const title = String(body.title || "").trim();
  const bodyText = String(body.body || "").trim();
  const pinned = Boolean(body.pinned);

  if (!title || !bodyText) {
    const error = new Error("Titel und Nachricht sind erforderlich.");
    error.statusCode = 400;
    throw error;
  }

  return { title, body: bodyText, pinned };
}

function validateChatPayload(body, user, store) {
  const content = String(body.content || "").trim();
  const relatedShiftId = String(body.relatedShiftId || "").trim();

  if (!content) {
    const error = new Error("Bitte eine Chat-Nachricht eingeben.");
    error.statusCode = 400;
    throw error;
  }

  if (relatedShiftId) {
    const shift = store.shifts.find((entry) => entry.id === relatedShiftId);
    if (!shift) {
      const error = new Error("Die ausgewaehlte Schicht existiert nicht.");
      error.statusCode = 400;
      throw error;
    }
    if (user.role === "viewer" && shift.memberId !== user.id) {
      const error = new Error("Moderatoren duerfen nur ihre eigenen Schichten referenzieren.");
      error.statusCode = 403;
      throw error;
    }
  }

  return { content, relatedShiftId };
}

function validateSwapRequestPayload(body, user, store) {
  const shiftId = String(body.shiftId || "").trim();
  const message = String(body.message || "").trim();
  const shift = store.shifts.find((entry) => entry.id === shiftId);

  if (!shift) {
    const error = new Error("Die ausgewaehlte Schicht existiert nicht.");
    error.statusCode = 400;
    throw error;
  }

  if (user.role === "viewer" && shift.memberId !== user.id) {
    const error = new Error("Du kannst nur fuer deine eigene Schicht einen Tauschwunsch senden.");
    error.statusCode = 403;
    throw error;
  }

  if ((store.swapRequests || []).some((entry) => entry.shiftId === shiftId && ["offen", "angeboten"].includes(entry.status))) {
    const error = new Error("Fuer diese Schicht gibt es bereits einen offenen Tauschwunsch.");
    error.statusCode = 409;
    throw error;
  }

  return {
    shiftId,
    message: message || "Ich suche eine Uebernahme fuer diese Schicht."
  };
}

function validateSwapOffer(swapRequest, user, store) {
  const shift = store.shifts.find((entry) => entry.id === swapRequest.shiftId);
  if (!shift) {
    const error = new Error("Die zugehoerige Schicht existiert nicht mehr.");
    error.statusCode = 400;
    throw error;
  }

  if (swapRequest.status === "genehmigt" || swapRequest.status === "abgelehnt") {
    const error = new Error("Dieser Tauschwunsch ist bereits abgeschlossen.");
    error.statusCode = 400;
    throw error;
  }

  if (shift.memberId === user.id || swapRequest.requesterId === user.id) {
    const error = new Error("Du kannst deine eigene Schicht nicht selbst uebernehmen.");
    error.statusCode = 400;
    throw error;
  }

  if (swapRequest.candidateIds.includes(user.id)) {
    const error = new Error("Du hast die Uebernahme bereits angeboten.");
    error.statusCode = 409;
    throw error;
  }
}

function validateSwapDecision(body) {
  const status = String(body.status || "").trim();
  const candidateId = String(body.candidateId || "").trim();

  if (!["genehmigt", "abgelehnt"].includes(status)) {
    const error = new Error("Ungueltige Entscheidung fuer den Tauschwunsch.");
    error.statusCode = 400;
    throw error;
  }

  if (status === "genehmigt" && !candidateId) {
    const error = new Error("Bitte waehle einen Moderator fuer die Uebernahme.");
    error.statusCode = 400;
    throw error;
  }

  return { status, candidateId };
}

function validateRole(role) {
  if (!["viewer", "planner", "admin"].includes(role)) {
    const error = new Error("Ungueltige Rolle.");
    error.statusCode = 400;
    throw error;
  }

  return role;
}

function validatePassword(password) {
  if (String(password).trim().length < 6) {
    const error = new Error("Das Passwort muss mindestens 6 Zeichen haben.");
    error.statusCode = 400;
    throw error;
  }
}

function validateSettingsKey(key) {
  if (!["shiftTypes", "worlds", "tasks"].includes(key)) {
    const error = new Error("Ungueltige Einstellungs-Liste.");
    error.statusCode = 400;
    throw error;
  }
}

function ensureAdminStillExists(users, target, nextRole) {
  if (target.role !== "admin" || nextRole === "admin") return;

  const adminCount = users.filter((entry) => entry.role === "admin").length;
  if (adminCount <= 1) {
    const error = new Error("Mindestens ein Admin muss erhalten bleiben.");
    error.statusCode = 400;
    throw error;
  }
}

function ensureUserIsNotLinked(userId, store) {
  const linked =
    store.shifts.some((entry) => entry.memberId === userId) ||
    store.requests.some((entry) => entry.userId === userId) ||
    store.chatMessages.some((entry) => entry.authorId === userId) ||
    store.swapRequests.some((entry) => entry.requesterId === userId || entry.candidateIds.includes(userId) || entry.approvedCandidateId === userId) ||
    store.timeEntries.some((entry) => entry.userId === userId);

  if (linked) {
    const error = new Error("Der Benutzer hat noch verknuepfte Daten und kann nicht geloescht werden.");
    error.statusCode = 400;
    throw error;
  }
}

function isSettingsValueInUse(key, value, store) {
  const property = {
    shiftTypes: "shiftType",
    worlds: "world",
    tasks: "task"
  }[key];

  return store.shifts.some((entry) => entry[property] === value);
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function createUniqueUsername(value, existingUsernames) {
  const used = new Set(existingUsernames.map((entry) => entry.toLowerCase()));
  const base = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "user";

  let candidate = base;
  let counter = 2;

  while (used.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function isIsoDate(value) {
  if (!value) return false;
  return !Number.isNaN(Date.parse(value));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash).split(":");
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derived, "hex"));
}

function getSessionId(req) {
  const cookieHeader = req.headers.cookie || "";
  if (!cookieHeader) return "";

  const cookies = Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );

  return cookies.sid || "";
}

function createSessionCookie(value, expire = false) {
  const parts = [`sid=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  if (process.env.COOKIE_SECURE === "1") parts.push("Secure");
  parts.push(expire ? "Max-Age=0" : "Max-Age=604800");
  return parts.join("; ");
}

function openEventStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  res.write(": connected\n\n");

  const client = { res };
  streamClients.add(client);
  const heartbeat = setInterval(() => {
    try {
      res.write(": keep-alive\n\n");
    } catch {
      clearInterval(heartbeat);
      streamClients.delete(client);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    streamClients.delete(client);
  });
}

function broadcastEvent(eventName, payload) {
  const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of streamClients) {
    try {
      client.res.write(message);
    } catch {
      streamClients.delete(client);
    }
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function serveStatic(res, fileName) {
  const filePath = path.join(ROOT, fileName);
  const contentType =
    {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8"
    }[path.extname(filePath)] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", ...headers });
  if (payload === null) {
    res.end();
    return;
  }

  res.end(JSON.stringify(payload));
}

async function notifyDiscord(message) {
  const webhookUrl = String(process.env.DISCORD_WEBHOOK_URL || "").trim();
  if (!webhookUrl || !message) return;

  try {
    await postJson(webhookUrl, message);
  } catch (error) {
    console.error("Discord webhook failed:", error.message);
  }
}

function buildShiftDiscordMessage(action, shift, store, previousShift = null) {
  const memberName = findUserName(store.users, shift.memberId);
  const titleMap = {
    created: "Neue Moderations-Schicht",
    updated: "Schicht wurde geaendert",
    deleted: "Schicht wurde entfernt"
  };

  const descriptionMap = {
    created: `${memberName} wurde fuer eine Schicht eingeplant.`,
    updated: `${memberName} hat eine aktualisierte Schicht.`,
    deleted: `Eine Schicht von ${memberName} wurde entfernt.`
  };

  const fields = [
    { name: "Moderator", value: memberName, inline: true },
    { name: "Datum", value: formatDisplayDate(shift.date), inline: true },
    { name: "Schicht", value: shift.shiftType, inline: true },
    { name: "Welt", value: shift.world, inline: true },
    { name: "Aufgabe", value: shift.task, inline: true }
  ];

  if (shift.notes) {
    fields.push({ name: "Notiz", value: clipText(shift.notes, 300), inline: false });
  }

  if (previousShift && action === "updated") {
    fields.push({
      name: "Vorher",
      value: `${formatDisplayDate(previousShift.date)} · ${previousShift.shiftType} · ${previousShift.world} · ${previousShift.task}`,
      inline: false
    });
  }

  return {
    username: "VRC Team Planner",
    embeds: [
      {
        title: titleMap[action] || "Schicht-Update",
        description: descriptionMap[action] || "Es gibt ein neues Schicht-Update.",
        color: action === "deleted" ? 12000027 : action === "updated" ? 11757312 : 10181046,
        fields,
        timestamp: new Date().toISOString()
      }
    ]
  };
}

function buildAnnouncementDiscordMessage(entry, user) {
  return {
    username: "VRC Team Planner",
    content: entry.pinned ? "@everyone Neue wichtige Team-Info" : "",
    embeds: [
      {
        title: `Team-Info: ${entry.title}`,
        description: clipText(entry.body, 1000),
        color: 1922777,
        fields: [
          { name: "Von", value: user.displayName, inline: true },
          { name: "Prioritaet", value: entry.pinned ? "Wichtig" : "Normal", inline: true }
        ],
        timestamp: entry.createdAt
      }
    ],
    allowed_mentions: {
      parse: entry.pinned ? ["everyone"] : []
    }
  };
}

function postJson(targetUrl, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const body = JSON.stringify(payload);
    const request = https.request(
      {
        method: "POST",
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
            return;
          }
          reject(new Error(`Discord returned ${response.statusCode || 0}`));
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function clipText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day + amount, 12, 0, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysBetween(fromDate, toDate) {
  const from = new Date(`${fromDate}T12:00:00`);
  const to = new Date(`${toDate}T12:00:00`);
  return Math.floor((to - from) / 86400000);
}

function formatDisplayDate(dateKey) {
  if (!isDateKey(dateKey)) return dateKey;
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(year, month - 1, day, 12, 0, 0));
}
