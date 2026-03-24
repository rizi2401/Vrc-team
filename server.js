const http = require("node:http");
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
      sendPortalData(res, 200, auth.user, savedStore);
      return;
    }

    if (req.method === "DELETE") {
      nextStore.shifts = nextStore.shifts.filter((entry) => entry.id !== shiftId);
      nextStore.timeEntries = nextStore.timeEntries.filter((entry) => entry.shiftId !== shiftId);
      nextStore.chatMessages = nextStore.chatMessages.map((entry) =>
        entry.relatedShiftId === shiftId ? { ...entry, relatedShiftId: "" } : entry
      );

      const savedStore = writeStore(nextStore);
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
    sendPortalData(res, 201, auth.user, savedStore);
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
      passwordHash: hashPassword(normalized.password)
    });

    const savedStore = writeStore(nextStore);
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

      if (body.password) {
        const password = String(body.password || "").trim();
        validatePassword(password);
        target.passwordHash = hashPassword(password);
      }

      const savedStore = writeStore(nextStore);
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
    buildSeedUser("admin", "System Admin", "admin", "admin123!"),
    buildSeedUser("aiko", "Aiko", "viewer", "mod123!"),
    buildSeedUser("mika", "Mika", "viewer", "mod123!"),
    buildSeedUser("ren", "Ren", "viewer", "mod123!"),
    buildSeedUser("sora", "Sora", "viewer", "mod123!")
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
    timeEntries: []
  };
}

function buildSeedUser(username, displayName, role, password) {
  return {
    id: crypto.randomUUID(),
    username,
    displayName,
    role,
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
    timeEntries: Array.isArray(store.timeEntries) ? normalizeTimeEntries(store.timeEntries, users, shifts) : []
  };
}

function normalizeUsers(users, legacyModeratorNames) {
  const normalized = [];
  const usedUsernames = new Set();

  for (const entry of users) {
    const username = normalizeUsername(entry.username);
    const displayName = String(entry.displayName || "").trim();
    const passwordHash = String(entry.passwordHash || "").trim();
    const role = ["viewer", "planner", "admin"].includes(entry.role) ? entry.role : "viewer";

    if (!username || !displayName || !passwordHash || usedUsernames.has(username)) continue;

    usedUsernames.add(username);
    normalized.push({
      id: String(entry.id || crypto.randomUUID()),
      username,
      displayName,
      role,
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
    chatMessages
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

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role
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

  if (!displayName || !username || !password) {
    const error = new Error("Bitte Anzeigename, Benutzername und Passwort angeben.");
    error.statusCode = 400;
    throw error;
  }

  validatePassword(password);

  if (store.users.some((entry) => entry.username === username)) {
    const error = new Error("Dieser Benutzername existiert bereits.");
    error.statusCode = 409;
    throw error;
  }

  return { displayName, username, password };
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

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day + amount, 12, 0, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
