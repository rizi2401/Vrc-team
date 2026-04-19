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
const PORTAL_STORE_KEY = "primary";
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const USER_ACTIVITY_TOUCH_INTERVAL_MS = normalizePositiveInteger(process.env.USER_ACTIVITY_TOUCH_INTERVAL_MS, 5 * 60 * 1000);

const COMMUNITY_EVENTS = [
  {
    id: "welcome-night",
    title: "Welcome Night",
    dateLabel: "Freitag · 20:00 Uhr",
    world: "Community Hub",
    host: "SONARA Team",
    summary: "Neue Mitglieder kennenlernen, Gruppeninfos teilen und entspannt in den Abend starten."
  },
  {
    id: "world-tour",
    title: "World Tour",
    dateLabel: "Samstag · 21:00 Uhr",
    world: "Event Arena",
    host: "Event Team",
    summary: "Gemeinsame Weltreise mit Stopps fuer Screenshots, Spiele und kleine Community-Momente."
  },
  {
    id: "late-lounge",
    title: "Late Lounge",
    dateLabel: "Sonntag · 22:00 Uhr",
    world: "Sunset Lounge",
    host: "Night Crew",
    summary: "Ruhiger Community-Abend mit Musik, offenen Gespraechen und lockerer Moderationspraesenz."
  }
];

const COMMUNITY_RULES = [
  {
    title: "Respekt zuerst",
    body: "Behandle andere fair, freundlich und ohne persoenliche Angriffe. SONARA lebt von angenehmer Stimmung."
  },
  {
    title: "Kein Drama im Hub",
    body: "Konflikte werden nicht im Hauptbereich ausgetragen. Fuer Probleme sind Moderatoren und Feedback da."
  },
  {
    title: "Sichere Community",
    body: "Kein Belästigen, kein gezieltes Stören, keine toxischen Aktionen. Moderationsanweisungen gelten."
  },
  {
    title: "Events ernst nehmen",
    body: "Hosts, Moderation und Briefings werden respektiert, damit Events fuer alle sauber laufen."
  }
];

const COMMUNITY_FAQ = [
  {
    question: "Wie werde ich Teil der Community?",
    answer: "Registriere dich im Portal, pflege dein Profil und schau in News, Events und Feedback-Bereich vorbei."
  },
  {
    question: "Wo sehe ich wichtige Updates?",
    answer: "Auf der Startseite, im News-Bereich und spaeter optional ueber Discord-Hinweise."
  },
  {
    question: "Wie werde ich Moderator?",
    answer: "Nutze den Feedback-Bereich fuer Bewerbungen oder kontaktiere die Leitung direkt mit deinem Interesse."
  }
];

const staticFiles = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/styles.css": "styles.css",
  "/sonara-crest.png": "ChatGPT Image 19. März 2026, 13_32_37.png",
  "/sonara-world-bg.png": "sonara-world-bg.png"
};

const sessionStore = new Map();
const messageCooldownStore = new Map();
const streamClients = new Set();
let discordSendChain = Promise.resolve();
let discordLastDispatchAt = 0;
const DISCORD_MIN_INTERVAL_MS = normalizePositiveInteger(process.env.DISCORD_MIN_INTERVAL_MS, 3000);
const DISCORD_1015_COOLDOWN_MS = normalizePositiveInteger(process.env.DISCORD_1015_COOLDOWN_MS, 60 * 60 * 1000);
const DISCORD_AUTO_NOTIFICATIONS_ENABLED = process.env.DISCORD_AUTO_NOTIFICATIONS_ENABLED !== "0";
const MESSAGE_COOLDOWN_MS = 5000;
const CREATOR_MIN_FOLLOWERS = normalizePositiveInteger(process.env.CREATOR_MIN_FOLLOWERS, 200);
const CHAT_TRIM_COUNTS = new Set([20, 30, 40, 50]);
const AVAILABILITY_DAY_IDS = ["mo", "di", "mi", "do", "fr", "sa", "so"];
let PortalPoolCtor = null;
let portalPool = null;
let portalStoreCache = null;
let portalStoreInitPromise = null;
let portalStorePersistChain = Promise.resolve();
const discordState = {
  lastAttemptAt: "",
  lastSuccessAt: "",
  lastError: "",
  lastStatusCode: 0,
  blockedUntil: ""
};

portalStoreInitPromise = initializePortalStore();

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

    const rootHtmlFile = resolveRootHtmlFile(url.pathname);
    if (rootHtmlFile) {
      serveStatic(res, rootHtmlFile);
      return;
    }

    if (/^\/vrchat-link\/?$/i.test(url.pathname)) {
      serveStatic(res, staticFiles["/"]);
      return;
    }

    if (url.pathname.startsWith("/creator/")) {
      serveStatic(res, staticFiles["/"]);
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
  await ensurePortalStoreReady();

  if (req.method === "GET" && url.pathname === "/api/healthz") {
    sendJson(res, 200, { ok: true, status: "healthy" });
    return;
  }

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
    const user = findUserByLoginIdentifier(store.users, body.identifier || body.username);

    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      sendJson(res, 401, { error: "VRChat-Name, Discord-Name oder Passwort ist falsch." });
      return;
    }

    if (user.isBlocked) {
      sendJson(res, 403, { error: buildBlockedLoginMessage(user) });
      return;
    }

    let responseStore = store;
    let responseUser = user;
    const nextStore = structuredClone(store);
    const target = nextStore.users.find((entry) => entry.id === user.id);
    if (target) {
      if (normalizeVrchatLinkSource(body.linkSource)) {
        applyVrchatLinkState(target, body.linkSource);
      }
      applyUserPresenceHeartbeat(target, { login: true, force: true });
      responseStore = writeStore(nextStore);
      responseUser = target;
    }

    const sessionId = createSession(user.id);
    sendPortalData(res, 200, responseUser, responseStore, { "Set-Cookie": createSessionCookie(sessionId) });
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
      role: "member",
      vrchatName: normalized.vrchatName,
      discordName: normalized.discordName,
      avatarUrl: normalized.avatarUrl,
      bio: normalized.bio,
      contactNote: normalized.contactNote,
      creatorBlurb: normalized.creatorBlurb,
      creatorLinks: normalized.creatorLinks,
      creatorVisible: normalized.creatorVisible,
      creatorSlug: normalized.creatorSlug,
      creatorApplicationStatus: normalized.creatorApplicationStatus,
      creatorFollowerCount: normalized.creatorFollowerCount,
      creatorPrimaryPlatform: normalized.creatorPrimaryPlatform,
      creatorProofUrl: normalized.creatorProofUrl,
      creatorApplicationNote: normalized.creatorApplicationNote,
      creatorReviewNote: normalized.creatorReviewNote,
      creatorReviewedAt: normalized.creatorReviewedAt,
      creatorReviewedBy: normalized.creatorReviewedBy,
      creatorCommunityName: normalized.creatorCommunityName,
      creatorCommunitySummary: normalized.creatorCommunitySummary,
      creatorCommunityInviteUrl: normalized.creatorCommunityInviteUrl,
      creatorPresence: normalized.creatorPresence,
      creatorPresenceText: normalized.creatorPresenceText,
      creatorPresenceUrl: normalized.creatorPresenceUrl,
      creatorPresenceUpdatedAt: normalized.creatorPresenceUpdatedAt,
      creatorWebhookToken: createCreatorWebhookToken(),
      creatorAutomationLastAt: "",
      creatorAutomationLastSource: "",
      weeklyHoursCapacity: normalized.weeklyHoursCapacity,
      weeklyDaysCapacity: normalized.weeklyDaysCapacity,
      overtimeAdjustments: [],
      availabilitySchedule: normalized.availabilitySchedule,
      availabilitySlots: normalized.availabilitySlots,
      availabilityUpdatedAt: normalized.availabilityUpdatedAt,
      lastLoginAt: "",
      lastSeenAt: "",
      vrchatLinkedAt: "",
      vrchatLinkSource: "",
      passwordHash: normalized.passwordHash
    };

    applyVrchatLinkState(user, body.linkSource);
    applyUserPresenceHeartbeat(user, { login: true, force: true });

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

  if (req.method === "GET" && url.pathname === "/api/public") {
    const store = readStore();
    sendJson(res, 200, buildPublicPortalData(store));
    return;
  }

  const creatorWebhookMatch = url.pathname.match(/^\/api\/creator-presence\/webhook\/([^/]+)$/);
  if (creatorWebhookMatch && req.method === "POST") {
    const token = normalizeCreatorWebhookToken(decodeURIComponent(creatorWebhookMatch[1]), { allowEmpty: false });
    const store = readStore();
    const nextStore = structuredClone(store);
    const target = nextStore.users.find((entry) => entry.creatorWebhookToken === token && !entry.isBlocked);

    if (!target) {
      sendJson(res, 404, { error: "Webhook nicht gefunden." });
      return;
    }

    const body = await readJson(req);
    const normalized = validateCreatorPresenceWebhookPayload(body, target);
    target.creatorPresence = normalized.creatorPresence;
    target.creatorPresenceText = normalized.creatorPresenceText;
    target.creatorPresenceUrl = normalized.creatorPresenceUrl;
    target.creatorPresenceUpdatedAt =
      normalized.creatorPresence !== "offline" || normalized.creatorPresenceText || normalized.creatorPresenceUrl ? new Date().toISOString() : "";
    target.creatorAutomationLastAt = new Date().toISOString();
    target.creatorAutomationLastSource = normalized.source;

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "creator-presence-webhook", userId: target.id, status: normalized.creatorPresence });
    sendJson(res, 200, {
      ok: true,
      creatorId: target.id,
      status: normalized.creatorPresence,
      updatedAt: target.creatorPresenceUpdatedAt || target.creatorAutomationLastAt
    });
    return;
  }

  const auth = requireAuth(req);
  if (!auth) {
    sendJson(res, 401, { error: "Nicht angemeldet." });
    return;
  }

  {
    const activityStore = structuredClone(auth.store);
    const activityUser = activityStore.users.find((entry) => entry.id === auth.user.id);
    if (activityUser && applyUserPresenceHeartbeat(activityUser)) {
      auth.store = writeStore(activityStore);
      auth.user = activityUser;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    sendPortalData(res, 200, auth.user, auth.store);
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/profile") {
    const body = await readJson(req);
    const nextStore = structuredClone(auth.store);
    const target = nextStore.users.find((entry) => entry.id === auth.user.id);

    if (!target) {
      sendJson(res, 404, { error: "Profil nicht gefunden." });
      return;
    }

    applyUserIdentityUpdates(nextStore.users, target, body, true);

    if (body.password) {
      const password = String(body.password || "").trim();
      validatePassword(password);
      target.passwordHash = hashPassword(password);
    }

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "profile-updated" });
    sendPortalData(res, 200, target, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/profile/creator-webhook/rotate") {
    const nextStore = structuredClone(auth.store);
    const target = nextStore.users.find((entry) => entry.id === auth.user.id);

    if (!target) {
      sendJson(res, 404, { error: "Profil nicht gefunden." });
      return;
    }

    target.creatorWebhookToken = createCreatorWebhookToken();
    target.creatorAutomationLastAt = "";
    target.creatorAutomationLastSource = "";

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "creator-webhook-rotated", userId: target.id });
    sendPortalData(res, 200, target, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/creator-application") {
    const body = await readJson(req);
    const nextStore = structuredClone(auth.store);
    const target = nextStore.users.find((entry) => entry.id === auth.user.id);

    if (!target) {
      sendJson(res, 404, { error: "Profil nicht gefunden." });
      return;
    }

    const normalized = validateCreatorApplicationPayload(body);
    applyCreatorApplication(target, normalized);

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "creator-application-submitted" });
    sendPortalData(res, 200, target, savedStore);
    return;
  }

  const creatorApplicationMatch = url.pathname.match(/^\/api\/admin\/creator-applications\/([^/]+)$/);
  if (creatorApplicationMatch && req.method === "PATCH") {
    requireRole(auth.user, "planner");
    const body = await readJson(req);
    const userId = decodeURIComponent(creatorApplicationMatch[1]);
    const nextStore = structuredClone(auth.store);
    const target = nextStore.users.find((entry) => entry.id === userId);

    if (!target) {
      sendJson(res, 404, { error: "Benutzer nicht gefunden." });
      return;
    }

    const status = normalizeCreatorApplicationStatus(body.status);
    const creatorFollowerCount =
      body.creatorFollowerCount !== undefined ? normalizeCreatorFollowerCount(body.creatorFollowerCount) : normalizeCreatorFollowerCount(target.creatorFollowerCount);
    const creatorPrimaryPlatform =
      body.creatorPrimaryPlatform !== undefined ? normalizeCreatorPrimaryPlatform(body.creatorPrimaryPlatform) : normalizeCreatorPrimaryPlatform(target.creatorPrimaryPlatform);
    const creatorProofUrl = body.creatorProofUrl !== undefined ? normalizeCreatorProofUrl(body.creatorProofUrl) : normalizeCreatorProofUrl(target.creatorProofUrl);
    const creatorApplicationNote =
      body.creatorApplicationNote !== undefined ? normalizeCreatorApplicationNote(body.creatorApplicationNote) : normalizeCreatorApplicationNote(target.creatorApplicationNote);
    const creatorReviewNote =
      body.creatorReviewNote !== undefined ? normalizeCreatorReviewNote(body.creatorReviewNote) : normalizeCreatorReviewNote(target.creatorReviewNote);
    const overrideMinimum = normalizeBooleanInput(body.overrideMinimum);

    if ((status === "pending" || status === "approved") && (!creatorPrimaryPlatform || !creatorProofUrl)) {
      sendJson(res, 400, { error: "Fuer die Creator-Freigabe werden Plattform und ein sichtbarer Nachweis-Link gebraucht." });
      return;
    }

    if (status === "pending" && !hasMinimumCreatorFollowers(creatorFollowerCount)) {
      sendJson(res, 400, { error: `Offene Creator-Bewerbungen brauchen mindestens ${CREATOR_MIN_FOLLOWERS} Follower.` });
      return;
    }

    if (status === "approved" && !overrideMinimum && !hasMinimumCreatorFollowers(creatorFollowerCount)) {
      sendJson(res, 400, { error: `Fuer die Freigabe braucht dieses Profil mindestens ${CREATOR_MIN_FOLLOWERS} Follower oder eine bewusste Ueberschreibung.` });
      return;
    }

    target.creatorFollowerCount = creatorFollowerCount;
    target.creatorPrimaryPlatform = creatorPrimaryPlatform;
    target.creatorProofUrl = creatorProofUrl;
    target.creatorApplicationNote = creatorApplicationNote;
    target.creatorReviewNote = creatorReviewNote;
    target.creatorApplicationStatus = status;
    target.creatorReviewedAt = status === "none" ? "" : new Date().toISOString();
    target.creatorReviewedBy = status === "none" ? "" : auth.user.id;

    if (status === "approved") {
      target.creatorVisible = Boolean((target.creatorLinks || []).length || target.creatorBlurb);
    } else if (status === "pending" || status === "rejected" || status === "none") {
      target.creatorVisible = false;
    }

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "creator-application-reviewed" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/vrchat/overview") {
    requireRole(auth.user, "planner");
    sendJson(res, 410, { error: "Die VRChat-Datei-Anbindung wurde entfernt." });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/discord/status") {
    requireRole(auth.user, "planner");
    sendJson(res, 410, { error: "Der Discord-Webhook-Bereich wurde entfernt." });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/discord/test") {
    requireRole(auth.user, "planner");
    sendJson(res, 410, { error: "Der Discord-Webhook-Bereich wurde entfernt." });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/vrchat/sync") {
    requireRole(auth.user, "planner");
    sendJson(res, 410, { error: "Die VRChat-Datei-Anbindung wurde entfernt." });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/vrchat/verify-code") {
    requireRole(auth.user, "planner");
    sendJson(res, 410, { error: "Die VRChat-Datei-Anbindung wurde entfernt." });
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
    requireModerationCoordinator(auth.user);
    const body = await readJson(req);
    const shift = validateShiftPayload(body, auth.store);
    const nextStore = structuredClone(auth.store);

    nextStore.shifts.unshift({
      id: crypto.randomUUID(),
      ...shift
    });
    applyCatalogAdds(nextStore.settings, shift.catalogAdds);

    const savedStore = writeStore(nextStore);
    void notifyDiscord(buildShiftDiscordMessage("created", savedStore.shifts[0], savedStore), { kind: "auto" });
    broadcastEvent("portal", { type: "shift-created" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  if (
    req.method === "POST" &&
    (url.pathname === "/api/shifts/bulk" || url.pathname === "/api/planning/bulk-shifts")
  ) {
    requireModerationCoordinator(auth.user);
    const body = await readJson(req);
    const rawEntries = Array.isArray(body.entries) ? body.entries : [];

    if (!rawEntries.length) {
      sendJson(res, 400, { error: "Bitte mindestens eine Schicht fuer die Sammelplanung uebergeben." });
      return;
    }

    const nextStore = structuredClone(auth.store);

    for (const rawEntry of rawEntries) {
      const normalized = validateShiftPayload(rawEntry, nextStore);
      nextStore.shifts.unshift({
        id: crypto.randomUUID(),
        ...normalized
      });
      applyCatalogAdds(nextStore.settings, normalized.catalogAdds);
    }

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "shift-bulk-created", count: rawEntries.length });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  const shiftMatch = url.pathname.match(/^\/api\/shifts\/([^/]+)$/);
  if (shiftMatch) {
    requireModerationCoordinator(auth.user);
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
      const affectsRecordedHistory =
        shift.date !== normalized.date ||
        shift.startTime !== normalized.startTime ||
        shift.endTime !== normalized.endTime ||
        shift.memberId !== normalized.memberId ||
        shift.shiftType !== normalized.shiftType ||
        shift.world !== normalized.world ||
        shift.task !== normalized.task;

      if (affectsRecordedHistory) {
        preserveTimeEntryHistoryForShift(nextStore.timeEntries, previousShift, nextStore, {
          detachEntries: true,
          closeOpenEntries: false
        });
      }

      shift.date = normalized.date;
      shift.startTime = normalized.startTime;
      shift.endTime = normalized.endTime;
      shift.memberId = normalized.memberId;
      shift.shiftType = normalized.shiftType;
      shift.world = normalized.world;
      shift.task = normalized.task;
      shift.notes = normalized.notes;
      shift.isLead = normalized.isLead;
      applyCatalogAdds(nextStore.settings, normalized.catalogAdds);

      const savedStore = writeStore(nextStore);
      void notifyDiscord(buildShiftDiscordMessage("updated", shift, savedStore, previousShift), { kind: "auto" });
      broadcastEvent("portal", { type: "shift-updated" });
      sendPortalData(res, 200, auth.user, savedStore);
      return;
    }

    if (req.method === "DELETE") {
      const deletedShift = { ...shift };
      preserveTimeEntryHistoryForShift(nextStore.timeEntries, deletedShift, nextStore, {
        detachEntries: true,
        closeOpenEntries: true
      });
      nextStore.shifts = nextStore.shifts.filter((entry) => entry.id !== shiftId);
      nextStore.swapRequests = nextStore.swapRequests.filter((entry) => entry.shiftId !== shiftId);
      nextStore.chatMessages = nextStore.chatMessages.map((entry) =>
        entry.relatedShiftId === shiftId ? { ...entry, relatedShiftId: "" } : entry
      );

      const savedStore = writeStore(nextStore);
      void notifyDiscord(buildShiftDiscordMessage("deleted", deletedShift, auth.store), { kind: "auto" });
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
      rating: normalized.rating,
      createdAt: new Date().toISOString()
    });

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "request-created" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  const requestMatch = url.pathname.match(/^\/api\/requests\/([^/]+)$/);
  if (requestMatch && req.method === "PATCH") {
    const requestId = decodeURIComponent(requestMatch[1]);
    const nextStore = structuredClone(auth.store);
    const request = nextStore.requests.find((entry) => entry.id === requestId);

    if (!request) {
      sendJson(res, 404, { error: "Rueckmeldung nicht gefunden." });
      return;
    }

    const body = await readJson(req);
    if (canCoordinateModeration(auth.user)) {
      request.status = validateRequestStatus(body.status);
      request.adminNote = String(body.adminNote || "").trim();
      request.adminRespondedAt = new Date().toISOString();
      request.memberDecision = "pending";
      request.memberDecisionAt = "";
    } else {
      if (request.userId !== auth.user.id) {
        sendJson(res, 403, { error: "Du kannst nur auf deine eigenen Rueckmeldungen antworten." });
        return;
      }

      const action = String(body.action || "").trim();
      if (!["accepted", "declined"].includes(action)) {
        sendJson(res, 400, { error: "Ungueltige Rueckmeldung auf die Leitungsantwort." });
        return;
      }

      request.memberDecision = action;
      request.memberDecisionAt = new Date().toISOString();
    }

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
      imageUrl: normalized.imageUrl,
      createdAt: new Date().toISOString()
    });

    const savedStore = writeStore(nextStore);
    void notifyDiscord(buildAnnouncementDiscordMessage(savedStore.announcements[0], auth.user), { kind: "auto" });
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

  if (req.method === "PUT" && url.pathname === "/api/system-notice") {
    requireRole(auth.user, "planner");
    const body = await readJson(req);
    const normalized = validateSystemNoticePayload(body);
    const nextStore = structuredClone(auth.store);

    nextStore.systemNotice = {
      ...normalized,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.user.id
    };

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "system-notice-updated" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/system-notice") {
    requireRole(auth.user, "planner");
    const nextStore = structuredClone(auth.store);
    nextStore.systemNotice = buildEmptySystemNotice();
    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "system-notice-cleared" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/promo-video") {
    requireRole(auth.user, "planner");
    const body = await readJson(req);
    const normalized = validatePromoVideoPayload(body);
    const nextStore = structuredClone(auth.store);

    nextStore.promoVideo = {
      ...normalized,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.user.id
    };

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "promo-video-updated" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/promo-video") {
    requireRole(auth.user, "planner");
    const nextStore = structuredClone(auth.store);
    nextStore.promoVideo = buildEmptyPromoVideo();
    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "promo-video-cleared" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson(req);
    const normalized = validateChatPayload(body, auth.user, auth.store);
    if (hasRecentDuplicateChatMessage(auth.store, auth.user.id, normalized)) {
      sendPortalData(res, 200, auth.user, auth.store);
      return;
    }
    enforceMessageCooldown(auth.user.id, `chat:${normalized.channel}`);
    const nextStore = structuredClone(auth.store);

    nextStore.chatMessages.unshift({
      id: crypto.randomUUID(),
      authorId: auth.user.id,
      channel: normalized.channel,
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

  if (req.method === "POST" && url.pathname === "/api/chat/trim") {
    requireRole(auth.user, "planner");
    const body = await readJson(req);
    const channel = validateChatTrimChannel(body.channel);
    const count = validateTrimCount(body.count);
    const nextStore = structuredClone(auth.store);

    nextStore.chatMessages = removeNewestMatchingEntries(
      nextStore.chatMessages,
      count,
      (entry) => entry.channel === channel
    );

    const savedStore = writeStore(nextStore);
    broadcastEvent("chat", { ok: true, type: "trim", channel });
    broadcastEvent("portal", { type: "chat-trim", channel });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat/clear") {
    requireRole(auth.user, "planner");
    const body = await readJson(req);
    const channel = validateChatTrimChannel(body.channel);
    const nextStore = structuredClone(auth.store);

    nextStore.chatMessages = (nextStore.chatMessages || []).filter((entry) => entry.channel !== channel);

    const savedStore = writeStore(nextStore);
    broadcastEvent("chat", { ok: true, type: "clear", channel });
    broadcastEvent("portal", { type: "chat-clear", channel });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/direct-messages") {
    const body = await readJson(req);
    const normalized = validateDirectMessagePayload(body, auth.user, auth.store);
    if (hasRecentDuplicateDirectMessage(auth.store, auth.user.id, normalized)) {
      sendPortalData(res, 200, auth.user, auth.store);
      return;
    }
    enforceMessageCooldown(auth.user.id, "direct-message");
    const nextStore = structuredClone(auth.store);

    nextStore.directMessages.unshift({
      id: crypto.randomUUID(),
      senderId: auth.user.id,
      recipientId: normalized.recipientId,
      content: normalized.content,
      createdAt: new Date().toISOString()
    });

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "direct-message" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/direct-messages/trim") {
    requireRole(auth.user, "planner");
    const body = await readJson(req);
    const count = validateTrimCount(body.count);
    const nextStore = structuredClone(auth.store);

    nextStore.directMessages = removeNewestMatchingEntries(nextStore.directMessages, count, () => true);

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "direct-message-trim" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/direct-messages/clear") {
    requireRole(auth.user, "planner");
    const nextStore = structuredClone(auth.store);
    nextStore.directMessages = [];

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "direct-message-clear" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/forum-threads") {
    const body = await readJson(req);
    const normalized = validateForumThreadPayload(body, auth.store);
    const nextStore = structuredClone(auth.store);

    nextStore.forumThreads.unshift({
      id: crypto.randomUUID(),
      authorId: auth.user.id,
      title: normalized.title,
      body: normalized.body,
      category: normalized.category,
      creatorCommunityId: normalized.creatorCommunityId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      replies: []
    });

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "forum-thread" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  const forumReplyMatch = url.pathname.match(/^\/api\/forum-threads\/([^/]+)\/replies$/);
  if (forumReplyMatch && req.method === "POST") {
    const threadId = decodeURIComponent(forumReplyMatch[1]);
    const body = await readJson(req);
    const normalized = validateForumReplyPayload(body);
    const nextStore = structuredClone(auth.store);
    const thread = (nextStore.forumThreads || []).find((entry) => entry.id === threadId);

    if (!thread) {
      sendJson(res, 404, { error: "Forenbeitrag nicht gefunden." });
      return;
    }

    thread.replies = Array.isArray(thread.replies) ? thread.replies : [];
    thread.replies.push({
      id: crypto.randomUUID(),
      authorId: auth.user.id,
      body: normalized.body,
      createdAt: new Date().toISOString()
    });
    thread.updatedAt = new Date().toISOString();

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "forum-reply" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/warnings") {
    requireModerationCoordinator(auth.user);
    const body = await readJson(req);
    const normalized = validateWarningPayload(body, auth.store);
    const nextStore = structuredClone(auth.store);

    nextStore.warnings.unshift({
      id: crypto.randomUUID(),
      userId: normalized.userId,
      reason: normalized.reason,
      createdAt: new Date().toISOString(),
      createdBy: auth.user.id,
      status: "active",
      acknowledgedAt: "",
      clearedAt: "",
      clearedBy: ""
    });

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "warning-created" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  const warningMatch = url.pathname.match(/^\/api\/warnings\/([^/]+)$/);
  if (warningMatch && req.method === "PATCH") {
    const warningId = decodeURIComponent(warningMatch[1]);
    const body = await readJson(req);
    const nextStore = structuredClone(auth.store);
    const warning = (nextStore.warnings || []).find((entry) => entry.id === warningId);

    if (!warning) {
      sendJson(res, 404, { error: "Verwarnung nicht gefunden." });
      return;
    }

    const action = String(body.action || "").trim();
    if (action === "acknowledge") {
      if (warning.userId !== auth.user.id) {
        sendJson(res, 403, { error: "Du kannst nur deine eigenen Verwarnungen bestaetigen." });
        return;
      }
      warning.acknowledgedAt = warning.acknowledgedAt || new Date().toISOString();
    } else if (action === "clear") {
      requireModerationCoordinator(auth.user);
      warning.status = "cleared";
      warning.clearedAt = new Date().toISOString();
      warning.clearedBy = auth.user.id;
    } else {
      sendJson(res, 400, { error: "Ungueltige Verwarnungsaktion." });
      return;
    }

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "warning-updated" });
    sendPortalData(res, 200, auth.user, savedStore);
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

      preserveTimeEntryHistoryForShift(nextStore.timeEntries, shift, nextStore, {
        detachEntries: true,
        closeOpenEntries: true
      });
      shift.memberId = decision.candidateId;
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

    const shiftEnd = getShiftEndDateTime(shift);
    if (shiftEnd && Date.now() > shiftEnd.getTime()) {
      sendJson(res, 400, { error: "Diese Schicht ist bereits beendet." });
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
      checkOutAt: "",
      shiftSnapshot: buildTimeEntryShiftSnapshot(shift, auth.store)
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

    if (!entry.shiftSnapshot) {
      const liveShift = nextStore.shifts.find((item) => item.id === shiftId);
      entry.shiftSnapshot = buildTimeEntryShiftSnapshot(liveShift, nextStore);
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
    const blockedState = normalizeBlockedPayload(body, false, "");

    nextStore.users.push({
      id: crypto.randomUUID(),
      username: normalized.username,
      displayName: normalized.displayName,
      role: normalized.role,
      vrchatName: normalized.vrchatName,
      discordName: normalized.discordName,
      avatarUrl: normalized.avatarUrl,
      bio: normalized.bio,
      contactNote: normalized.contactNote,
      creatorBlurb: normalized.creatorBlurb,
      creatorLinks: normalized.creatorLinks,
      creatorVisible: normalized.creatorVisible,
      creatorSlug: normalized.creatorSlug,
      creatorApplicationStatus: normalized.creatorApplicationStatus,
      creatorFollowerCount: normalized.creatorFollowerCount,
      creatorPrimaryPlatform: normalized.creatorPrimaryPlatform,
      creatorProofUrl: normalized.creatorProofUrl,
      creatorApplicationNote: normalized.creatorApplicationNote,
      creatorReviewNote: normalized.creatorReviewNote,
      creatorReviewedAt: normalized.creatorReviewedAt,
      creatorReviewedBy: normalized.creatorReviewedBy,
      creatorCommunityName: normalized.creatorCommunityName,
      creatorCommunitySummary: normalized.creatorCommunitySummary,
      creatorCommunityInviteUrl: normalized.creatorCommunityInviteUrl,
      creatorPresence: normalized.creatorPresence,
      creatorPresenceText: normalized.creatorPresenceText,
      creatorPresenceUrl: normalized.creatorPresenceUrl,
      creatorPresenceUpdatedAt: normalized.creatorPresenceUpdatedAt,
      weeklyHoursCapacity: normalized.weeklyHoursCapacity,
      weeklyDaysCapacity: normalized.weeklyDaysCapacity,
      overtimeAdjustments: [],
      availabilitySchedule: normalized.availabilitySchedule,
      availabilitySlots: normalized.availabilitySlots,
      availabilityUpdatedAt: normalized.availabilityUpdatedAt,
      lastLoginAt: "",
      lastSeenAt: "",
      passwordHash: normalized.passwordHash,
      isBlocked: blockedState.isBlocked,
      blockReason: blockedState.blockReason,
      blockedAt: blockedState.isBlocked ? new Date().toISOString() : "",
      blockedBy: blockedState.isBlocked ? auth.user.id : ""
    });

  const savedStore = writeStore(nextStore);
  broadcastEvent("portal", { type: "user-created" });
  sendPortalData(res, 201, auth.user, savedStore);
  return;
  }

  const overtimeAdjustmentMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/overtime-adjustments$/);
  if (overtimeAdjustmentMatch && req.method === "POST") {
    requireModerationCoordinator(auth.user);
    const userId = decodeURIComponent(overtimeAdjustmentMatch[1]);
    const body = await readJson(req);
    const nextStore = structuredClone(auth.store);
    const target = nextStore.users.find((entry) => entry.id === userId);

    if (!target) {
      sendJson(res, 404, { error: "Benutzer nicht gefunden." });
      return;
    }

    const mode = String(body.mode || "deduct").trim().toLowerCase();
    if (!["deduct", "credit"].includes(mode)) {
      sendJson(res, 400, { error: "Ungueltiger Ausgleichsmodus." });
      return;
    }

    const absoluteHours = Math.abs(normalizeOvertimeAdjustmentHours(body.hours));
    if (!absoluteHours) {
      sendJson(res, 400, { error: "Bitte eine gueltige Stundenanzahl fuer den Ueberstunden-Ausgleich angeben." });
      return;
    }

    const note = normalizeOvertimeAdjustmentNote(body.note);
    target.overtimeAdjustments = normalizeOvertimeAdjustments(target.overtimeAdjustments);
    target.overtimeAdjustments.unshift({
      id: crypto.randomUUID(),
      hours: mode === "deduct" ? -absoluteHours : absoluteHours,
      note,
      createdAt: new Date().toISOString(),
      createdBy: auth.user.id
    });

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "overtime-adjusted" });
    sendPortalData(res, 200, auth.user, savedStore);
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
      const nextRole = body.role ? validateRole(body.role) : target.role;
      const blockedState = normalizeBlockedPayload(body, Boolean(target.isBlocked), target.blockReason || "");

      ensureAdminAccessStillExists(nextStore.users, target, nextRole, blockedState.isBlocked, auth.user.id);
      if (body.role) {
        target.role = nextRole;
      }

      applyUserIdentityUpdates(nextStore.users, target, body, true);
      applyUserBlockState(target, blockedState, auth.user.id);

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

  if (req.method === "POST" && url.pathname === "/api/events") {
    requireModerationCoordinator(auth.user);
    const body = await readJson(req);
    const normalized = validateEventPayload(body, auth.user);
    const nextStore = structuredClone(auth.store);

    nextStore.events = Array.isArray(nextStore.events) ? nextStore.events : [];
    nextStore.events.unshift({
      id: crypto.randomUUID(),
      ...normalized,
      createdAt: new Date().toISOString(),
      createdBy: auth.user.id
    });

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "event-created" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
  if (eventMatch && req.method === "DELETE") {
    requireModerationCoordinator(auth.user);
    const eventId = decodeURIComponent(eventMatch[1]);
    const nextStore = structuredClone(auth.store);
    nextStore.events = (nextStore.events || []).filter((entry) => entry.id !== eventId);
    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "event-deleted" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/feed-posts") {
    const body = await readJson(req);
    const normalized = validateFeedPostPayload(body, auth.store);
    if (hasRecentDuplicateFeedPost(auth.store, auth.user.id, normalized)) {
      sendPortalData(res, 200, auth.user, auth.store);
      return;
    }
    enforceMessageCooldown(auth.user.id, "feed-post");
    const nextStore = structuredClone(auth.store);

    nextStore.feedPosts = Array.isArray(nextStore.feedPosts) ? nextStore.feedPosts : [];
    nextStore.feedPosts.unshift({
      id: crypto.randomUUID(),
      authorId: auth.user.id,
      content: normalized.content,
      imageUrl: normalized.imageUrl,
      creatorCommunityId: normalized.creatorCommunityId,
      createdAt: new Date().toISOString(),
      reactions: buildEmptyFeedReactions()
    });

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "feed-post" });
    sendPortalData(res, 201, auth.user, savedStore);
    return;
  }

  const feedReactionMatch = url.pathname.match(/^\/api\/feed-posts\/([^/]+)\/reactions$/);
  if (feedReactionMatch && req.method === "PATCH") {
    const postId = decodeURIComponent(feedReactionMatch[1]);
    const body = await readJson(req);
    const emoji = validateFeedReaction(body.emoji);
    const nextStore = structuredClone(auth.store);
    const post = (nextStore.feedPosts || []).find((entry) => entry.id === postId);

    if (!post) {
      sendJson(res, 404, { error: "Feed-Beitrag nicht gefunden." });
      return;
    }

    post.reactions = normalizeFeedReactionMap(post.reactions);
    const bucket = Array.isArray(post.reactions[emoji]) ? post.reactions[emoji] : [];
    post.reactions[emoji] = bucket.includes(auth.user.id)
      ? bucket.filter((userId) => userId !== auth.user.id)
      : [...bucket, auth.user.id];

    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "feed-reaction" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  const feedPostMatch = url.pathname.match(/^\/api\/feed-posts\/([^/]+)$/);
  if (feedPostMatch && req.method === "DELETE") {
    const postId = decodeURIComponent(feedPostMatch[1]);
    const nextStore = structuredClone(auth.store);
    const post = (nextStore.feedPosts || []).find((entry) => entry.id === postId);

    if (!post) {
      sendJson(res, 404, { error: "Feed-Beitrag nicht gefunden." });
      return;
    }

    const canDelete = post.authorId === auth.user.id || ["planner", "admin"].includes(auth.user.role);
    if (!canDelete) {
      sendJson(res, 403, { error: "Du darfst diesen Beitrag nicht loeschen." });
      return;
    }

    nextStore.feedPosts = nextStore.feedPosts.filter((entry) => entry.id !== postId);
    const savedStore = writeStore(nextStore);
    broadcastEvent("portal", { type: "feed-deleted" });
    sendPortalData(res, 200, auth.user, savedStore);
    return;
  }

  sendJson(res, 404, { error: "API-Route nicht gefunden." });
}

function ensureFileStoreExists() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(normalizeStore(buildDefaultStore()), null, 2));
  }
}

function readFileStore() {
  ensureFileStoreExists();

  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8") || "{}");
  } catch {
    return {};
  }
}

function getPortalStorePool() {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) return null;

  if (!PortalPoolCtor) {
    ({ Pool: PortalPoolCtor } = require("pg"));
  }

  if (!portalPool) {
    portalPool = new PortalPoolCtor({
      connectionString,
      ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined
    });
  }

  return portalPool;
}

async function initializePortalStore() {
  const db = getPortalStorePool();

  if (!db) {
    const normalized = normalizeStore(readFileStore());
    fs.writeFileSync(STORE_PATH, JSON.stringify(normalized, null, 2));
    portalStoreCache = normalized;
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS portal_state_store (
      store_key TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const existing = await db.query(
    `SELECT data FROM portal_state_store WHERE store_key = $1`,
    [PORTAL_STORE_KEY]
  );

  if (existing.rows[0]?.data) {
    portalStoreCache = normalizeStore(existing.rows[0].data);
    return;
  }

  const fallback = normalizeStore(readFileStore());
  await db.query(
    `
      INSERT INTO portal_state_store (store_key, data, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (store_key) DO NOTHING
    `,
    [PORTAL_STORE_KEY, JSON.stringify(fallback)]
  );
  portalStoreCache = fallback;
}

async function ensurePortalStoreReady() {
  if (portalStoreCache) return;
  if (!portalStoreInitPromise) {
    portalStoreInitPromise = initializePortalStore();
  }
  await portalStoreInitPromise;
}

function persistPortalStore(normalized) {
  const db = getPortalStorePool();

  if (!db) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(normalized, null, 2));
    return;
  }

  portalStorePersistChain = portalStorePersistChain
    .then(() =>
      db.query(
        `
          INSERT INTO portal_state_store (store_key, data, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (store_key) DO UPDATE
          SET data = EXCLUDED.data,
              updated_at = NOW()
        `,
        [PORTAL_STORE_KEY, JSON.stringify(normalized)]
      )
    )
    .catch((error) => {
      console.error("Portal store persist failed:", error);
    });
}

function buildDefaultStore() {
  const users = [
    buildSeedUser("admin", "System Admin", "admin", "admin123!", "System Admin", "system-admin", "", "Leitet das SONARA Portal und prueft neue Team-Updates."),
    buildSeedUser("lyra", "Lyra", "planner", "plan123!", "Lyra", "lyra_plan", "", "Koordiniert den Staff-Bereich und Events."),
    buildSeedUser("black", "Black", "moderation_lead", "lead123!", "Black", "black_vrc", "", "Behaelt Moderation, Auslastung und Schichtverteilung im Blick."),
    buildSeedUser("aiko", "Aiko", "moderator", "mod123!", "Aiko", "aiko_vrc", "", "Fokus auf Begruessung und Community-Einstieg."),
    buildSeedUser("mika", "Mika", "moderator", "mod123!", "Mika", "mika_vrc", "", "Hat die Public-Bereiche und Zwischenschichten im Blick."),
    buildSeedUser("ren", "Ren", "moderator", "mod123!", "Ren", "ren_vrc", "", "Betreut gern Events und Briefings."),
    buildSeedUser("sora", "Sora", "moderator", "mod123!", "Sora", "sora_vrc", "", "Support und Koordination fuer spaete Stunden."),
    buildSeedUser("nuri", "Nuri", "member", "member123!", "Nuri", "nuri_vrc", "", "Aktives Community-Mitglied mit Fokus auf Events.")
  ];

  const userByName = new Map(users.map((entry) => [entry.displayName, entry.id]));
  const today = todayKey();

  return {
    users,
    settings: {
      shiftTypes: ["Kernschicht", "Zwischenschicht", "Abloese", "Uebergang", "Event"],
      worlds: ["Community Hub", "Sunset Lounge", "Event Arena", "Support Room"],
      tasks: ["Begruessung", "Patrouille", "Support", "Event-Leitung", "Koordination"]
    },
    systemNotice: buildEmptySystemNotice(),
    promoVideo: buildEmptyPromoVideo(),
    shifts: [
      buildShift(addDays(today, 0), "12:00", "16:00", "Kernschicht", "Community Hub", "Begruessung", userByName.get("Aiko"), "Neue User zuerst einsammeln.", true),
      buildShift(addDays(today, 0), "14:00", "18:00", "Zwischenschicht", "Sunset Lounge", "Patrouille", userByName.get("Mika"), "Fokus auf Stoerungen in Public Bereichen."),
      buildShift(addDays(today, 1), "20:00", "00:00", "Event", "Event Arena", "Event-Leitung", userByName.get("Ren"), "Team 15 Minuten frueher briefen.", true),
      buildShift(addDays(today, 2), "16:00", "20:00", "Kernschicht", "Support Room", "Support", userByName.get("Sora"), "Meldungen sammeln und weiterreichen."),
      buildShift(addDays(today, 3), "18:00", "22:00", "Uebergang", "Community Hub", "Koordination", userByName.get("Aiko"), "Kurzes Debriefing im Anschluss.", true)
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
        rating: 4,
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
        rating: 5,
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
        imageUrl: "",
        createdAt: new Date().toISOString()
      },
      {
        id: crypto.randomUUID(),
        title: "Event-Woche",
        body: "Fuer Events bitte 10 Minuten vor Schichtbeginn online sein. Ein- und Ausstempeln ist ab sofort Pflicht fuer alle Moderatoren.",
        pinned: false,
        authorId: users[0].id,
        imageUrl: "",
        createdAt: new Date().toISOString()
      }
    ],
    chatMessages: [],
    swapRequests: [],
    timeEntries: []
  };
}

function buildSeedUser(
  username,
  displayName,
  role,
  password,
  vrchatName = "",
  discordName = "",
  avatarUrl = "",
  bio = "",
  weeklyHoursCapacity = 0,
  weeklyDaysCapacity = 0
) {
  return {
    id: crypto.randomUUID(),
    username,
    displayName,
    role,
    vrchatName,
    discordName,
    avatarUrl,
    bio,
    weeklyHoursCapacity: normalizeWeeklyHoursCapacity(weeklyHoursCapacity),
    weeklyDaysCapacity: normalizeWeeklyDaysCapacity(weeklyDaysCapacity),
    overtimeAdjustments: [],
    creatorWebhookToken: createCreatorWebhookToken(),
    creatorAutomationLastAt: "",
    creatorAutomationLastSource: "",
    lastLoginAt: "",
    lastSeenAt: "",
    passwordHash: hashPassword(password)
  };
}

function buildShift(date, startTime, endTime, shiftType, world, task, memberId, notes = "", isLead = false) {
  return {
    id: crypto.randomUUID(),
    date,
    startTime,
    endTime,
    shiftType,
    world,
    task,
    memberId,
    notes,
    isLead: Boolean(isLead)
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
    systemNotice: normalizeSystemNotice(store.systemNotice),
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
  const usedCreatorSlugs = new Set();

  for (const entry of users) {
    const username = normalizeUsername(entry.username);
    const fallbackDisplayName = String(entry.displayName || "").trim();
    const vrchatName = String(entry.vrchatName || fallbackDisplayName).trim();
    const displayName = vrchatName || fallbackDisplayName;
    const discordName = String(entry.discordName || username).trim();
    const avatarUrl = normalizeOptionalUrl(entry.avatarUrl);
    const bio = String(entry.bio || "").trim();
    const passwordHash = String(entry.passwordHash || "").trim();
    const normalizedRole = entry.role === "viewer" ? "moderator" : entry.role;
    const role = ["member", "moderator", "planner", "admin"].includes(normalizedRole) ? normalizedRole : "member";

    if (!username || !displayName || !vrchatName || !discordName || !passwordHash || usedUsernames.has(username)) continue;

    usedUsernames.add(username);
    normalized.push({
      id: String(entry.id || crypto.randomUUID()),
      username,
      displayName,
      role,
      vrchatName,
      discordName,
      avatarUrl,
      bio,
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
      role: "moderator",
      vrchatName: name,
      discordName: username,
      avatarUrl: "",
      bio: "",
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
    .map((entry) => {
      const task = String(entry.task || "").trim();
      return {
        id: String(entry.id || crypto.randomUUID()),
        date: String(entry.date || "").trim(),
        startTime: normalizeTimeValue(entry.startTime) || suggestLegacyShiftStart(entry.shiftType),
        endTime: normalizeTimeValue(entry.endTime) || addHoursToTime(normalizeTimeValue(entry.startTime) || suggestLegacyShiftStart(entry.shiftType), 4),
        shiftType: String(entry.shiftType || "").trim(),
        world: String(entry.world || "").trim(),
        task,
        memberId: String(entry.memberId || "").trim(),
        notes: String(entry.notes || "").trim(),
        isLead: entry?.isLead === undefined ? /leitung/i.test(task) : normalizeBooleanInput(entry.isLead)
      };
    })
    .filter(
      (entry) =>
        isDateKey(entry.date) &&
        isTimeValue(entry.startTime) &&
        isTimeValue(entry.endTime) &&
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
          startTime: suggestLegacyShiftStart(shiftType),
          endTime: addHoursToTime(suggestLegacyShiftStart(shiftType), 4),
          shiftType,
          world,
          task: slot?.name || slot?.task || settings.tasks[0],
          memberId,
          notes: slot?.task || "",
          isLead: /leitung/i.test(String(slot?.name || slot?.task || ""))
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
      rating: normalizeRating(entry.rating),
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
      imageUrl: normalizeOptionalUrl(entry.imageUrl),
      createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString()
    }))
    .filter((entry) => entry.title && entry.body);
}

function buildEmptySystemNotice() {
  return {
    enabled: false,
    tone: "warning",
    title: "",
    body: "",
    contactHint: "",
    updatedAt: "",
    updatedBy: ""
  };
}

function buildEmptyPromoVideo() {
  return {
    enabled: false,
    title: "",
    intro: "",
    url: "",
    updatedAt: "",
    updatedBy: ""
  };
}

function normalizeSystemNoticeTone(value) {
  return ["info", "warning", "danger"].includes(value) ? value : "warning";
}

function normalizeSystemNotice(source) {
  const fallback = buildEmptySystemNotice();
  if (!source || typeof source !== "object") return fallback;

  return {
    enabled: normalizeBooleanInput(source.enabled),
    tone: normalizeSystemNoticeTone(String(source.tone || "").trim().toLowerCase()),
    title: String(source.title || "").trim().slice(0, 120),
    body: String(source.body || "").trim().slice(0, 1200),
    contactHint: String(source.contactHint || "").trim().slice(0, 220),
    updatedAt: isIsoDate(source.updatedAt) ? source.updatedAt : "",
    updatedBy: String(source.updatedBy || "").trim()
  };
}

function decorateSystemNotice(source, store) {
  const normalized = normalizeSystemNotice(source);
  return {
    ...normalized,
    updatedByName: normalized.updatedBy ? findUserName(store.users || [], normalized.updatedBy) : ""
  };
}

function normalizePromoVideo(source) {
  const fallback = buildEmptyPromoVideo();
  if (!source || typeof source !== "object") return fallback;

  return {
    enabled: normalizeBooleanInput(source.enabled),
    title: String(source.title || "").trim().slice(0, 120),
    intro: String(source.intro || "").trim().slice(0, 500),
    url: normalizeExternalLink(source.url),
    updatedAt: isIsoDate(source.updatedAt) ? source.updatedAt : "",
    updatedBy: String(source.updatedBy || "").trim()
  };
}

function decoratePromoVideo(source, store) {
  const normalized = normalizePromoVideo(source);
  return {
    ...normalized,
    updatedByName: normalized.updatedBy ? findUserName(store.users || [], normalized.updatedBy) : ""
  };
}

function createCreatorWebhookToken() {
  return crypto.randomBytes(24).toString("hex");
}

function normalizeCreatorWebhookToken(value, options = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (/^[a-f0-9]{32,64}$/.test(normalized)) return normalized;
  return options.allowEmpty ? "" : createCreatorWebhookToken();
}

function normalizeCreatorAutomationSource(value) {
  return String(value || "").trim().slice(0, 80);
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

function normalizeTimeEntryShiftSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;

  const normalized = {
    id: String(snapshot.id || "").trim(),
    date: isDateKey(snapshot.date) ? String(snapshot.date).trim() : "",
    startTime: normalizeTimeValue(snapshot.startTime),
    endTime: normalizeTimeValue(snapshot.endTime),
    shiftType: String(snapshot.shiftType || "").trim(),
    world: String(snapshot.world || "").trim(),
    task: String(snapshot.task || "").trim(),
    memberId: String(snapshot.memberId || "").trim(),
    memberName: String(snapshot.memberName || "").trim(),
    notes: String(snapshot.notes || "").trim(),
    isLead: normalizeBooleanInput(snapshot.isLead)
  };

  if (!normalized.date || !normalized.startTime || !normalized.endTime) return null;
  if (!normalized.shiftType || !normalized.world || !normalized.task) return null;
  return normalized;
}

function buildTimeEntryShiftSnapshot(shift, store) {
  if (!shift) return null;

  return normalizeTimeEntryShiftSnapshot({
    id: shift.id,
    date: shift.date,
    startTime: shift.startTime,
    endTime: shift.endTime,
    shiftType: shift.shiftType,
    world: shift.world,
    task: shift.task,
    memberId: shift.memberId,
    memberName: findUserName(store.users || [], shift.memberId),
    notes: shift.notes || "",
    isLead: shift.isLead
  });
}

function normalizeTimeEntries(entries, users, shifts) {
  const validUserIds = new Set(users.map((entry) => entry.id));

  return entries
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      userId: String(entry.userId || "").trim(),
      shiftId: String(entry.shiftId || "").trim(),
      checkInAt: isIsoDate(entry.checkInAt) ? entry.checkInAt : "",
      checkOutAt: isIsoDate(entry.checkOutAt) ? entry.checkOutAt : "",
      shiftSnapshot: normalizeTimeEntryShiftSnapshot(entry.shiftSnapshot)
    }))
    .filter((entry) => validUserIds.has(entry.userId) && entry.checkInAt && (entry.shiftId || entry.shiftSnapshot));
}

function getShiftDateTime(dateKey, timeValue) {
  if (!isDateKey(dateKey) || !isTimeValue(timeValue)) return null;
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const [hours, minutes] = String(timeValue).split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function getShiftEndDateTime(shift) {
  const start = getShiftDateTime(shift?.date, shift?.startTime);
  const end = getShiftDateTime(shift?.date, shift?.endTime);
  if (!start || !end) return null;
  if (end <= start) {
    end.setDate(end.getDate() + 1);
  }
  return end;
}

function preserveTimeEntryHistoryForShift(timeEntries, shift, store, options = {}) {
  if (!shift || !Array.isArray(timeEntries)) return false;

  const detachEntries = Boolean(options.detachEntries);
  const closeOpenEntries = Boolean(options.closeOpenEntries);
  const snapshot = buildTimeEntryShiftSnapshot(shift, store);
  let changed = false;

  for (const entry of timeEntries) {
    if (entry.shiftId !== shift.id) continue;

    if (!entry.shiftSnapshot && snapshot) {
      entry.shiftSnapshot = snapshot;
      changed = true;
    }

    if (closeOpenEntries && !entry.checkOutAt) {
      entry.checkOutAt = new Date().toISOString();
      changed = true;
    }

    if (detachEntries) {
      entry.shiftId = "";
      changed = true;
    }
  }

  return changed;
}

function hydrateHistoricalTimeEntries(store) {
  if (!store || !Array.isArray(store.timeEntries)) return false;

  let changed = false;

  for (const entry of store.timeEntries) {
    const liveShift = entry.shiftId ? store.shifts.find((shift) => shift.id === entry.shiftId) : null;
    if (!entry.shiftSnapshot && liveShift) {
      entry.shiftSnapshot = buildTimeEntryShiftSnapshot(liveShift, store);
      changed = true;
    }

  }

  return changed;
}

function getCurrentWeekStartKey(referenceDate = new Date()) {
  const start = new Date(referenceDate);
  start.setHours(12, 0, 0, 0);
  const weekday = start.getDay();
  const deltaToMonday = weekday === 0 ? -6 : 1 - weekday;
  start.setDate(start.getDate() + deltaToMonday);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}

function pruneArchivedCompletedShifts(store, referenceDate = new Date()) {
  if (!store || !Array.isArray(store.shifts) || !Array.isArray(store.timeEntries)) return false;

  const currentWeekStartKey = getCurrentWeekStartKey(referenceDate);
  const shiftsToArchive = store.shifts.filter((shift) => {
    if (!shift?.id || !shift?.date || shift.date >= currentWeekStartKey) return false;
    const relatedEntries = store.timeEntries.filter((entry) => entry.shiftId === shift.id);
    if (!relatedEntries.length) return false;
    if (relatedEntries.some((entry) => !entry.checkOutAt)) return false;
    return relatedEntries.some((entry) => entry.checkOutAt);
  });

  if (!shiftsToArchive.length) return false;

  for (const shift of shiftsToArchive) {
    preserveTimeEntryHistoryForShift(store.timeEntries, shift, store, {
      detachEntries: true,
      closeOpenEntries: false
    });
  }

  const archivedIds = new Set(shiftsToArchive.map((shift) => shift.id));
  store.shifts = store.shifts.filter((shift) => !archivedIds.has(shift.id));
  store.swapRequests = Array.isArray(store.swapRequests) ? store.swapRequests.filter((entry) => !archivedIds.has(entry.shiftId)) : [];
  store.chatMessages = Array.isArray(store.chatMessages)
    ? store.chatMessages.map((entry) => (archivedIds.has(entry.relatedShiftId) ? { ...entry, relatedShiftId: "" } : entry))
    : [];
  return true;
}

function readStore() {
  if (!portalStoreCache) {
    const fallback = normalizeStore(readFileStore());
    portalStoreCache = fallback;
  }

  const hydratedHistory = hydrateHistoricalTimeEntries(portalStoreCache);
  const prunedArchivedShifts = pruneArchivedCompletedShifts(portalStoreCache);
  if (hydratedHistory || prunedArchivedShifts) {
    persistPortalStore(portalStoreCache);
  }

  return structuredClone(portalStoreCache);
}

function writeStore(store) {
  const normalized = normalizeStore(store);
  pruneArchivedCompletedShifts(normalized);
  portalStoreCache = normalized;
  persistPortalStore(normalized);
  return structuredClone(normalized);
}

function requireAuth(req) {
  const sessionId = getSessionId(req);
  if (!sessionId) return null;

  const store = readStore();
  const signedSession = parseSignedSession(sessionId);
  if (signedSession) {
    const user = store.users.find((entry) => entry.id === signedSession.userId);
    return user && !user.isBlocked ? { user, store } : null;
  }

  if (!sessionStore.has(sessionId)) return null;

  const session = sessionStore.get(sessionId);
  const user = store.users.find((entry) => entry.id === session.userId);

  if (!user || user.isBlocked) {
    sessionStore.delete(sessionId);
    return null;
  }

  return { user, store };
}

function requireRole(user, role) {
  const order = { member: 1, moderator: 2, moderation_lead: 3, planner: 4, admin: 5 };
  if (order[user.role] < order[role]) {
    const error = new Error("Keine Berechtigung.");
    error.statusCode = 403;
    throw error;
  }
}

function canCoordinateModeration(user) {
  return ["moderation_lead", "planner", "admin"].includes(user?.role);
}

function requireModerationCoordinator(user) {
  if (canCoordinateModeration(user)) return;
  const error = new Error("Keine Berechtigung.");
  error.statusCode = 403;
  throw error;
}

function applyUserPresenceHeartbeat(user, options = {}) {
  if (!user) return false;

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let changed = false;

  if (options.login) {
    user.lastLoginAt = nowIso;
    changed = true;
  }

  const lastSeenAtMs = Date.parse(String(user.lastSeenAt || ""));
  const shouldTouchSeen =
    options.force ||
    !Number.isFinite(lastSeenAtMs) ||
    now - lastSeenAtMs >= USER_ACTIVITY_TOUCH_INTERVAL_MS;

  if (shouldTouchSeen) {
    user.lastSeenAt = nowIso;
    changed = true;
  }

  return changed;
}

function projectDataForRole(user, store) {
  const community = buildCommunityPayload(store);
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
    community,
    announcements,
    chatMessages,
    notifications,
    swapRequests: getSwapRequestsForUser(user, store)
  };

  if (user.role === "member") {
    return {
      ...base,
      requests: store.requests
        .filter((entry) => entry.userId === user.id)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map((entry) => decorateRequest(entry, store))
    };
  }

  if (user.role === "moderator") {
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
    settings: store.settings,
    users: store.users
      .slice()
      .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
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

function buildCommunityPayload(store) {
  const activeUsers = (store.users || []).filter((entry) => !entry.isBlocked);
  const team = activeUsers
    .filter((entry) => entry.role !== "member")
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  const creators = activeUsers
    .filter((entry) => hasVisibleCreatorProfile(entry))
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  return {
    team,
    creators,
    events: getOrderedEvents(store.events || []),
    rules: COMMUNITY_RULES,
    faq: COMMUNITY_FAQ,
    stats: {
      members: activeUsers.filter((entry) => entry.role === "member").length,
      moderators: activeUsers.filter((entry) => entry.role === "moderator" || entry.role === "moderation_lead").length,
      planners: activeUsers.filter((entry) => entry.role === "planner" || entry.role === "admin").length,
      news: store.announcements.length,
      creators: creators.length
    }
  };
}

function normalizeUsers(users, legacyModeratorNames) {
  const normalized = [];
  const usedUsernames = new Set();

  for (const entry of users) {
    const username = normalizeUsername(entry.username);
    const fallbackDisplayName = String(entry.displayName || "").trim();
    const vrchatName = String(entry.vrchatName || fallbackDisplayName).trim();
    const displayName = vrchatName || fallbackDisplayName;
    const discordName = String(entry.discordName || username).trim();
    const avatarUrl = normalizeOptionalUrl(entry.avatarUrl);
    const bio = String(entry.bio || "").trim().slice(0, 600);
    const contactNote = String(entry.contactNote || "").trim().slice(0, 600);
    const creatorBlurb = String(entry.creatorBlurb || "").trim().slice(0, 300);
    const creatorLinks = normalizeCreatorLinks(entry.creatorLinks);
    const creatorVisible = Boolean(entry.creatorVisible && (creatorLinks.length || creatorBlurb));
    const isBlocked = Boolean(entry.isBlocked);
    const blockReason = String(entry.blockReason || "").trim().slice(0, 500);
    const blockedAt = isIsoDate(entry.blockedAt) ? entry.blockedAt : "";
    const blockedBy = String(entry.blockedBy || "").trim();
    const passwordHash = String(entry.passwordHash || "").trim();
    const normalizedRole = entry.role === "viewer" ? "member" : entry.role;
    const role = ["member", "moderator", "planner", "admin"].includes(normalizedRole) ? normalizedRole : "member";

    if (!username || !displayName || !vrchatName || !discordName || !passwordHash || usedUsernames.has(username)) continue;

    usedUsernames.add(username);
    normalized.push({
      id: String(entry.id || crypto.randomUUID()),
      username,
      displayName,
      role,
      vrchatName,
      discordName,
      avatarUrl,
      bio,
      contactNote,
      creatorBlurb,
      creatorLinks,
      creatorVisible,
      isBlocked,
      blockReason,
      blockedAt,
      blockedBy,
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
      role: "moderator",
      vrchatName: name,
      discordName: username,
      avatarUrl: "",
      bio: "",
      contactNote: "",
      creatorBlurb: "",
      creatorLinks: [],
      creatorVisible: false,
      isBlocked: false,
      blockReason: "",
      blockedAt: "",
      blockedBy: "",
      passwordHash: hashPassword("mod123!")
    });
  }

  return normalized;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    vrchatName: user.vrchatName || "",
    discordName: user.discordName || "",
    avatarUrl: user.avatarUrl || "",
    bio: user.bio || "",
    contactNote: user.contactNote || "",
    creatorBlurb: user.creatorBlurb || "",
    creatorLinks: normalizeCreatorLinks(user.creatorLinks),
    creatorVisible: Boolean(user.creatorVisible),
    availabilitySlots: normalizeAvailabilitySlots(user.availabilitySlots)
  };
}

function sanitizeManagedUser(user) {
  return {
    ...sanitizeUser(user),
    weeklyHoursCapacity: normalizeWeeklyHoursCapacity(user.weeklyHoursCapacity),
    weeklyDaysCapacity: normalizeWeeklyDaysCapacity(user.weeklyDaysCapacity),
    overtimeAdjustments: normalizeOvertimeAdjustments(user.overtimeAdjustments),
    availabilitySchedule: normalizeAvailabilitySchedule(user.availabilitySchedule),
    availabilitySlots: normalizeAvailabilitySlots(user.availabilitySlots),
    availabilityUpdatedAt: isIsoDate(user.availabilityUpdatedAt) ? user.availabilityUpdatedAt : "",
    lastLoginAt: isIsoDate(user.lastLoginAt) ? user.lastLoginAt : "",
    lastSeenAt: isIsoDate(user.lastSeenAt) ? user.lastSeenAt : "",
    isBlocked: Boolean(user.isBlocked),
    blockReason: user.blockReason || "",
    blockedAt: user.blockedAt || "",
    blockedBy: user.blockedBy || "",
    creatorApplicationStatus: normalizeCreatorApplicationStatus(user.creatorApplicationStatus),
    creatorFollowerCount: normalizeCreatorFollowerCount(user.creatorFollowerCount),
    creatorPrimaryPlatform: normalizeCreatorPrimaryPlatform(user.creatorPrimaryPlatform),
    creatorProofUrl: normalizeCreatorProofUrl(user.creatorProofUrl),
    creatorApplicationNote: normalizeCreatorApplicationNote(user.creatorApplicationNote),
    creatorReviewNote: normalizeCreatorReviewNote(user.creatorReviewNote),
    creatorReviewedAt: isIsoDate(user.creatorReviewedAt) ? user.creatorReviewedAt : "",
    creatorReviewedBy: user.creatorReviewedBy || "",
    vrchatLinkedAt: isIsoDate(user.vrchatLinkedAt) ? user.vrchatLinkedAt : "",
    vrchatLinkSource: normalizeVrchatLinkSource(user.vrchatLinkSource)
  };
}

function sanitizeSessionUser(user) {
  return {
    ...sanitizeUser(user),
    weeklyHoursCapacity: normalizeWeeklyHoursCapacity(user.weeklyHoursCapacity),
    weeklyDaysCapacity: normalizeWeeklyDaysCapacity(user.weeklyDaysCapacity),
    overtimeAdjustments: normalizeOvertimeAdjustments(user.overtimeAdjustments),
    availabilitySchedule: normalizeAvailabilitySchedule(user.availabilitySchedule),
    availabilitySlots: normalizeAvailabilitySlots(user.availabilitySlots),
    availabilityUpdatedAt: isIsoDate(user.availabilityUpdatedAt) ? user.availabilityUpdatedAt : "",
    lastLoginAt: isIsoDate(user.lastLoginAt) ? user.lastLoginAt : "",
    lastSeenAt: isIsoDate(user.lastSeenAt) ? user.lastSeenAt : "",
    creatorApplicationStatus: normalizeCreatorApplicationStatus(user.creatorApplicationStatus),
    creatorFollowerCount: normalizeCreatorFollowerCount(user.creatorFollowerCount),
    creatorPrimaryPlatform: normalizeCreatorPrimaryPlatform(user.creatorPrimaryPlatform),
    creatorProofUrl: normalizeCreatorProofUrl(user.creatorProofUrl),
    creatorApplicationNote: normalizeCreatorApplicationNote(user.creatorApplicationNote),
    creatorReviewNote: normalizeCreatorReviewNote(user.creatorReviewNote),
    creatorReviewedAt: isIsoDate(user.creatorReviewedAt) ? user.creatorReviewedAt : "",
    creatorWebhookToken: normalizeCreatorWebhookToken(user.creatorWebhookToken),
    creatorAutomationLastAt: isIsoDate(user.creatorAutomationLastAt) ? user.creatorAutomationLastAt : "",
    creatorAutomationLastSource: normalizeCreatorAutomationSource(user.creatorAutomationLastSource),
    vrchatLinkedAt: isIsoDate(user.vrchatLinkedAt) ? user.vrchatLinkedAt : "",
    vrchatLinkSource: normalizeVrchatLinkSource(user.vrchatLinkSource)
  };
}

function buildCommunityPayload(store) {
  const activeUsers = (store.users || []).filter((entry) => !entry.isBlocked);
  const team = activeUsers
    .filter((entry) => entry.role !== "member")
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  const creators = activeUsers
    .filter((entry) => hasVisibleCreatorProfile(entry))
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  return {
    team,
    creators,
    events: getOrderedEvents(store.events || []),
    rules: COMMUNITY_RULES,
    faq: COMMUNITY_FAQ,
    stats: {
      members: activeUsers.filter((entry) => entry.role === "member").length,
      moderators: activeUsers.filter((entry) => entry.role === "moderator" || entry.role === "moderation_lead").length,
      planners: activeUsers.filter((entry) => entry.role === "planner" || entry.role === "admin").length,
      news: store.announcements.length,
      creators: creators.length
    }
  };
}

function projectDataForRole(user, store) {
  const community = buildCommunityPayload(store);
  const notifications = buildNotifications(user, store);
  const announcements = store.announcements
    .slice()
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return new Date(right.createdAt) - new Date(left.createdAt);
    })
    .map((entry) => decorateAnnouncement(entry, store));
  const directory = store.users
    .filter((entry) => !entry.isBlocked)
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);
  const managedUsers = store.users
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeManagedUser);
  const communityChatMessages = getChatMessagesForUser(user, store, "community");
  const staffChatMessages = getChatMessagesForUser(user, store, "staff");
  const feedPosts = (store.feedPosts || []).map((entry) => decorateFeedPost(entry, store));

  const base = {
    community,
    announcements,
    directory,
    calendarShifts: store.shifts.slice().sort(compareShifts).map((entry) => decorateCalendarShift(entry, store)),
    communityChatMessages,
    staffChatMessages,
    chatMessages: user.role === "member" ? communityChatMessages : staffChatMessages,
    directMessages: getDirectMessagesForUser(user, store),
    forumThreads: (store.forumThreads || []).map((entry) => decorateForumThread(entry, store)),
    warnings: getWarningsForUser(user, store),
    notifications,
    swapRequests: getSwapRequestsForUser(user, store),
    feedPosts
  };

  if (user.role === "member") {
    return {
      ...base,
      requests: store.requests
        .filter((entry) => entry.userId === user.id)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map((entry) => decorateRequest(entry, store))
    };
  }

  if (user.role === "moderator") {
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
    settings: store.settings,
    users: managedUsers,
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

function projectDataForRole(user, store) {
  const community = buildCommunityPayload(store);
  const notifications = buildNotifications(user, store);
  const announcements = store.announcements
    .slice()
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return new Date(right.createdAt) - new Date(left.createdAt);
    })
    .map((entry) => decorateAnnouncement(entry, store));
  const directory = store.users
    .filter((entry) => !entry.isBlocked)
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);
  const communityChatMessages = getChatMessagesForUser(user, store, "community");
  const staffChatMessages = getChatMessagesForUser(user, store, "staff");
  const feedPosts = (store.feedPosts || []).map((entry) => decorateFeedPost(entry, store));
  const managedUsers = store.users
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeManagedUser);

  const base = {
    community,
    announcements,
    directory,
    calendarShifts: store.shifts.slice().sort(compareShifts).map((entry) => decorateCalendarShift(entry, store)),
    communityChatMessages,
    staffChatMessages,
    chatMessages: user.role === "member" ? communityChatMessages : staffChatMessages,
    directMessages: getDirectMessagesForUser(user, store),
    forumThreads: (store.forumThreads || []).map((entry) => decorateForumThread(entry, store)),
    warnings: getWarningsForUser(user, store),
    managedWarnings: canCoordinateModeration(user) ? getManagedWarnings(store) : [],
    notifications,
    swapRequests: getSwapRequestsForUser(user, store),
    feedPosts
  };

  if (user.role === "member") {
    return {
      ...base,
      requests: store.requests
        .filter((entry) => entry.userId === user.id)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map((entry) => decorateRequest(entry, store))
    };
  }

  if (user.role === "moderator") {
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
    settings: store.settings,
    users: managedUsers,
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

function normalizeBlockedPayload(body, fallbackBlocked = false, fallbackReason = "") {
  const source = body || {};
  const hasBlockedFlag = Object.prototype.hasOwnProperty.call(source, "blocked") || Object.prototype.hasOwnProperty.call(source, "isBlocked");
  const hasReason = Object.prototype.hasOwnProperty.call(source, "blockReason");
  const isBlocked = hasBlockedFlag ? normalizeBooleanInput(source.blocked ?? source.isBlocked) : Boolean(fallbackBlocked);
  const blockReason = hasReason ? String(source.blockReason || "").trim().slice(0, 500) : String(fallbackReason || "").trim().slice(0, 500);

  if (isBlocked && !blockReason) {
    const error = new Error("Bitte einen Sperrgrund angeben.");
    error.statusCode = 400;
    throw error;
  }

  return {
    isBlocked,
    blockReason: isBlocked ? blockReason : ""
  };
}

function applyUserBlockState(target, blockedState, actingUserId) {
  if (blockedState.isBlocked) {
    target.isBlocked = true;
    target.blockReason = blockedState.blockReason;
    target.blockedAt = target.blockedAt || new Date().toISOString();
    target.blockedBy = actingUserId || target.blockedBy || "";
    return;
  }

  target.isBlocked = false;
  target.blockReason = "";
  target.blockedAt = "";
  target.blockedBy = "";
}

function normalizeBooleanInput(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "on", "yes", "ja"].includes(normalized);
}

function buildBlockedLoginMessage(user) {
  const reason = String(user.blockReason || "").trim();
  return reason ? `Dein Account ist derzeit gesperrt. Grund: ${reason}` : "Dein Account ist derzeit gesperrt.";
}

function ensureAdminAccessStillExists(users, target, nextRole, nextBlocked, actingUserId) {
  if (target.id === actingUserId && nextBlocked) {
    const error = new Error("Du kannst deinen eigenen Account nicht sperren.");
    error.statusCode = 400;
    throw error;
  }

  const remainingAdmins = users.filter((entry) => {
    const role = entry.id === target.id ? nextRole : entry.role;
    const isBlocked = entry.id === target.id ? nextBlocked : Boolean(entry.isBlocked);
    return role === "admin" && !isBlocked;
  });

  if (!remainingAdmins.length) {
    const error = new Error("Mindestens ein aktiver Admin muss erhalten bleiben.");
    error.statusCode = 400;
    throw error;
  }
}

function buildDefaultEvents() {
  return [
    {
      id: "welcome-night",
      title: "Welcome Night",
      world: "Community Hub",
      host: "SONARA Team",
      summary: "Neue Mitglieder kennenlernen, Gruppeninfos teilen und entspannt in den Abend starten.",
      scheduleType: "weekly",
      weekday: 5,
      eventTime: "20:00",
      eventDate: "",
      reminderEnabled: true,
      reminderLeadMinutes: 120,
      createdAt: new Date().toISOString(),
      createdBy: ""
    },
    {
      id: "world-tour",
      title: "World Tour",
      world: "Event Arena",
      host: "Event Team",
      summary: "Gemeinsame Weltreise mit Stopps fuer Screenshots, Spiele und kleine Community-Momente.",
      scheduleType: "weekly",
      weekday: 6,
      eventTime: "21:00",
      eventDate: "",
      reminderEnabled: true,
      reminderLeadMinutes: 120,
      createdAt: new Date().toISOString(),
      createdBy: ""
    },
    {
      id: "late-lounge",
      title: "Late Lounge",
      world: "Sunset Lounge",
      host: "Night Crew",
      summary: "Ruhiger Community-Abend mit Musik, offenen Gespraechen und lockerer Moderationspraesenz.",
      scheduleType: "weekly",
      weekday: 0,
      eventTime: "22:00",
      eventDate: "",
      reminderEnabled: true,
      reminderLeadMinutes: 120,
      createdAt: new Date().toISOString(),
      createdBy: ""
    }
  ].map((entry) => ({
    ...entry,
    dateLabel: buildEventDateLabel(entry)
  }));
}

function normalizeEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      title: String(entry.title || "").trim(),
      world: String(entry.world || "").trim(),
      host: String(entry.host || "").trim(),
      summary: String(entry.summary || "").trim(),
      scheduleType: normalizeEventScheduleType(entry.scheduleType),
      eventDate: isDateKey(entry.eventDate) ? String(entry.eventDate) : "",
      eventTime: normalizeTimeValue(entry.eventTime),
      weekday: normalizeEventWeekday(entry.weekday),
      reminderEnabled: entry.reminderEnabled === undefined ? true : normalizeBooleanInput(entry.reminderEnabled),
      reminderLeadMinutes: normalizePositiveInteger(entry.reminderLeadMinutes, 120),
      dateLabel: String(entry.dateLabel || "").trim(),
      createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString(),
      createdBy: String(entry.createdBy || "").trim()
    }))
    .map((entry) => ({
      ...entry,
      dateLabel: buildEventDateLabel(entry)
    }))
    .filter((entry) => entry.title && entry.world && entry.summary && entry.dateLabel);
}

function normalizeEventScheduleType(value) {
  return String(value || "").trim().toLowerCase() === "weekly" ? "weekly" : "single";
}

function normalizeEventWeekday(value) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 6 ? numeric : -1;
}

function buildEventDateLabel(event) {
  const eventTime = normalizeTimeValue(event.eventTime);
  const timeLabel = eventTime ? `${eventTime} Uhr` : "";

  if (event.scheduleType === "weekly" && normalizeEventWeekday(event.weekday) >= 0) {
    const weekdayLabel = new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(
      getDateForWeekday(normalizeEventWeekday(event.weekday))
    );
    return [capitalizeFirstLetter(weekdayLabel), timeLabel].filter(Boolean).join(" · ");
  }

  if (isDateKey(event.eventDate)) {
    return [formatDisplayDate(event.eventDate), timeLabel].filter(Boolean).join(" · ");
  }

  return String(event.dateLabel || "").trim();
}

function getDateForWeekday(weekday) {
  const base = new Date(2026, 0, 4, 12, 0, 0);
  base.setDate(base.getDate() + weekday);
  return base;
}

function capitalizeFirstLetter(value) {
  const normalized = String(value || "");
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "";
}

function getEventOccurrenceAt(event, referenceDate = new Date()) {
  const eventTime = normalizeTimeValue(event.eventTime);
  const [hours, minutes] = eventTime ? eventTime.split(":").map(Number) : [20, 0];

  if (event.scheduleType === "weekly") {
    const weekday = normalizeEventWeekday(event.weekday);
    if (weekday < 0) return null;

    const candidate = new Date(referenceDate);
    candidate.setSeconds(0, 0);
    candidate.setHours(hours, minutes, 0, 0);
    const delta = (weekday - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + delta);
    if (delta === 0 && candidate < referenceDate) {
      candidate.setDate(candidate.getDate() + 7);
    }
    return candidate;
  }

  if (!isDateKey(event.eventDate)) return null;

  const [year, month, day] = event.eventDate.split("-").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function getOrderedEvents(events, referenceDate = new Date()) {
  return (Array.isArray(events) ? events : [])
    .map((entry) => {
      const occurrenceAt = getEventOccurrenceAt(entry, referenceDate);
      const occurrenceMs = occurrenceAt ? occurrenceAt.getTime() : Number.NaN;
      const isPastSingle = entry.scheduleType !== "weekly" && Number.isFinite(occurrenceMs) && occurrenceMs < referenceDate.getTime();
      return {
        ...entry,
        dateLabel: buildEventDateLabel(entry),
        nextOccurrenceAt: occurrenceAt && !isPastSingle ? occurrenceAt.toISOString() : "",
        scheduleLabel: entry.scheduleType === "weekly" ? "Woechentlich" : "Einmalig"
      };
    })
    .sort((left, right) => {
      const leftTime = left.nextOccurrenceAt ? Date.parse(left.nextOccurrenceAt) : Number.MAX_SAFE_INTEGER;
      const rightTime = right.nextOccurrenceAt ? Date.parse(right.nextOccurrenceAt) : Number.MAX_SAFE_INTEGER;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return new Date(right.createdAt) - new Date(left.createdAt);
    });
}

function buildUpcomingEventNotifications(store, limit = 2, referenceDate = new Date()) {
  return getOrderedEvents(store.events || [], referenceDate)
    .filter((entry) => entry.reminderEnabled && entry.nextOccurrenceAt && Date.parse(entry.nextOccurrenceAt) >= referenceDate.getTime())
    .slice(0, limit)
    .map((entry) => ({
      id: `event-${entry.id}`,
      title: `${entry.scheduleType === "weekly" ? "Wochentermin" : "Event"}: ${entry.title}`,
      body: `${entry.dateLabel} | ${entry.world} | Host: ${entry.host}`,
      tone: "amber",
      createdAt: entry.nextOccurrenceAt,
      category: "event"
    }));
}

function buildEmptyFeedReactions() {
  return {
    like: [],
    heart: [],
    fire: [],
    star: [],
    laugh: []
  };
}

function normalizeFeedReactionMap(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = buildEmptyFeedReactions();
  for (const key of Object.keys(normalized)) {
    normalized[key] = uniqueStrings(Array.isArray(source[key]) ? source[key] : []);
  }
  return normalized;
}

function normalizeFeedPosts(entries, users) {
  const validUserIds = new Set(users.map((entry) => entry.id));
  const validCreatorCommunityIds = new Set(users.filter((entry) => hasVisibleCreatorProfile(entry)).map((entry) => entry.id));

  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      authorId: String(entry.authorId || "").trim(),
      content: String(entry.content || "").trim().slice(0, 1200),
      imageUrl: normalizeOptionalUrl(entry.imageUrl),
      creatorCommunityId: validCreatorCommunityIds.has(String(entry.creatorCommunityId || "").trim()) ? String(entry.creatorCommunityId).trim() : "",
      createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString(),
      reactions: normalizeFeedReactionMap(entry.reactions)
    }))
    .filter((entry) => validUserIds.has(entry.authorId) && (entry.content || entry.imageUrl))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function normalizeRequests(requests, users) {
  const validUserIds = new Set(users.map((entry) => entry.id));
  const validDecisionStates = new Set(["", "pending", "accepted", "declined"]);

  return (Array.isArray(requests) ? requests : [])
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      userId: String(entry.userId || "").trim(),
      type: String(entry.type || "Notiz").trim() || "Notiz",
      date: String(entry.date || "").trim(),
      content: String(entry.content || "").trim(),
      status: validateRequestStatus(entry.status),
      adminNote: String(entry.adminNote || "").trim(),
      rating: normalizeRating(entry.rating),
      createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString(),
      adminRespondedAt: isIsoDate(entry.adminRespondedAt) ? entry.adminRespondedAt : "",
      memberDecision: validDecisionStates.has(String(entry.memberDecision || "").trim()) ? String(entry.memberDecision || "").trim() : "",
      memberDecisionAt: isIsoDate(entry.memberDecisionAt) ? entry.memberDecisionAt : ""
    }))
    .filter((entry) => validUserIds.has(entry.userId) && entry.content);
}

function normalizeStore(store) {
  const defaults = buildDefaultStore();
  const slots = normalizeSlots(store?.slots, defaults.slots);
  const users = normalizeUsers(store?.users || [], slots.map((entry) => entry.name));
  const settings = normalizeSettings(store?.settings || {}, slots);
  const rawShifts = Array.isArray(store?.shifts) ? store.shifts : migrateLegacyPlanning(store || defaults, users, settings);
  const shifts = normalizeShifts(rawShifts, users);
  const events = normalizeEvents(Array.isArray(store?.events) ? store.events : buildDefaultEvents());

  return {
    slots,
    users,
    settings,
    systemNotice: normalizeSystemNotice(store?.systemNotice),
    promoVideo: normalizePromoVideo(store?.promoVideo),
    shifts,
    events,
    requests: normalizeRequests(store?.requests, users),
    announcements: Array.isArray(store?.announcements) ? normalizeAnnouncements(store.announcements, users) : [],
    chatMessages: Array.isArray(store?.chatMessages) ? normalizeChatMessages(store.chatMessages, users, shifts) : [],
    timeEntries: Array.isArray(store?.timeEntries) ? normalizeTimeEntries(store.timeEntries, users, shifts) : [],
    swapRequests: Array.isArray(store?.swapRequests) ? normalizeSwapRequests(store.swapRequests, users, shifts) : [],
    discordStatus: normalizeDiscordStatus(store?.discordStatus),
    vrchatAnalytics: normalizeVrchatAnalytics(store?.vrchatAnalytics),
    directMessages: Array.isArray(store?.directMessages) ? normalizeDirectMessages(store.directMessages, users) : [],
    forumThreads: Array.isArray(store?.forumThreads) ? normalizeForumThreads(store.forumThreads, users) : [],
    warnings: Array.isArray(store?.warnings) ? normalizeWarnings(store.warnings, users) : [],
    feedPosts: normalizeFeedPosts(store?.feedPosts, users)
  };
}

function decorateRequest(entry, store) {
  return {
    ...entry,
    userName: findUserName(store.users, entry.userId),
    memberDecisionLabel:
      {
        pending: "Antwort offen",
        accepted: "Angenommen",
        declined: "Abgelehnt"
      }[entry.memberDecision] || ""
  };
}

function decorateFeedPost(entry, store) {
  const creatorCommunity = (store.users || []).find((user) => user.id === entry.creatorCommunityId && hasVisibleCreatorProfile(user));
  return {
    ...entry,
    authorName: findUserName(store.users, entry.authorId),
    authorAvatarUrl: store.users.find((user) => user.id === entry.authorId)?.avatarUrl || "",
    creatorCommunityId: creatorCommunity?.id || "",
    creatorCommunityName: creatorCommunity ? normalizeCreatorCommunityName(creatorCommunity.creatorCommunityName) || `${findUserName(store.users, creatorCommunity.id)} Community` : "",
    creatorCommunityOwnerName: creatorCommunity ? findUserName(store.users, creatorCommunity.id) : "",
    reactions: normalizeFeedReactionMap(entry.reactions)
  };
}

function validateEventPayload(body, user) {
  const title = String(body.title || "").trim();
  const world = String(body.world || "").trim();
  const host = String(body.host || "").trim() || findUserName([{ id: user.id, vrchatName: user.vrchatName, displayName: user.displayName }], user.id);
  const summary = String(body.summary || "").trim();
  const scheduleType = normalizeEventScheduleType(body.scheduleType);
  const eventDate = isDateKey(body.eventDate) ? String(body.eventDate) : "";
  const eventTime = normalizeTimeValue(body.eventTime);
  const weekday = normalizeEventWeekday(body.weekday);
  const reminderEnabled = body.reminderEnabled === undefined ? true : normalizeBooleanInput(body.reminderEnabled);
  const reminderLeadMinutes = normalizePositiveInteger(body.reminderLeadMinutes, 120);

  if (!title || !world || !summary) {
    const error = new Error("Bitte Titel, Zeitpunkt, Welt und Kurzbeschreibung angeben.");
    error.statusCode = 400;
    throw error;
  }

  if (scheduleType === "weekly") {
    if (weekday < 0 || !eventTime) {
      const error = new Error("Bitte fuer woechentliche Events Wochentag und Uhrzeit angeben.");
      error.statusCode = 400;
      throw error;
    }
  } else if (!eventDate || !eventTime) {
    const error = new Error("Bitte fuer einmalige Events Datum und Uhrzeit angeben.");
    error.statusCode = 400;
    throw error;
  }

  return {
    title,
    world,
    host,
    summary,
    scheduleType,
    eventDate: scheduleType === "single" ? eventDate : "",
    eventTime,
    weekday: scheduleType === "weekly" ? weekday : -1,
    reminderEnabled,
    reminderLeadMinutes,
    dateLabel: buildEventDateLabel({ scheduleType, eventDate, eventTime, weekday })
  };
}

function validateFeedPostPayload(body, store) {
  const content = String(body.content || "").trim().slice(0, 1200);
  const imageUrl = normalizeOptionalUrl(body.imageUrl);
  const creatorCommunityId = normalizeCreatorCommunityId(body.creatorCommunityId, store, { throwIfInvalid: true });

  if (!content && !imageUrl) {
    const error = new Error("Bitte Text oder Bild fuer den Feed-Beitrag angeben.");
    error.statusCode = 400;
    throw error;
  }

  if (body.imageUrl && !imageUrl) {
    const error = new Error("Das Feed-Bild ist nicht gueltig.");
    error.statusCode = 400;
    throw error;
  }

  return { content, imageUrl, creatorCommunityId };
}

function validateFeedReaction(value) {
  const emoji = String(value || "").trim();
  if (!["like", "heart", "fire", "star", "laugh"].includes(emoji)) {
    const error = new Error("Ungueltige Reaktion.");
    error.statusCode = 400;
    throw error;
  }
  return emoji;
}

function buildCommunityPayload(store) {
  const team = store.users
    .filter((entry) => entry.role !== "member")
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  const creators = store.users
    .filter((entry) => entry.creatorVisible && (((entry.creatorLinks || []).length > 0) || entry.creatorBlurb))
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  return {
    team,
    creators,
    events: getOrderedEvents(store.events || []),
    rules: COMMUNITY_RULES,
    faq: COMMUNITY_FAQ,
    stats: {
      members: store.users.filter((entry) => entry.role === "member").length,
      moderators: store.users.filter((entry) => entry.role === "moderator").length,
      planners: store.users.filter((entry) => entry.role === "planner" || entry.role === "admin").length,
      news: store.announcements.length,
      creators: creators.length
    }
  };
}

function buildNotifications(user, store) {
  const requestNotifications = (store.requests || [])
    .filter((entry) => entry.userId === user.id && entry.memberDecision === "pending" && entry.adminRespondedAt)
    .map((entry) => ({
      id: `request-response-${entry.id}`,
      title: "Antwort auf deinen Wunsch",
      body: entry.adminNote || `Status: ${validateRequestStatus(entry.status)}`,
      tone: "amber",
      createdAt: entry.adminRespondedAt,
      category: "feedback"
    }));

  const base =
    user.role === "member"
      ? buildCommunityNotifications(store)
      : user.role === "moderator"
        ? buildViewerNotifications(user, store)
        : buildManagerNotifications(store);

  const warningNotifications = (store.warnings || [])
    .filter((entry) => entry.status === "active" && entry.userId === user.id && !entry.acknowledgedAt)
    .map((entry) => ({
      id: `warning-${entry.id}`,
      title: "Wichtige Verwarnung",
      body: entry.reason,
      tone: "rose",
      createdAt: entry.createdAt,
      category: "warnung"
    }));

  return [...warningNotifications, ...requestNotifications, ...base]
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, 8);
}

function projectDataForRole(user, store) {
  const community = buildCommunityPayload(store);
  const notifications = buildNotifications(user, store);
  const announcements = store.announcements
    .slice()
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return new Date(right.createdAt) - new Date(left.createdAt);
    })
    .map((entry) => decorateAnnouncement(entry, store));
  const directory = store.users
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);
  const communityChatMessages = getChatMessagesForUser(user, store, "community");
  const staffChatMessages = getChatMessagesForUser(user, store, "staff");
  const feedPosts = (store.feedPosts || []).map((entry) => decorateFeedPost(entry, store));

  const base = {
    community,
    announcements,
    directory,
    calendarShifts: store.shifts.slice().sort(compareShifts).map((entry) => decorateCalendarShift(entry, store)),
    communityChatMessages,
    staffChatMessages,
    chatMessages: user.role === "member" ? communityChatMessages : staffChatMessages,
    directMessages: getDirectMessagesForUser(user, store),
    forumThreads: (store.forumThreads || []).map((entry) => decorateForumThread(entry, store)),
    warnings: getWarningsForUser(user, store),
    notifications,
    swapRequests: getSwapRequestsForUser(user, store),
    feedPosts
  };

  if (user.role === "member") {
    return {
      ...base,
      requests: store.requests
        .filter((entry) => entry.userId === user.id)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map((entry) => decorateRequest(entry, store))
    };
  }

  if (user.role === "moderator") {
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
    settings: store.settings,
    users: directory,
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

function enforceMessageCooldown(userId, scope) {
  const key = `${scope}:${userId}`;
  const now = Date.now();
  const lastSentAt = Number(messageCooldownStore.get(key) || 0);
  const remainingMs = MESSAGE_COOLDOWN_MS - (now - lastSentAt);

  if (remainingMs > 0) {
    const error = new Error(`Bitte warte noch ${Math.ceil(remainingMs / 1000)} Sekunden, bevor du erneut schreibst.`);
    error.statusCode = 429;
    throw error;
  }

  messageCooldownStore.set(key, now);
}

function isRecentTimestamp(value, windowMs = 15000) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) && Date.now() - timestamp >= 0 && Date.now() - timestamp <= windowMs;
}

function hasRecentDuplicateChatMessage(store, userId, payload) {
  return (store.chatMessages || []).some(
    (entry) =>
      entry.authorId === userId &&
      entry.channel === payload.channel &&
      String(entry.relatedShiftId || "") === String(payload.relatedShiftId || "") &&
      String(entry.content || "").trim() === payload.content &&
      isRecentTimestamp(entry.createdAt)
  );
}

function hasRecentDuplicateDirectMessage(store, userId, payload) {
  return (store.directMessages || []).some(
    (entry) =>
      entry.senderId === userId &&
      entry.recipientId === payload.recipientId &&
      String(entry.content || "").trim() === payload.content &&
      isRecentTimestamp(entry.createdAt)
  );
}

function hasRecentDuplicateFeedPost(store, userId, payload) {
  return (store.feedPosts || []).some(
    (entry) =>
      entry.authorId === userId &&
      String(entry.content || "").trim() === payload.content &&
      String(entry.imageUrl || "").trim() === String(payload.imageUrl || "").trim() &&
      String(entry.creatorCommunityId || "").trim() === String(payload.creatorCommunityId || "").trim() &&
      isRecentTimestamp(entry.createdAt)
  );
}

function validateTrimCount(value) {
  const count = Number(value || 0);
  if (!CHAT_TRIM_COUNTS.has(count)) {
    const error = new Error("Es koennen nur 20, 30, 40 oder 50 Nachrichten entfernt werden.");
    error.statusCode = 400;
    throw error;
  }
  return count;
}

function validateChatTrimChannel(value) {
  const channel = String(value || "").trim();
  if (!["community", "staff"].includes(channel)) {
    const error = new Error("Ungueltiger Chat-Kanal.");
    error.statusCode = 400;
    throw error;
  }
  return channel;
}

function removeNewestMatchingEntries(entries, count, predicate) {
  let removed = 0;

  return (entries || []).filter((entry) => {
    if (removed < count && predicate(entry)) {
      removed += 1;
      return false;
    }
    return true;
  });
}

function decorateShift(shift, store) {
  return {
    ...shift,
    memberName: findUserName(store.users, shift.memberId),
    windowLabel: formatShiftWindow(shift.startTime, shift.endTime)
  };
}

function decorateShiftSnapshot(snapshot, store) {
  const normalized = normalizeTimeEntryShiftSnapshot(snapshot);
  if (!normalized) return null;

  return {
    ...normalized,
    memberName: normalized.memberName || findUserName(store.users || [], normalized.memberId),
    windowLabel: formatShiftWindow(normalized.startTime, normalized.endTime)
  };
}

function decorateCalendarShift(shift, store) {
  const user = (store.users || []).find((entry) => entry.id === shift.memberId);
  return {
    id: shift.id,
    date: shift.date,
    startTime: shift.startTime,
    endTime: shift.endTime,
    shiftType: shift.shiftType,
    world: shift.world,
    task: shift.task,
    memberId: shift.memberId,
    memberName: findUserName(store.users, shift.memberId),
    memberRole: user?.role || "",
    isLead: Boolean(shift.isLead),
    windowLabel: formatShiftWindow(shift.startTime, shift.endTime)
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
  const fallbackShift = decorateShiftSnapshot(entry.shiftSnapshot, store);
  return {
    ...entry,
    memberName: findUserName(store.users, entry.userId),
    shift: shift ? decorateShift(shift, store) : fallbackShift
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
  if (user.role === "member") {
    return [];
  }

  const all = (store.swapRequests || [])
    .slice()
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
    .map((entry) => decorateSwapRequest(entry, store));

  if (user.role === "moderator") {
    return all.filter(
      (entry) =>
        ["offen", "angeboten"].includes(entry.status) ||
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
    discordName: user.discordName || "",
    avatarUrl: user.avatarUrl || "",
    bio: user.bio || ""
  };
}

function sendPortalData(res, statusCode, user, store, headers = {}) {
  sendJson(
    res,
    statusCode,
    {
      session: sanitizeSessionUser(user),
      data: projectDataForRole(user, store)
    },
    headers
  );
}

function buildPublicPortalData(store) {
  const visibleCreatorIds = new Set((store.users || []).filter((entry) => hasVisibleCreatorProfile(entry)).map((entry) => entry.id));
  const publicFeedPosts = (store.feedPosts || [])
    .map((entry) => decorateFeedPost(entry, store))
    .filter((entry) => entry.creatorCommunityId || visibleCreatorIds.has(entry.authorId))
    .slice(0, 60);
  const publicForumThreads = (store.forumThreads || [])
    .map((entry) => decorateForumThread(entry, store))
    .filter((entry) => entry.creatorCommunityId || visibleCreatorIds.has(entry.authorId))
    .slice(0, 60);

  return {
    community: buildCommunityPayload(store),
    feedPosts: publicFeedPosts,
    forumThreads: publicForumThreads,
    systemNotice: decorateSystemNotice(store.systemNotice, store),
    promoVideo: decoratePromoVideo(store.promoVideo, store),
    announcements: store.announcements
      .slice()
      .sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
        return new Date(right.createdAt) - new Date(left.createdAt);
      })
      .map((entry) => decorateAnnouncement(entry, store))
      .slice(0, 6)
  };
}

function buildCommunityPayload(store) {
  const staff = store.users
    .filter((entry) => entry.role !== "member")
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  return {
    team: staff,
    events: COMMUNITY_EVENTS,
    rules: COMMUNITY_RULES,
    faq: COMMUNITY_FAQ,
    stats: {
      members: store.users.filter((entry) => entry.role === "member").length,
      moderators: store.users.filter((entry) => entry.role === "moderator").length,
      planners: store.users.filter((entry) => entry.role === "planner" || entry.role === "admin").length,
      news: store.announcements.length
    }
  };
}

function findUserName(users, userId) {
  const user = users.find((entry) => entry.id === userId);
  return user?.vrchatName || user?.displayName || "Unbekannt";
}

function buildNotifications(user, store) {
  if (user.role === "member") {
    return buildCommunityNotifications(store);
  }

  if (user.role === "moderator") {
    return buildViewerNotifications(user, store);
  }

  return buildManagerNotifications(store);
}

function buildCommunityNotifications(store) {
  const notifications = store.announcements
    .filter((entry) => entry.pinned)
    .slice(0, 3)
    .map((entry) => ({
      id: `announcement-${entry.id}`,
      title: `News: ${entry.title}`,
      body: entry.body,
      tone: "sky",
      createdAt: entry.createdAt,
      category: "news"
    }));

  const eventNotifications = buildUpcomingEventNotifications(store, 2);
  const creatorNotifications = buildCreatorPresenceNotifications(store, 2);

  return [...creatorNotifications, ...notifications, ...eventNotifications].slice(0, 6);
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
      title = `Heute: ${formatShiftWindow(shift.startTime, shift.endTime)} · ${shift.world}`;
      tone = "teal";
    } else if (diff === 1) {
      title = `Morgen: ${formatShiftWindow(shift.startTime, shift.endTime)} · ${shift.world}`;
      tone = "amber";
    } else {
      title = `Demnaechst: ${formatShiftWindow(shift.startTime, shift.endTime)} · ${shift.world}`;
    }

    notifications.push({
      id: `shift-${shift.id}`,
      title,
      body: `${formatDisplayDate(shift.date)} · ${shift.shiftType} · Aufgabe: ${shift.task}`,
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

  const eventNotifications = buildUpcomingEventNotifications(store, 2);
  const creatorNotifications = buildCreatorPresenceNotifications(store, 2);

  return [...creatorNotifications, ...notifications, ...pinnedAnnouncements, ...eventNotifications]
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, 6);
}

function buildManagerNotifications(store) {
  const today = todayKey();
  const openRequests = store.requests.filter((entry) => entry.status === "offen");
  const todayShifts = store.shifts.filter((entry) => entry.date === today);
  const liveEntries = store.timeEntries.filter((entry) => !entry.checkOutAt);
  const pendingCreatorApplications = store.users.filter((entry) => normalizeCreatorApplicationStatus(entry.creatorApplicationStatus) === "pending");
  const notifications = [];

  if (openRequests.length) {
    notifications.push({
      id: `requests-${openRequests.length}`,
      title: `${openRequests.length} offene Team-R\u00fcckmeldungen`,
      body: "Neue W\u00fcnsche oder Hinweise warten auf Bearbeitung.",
      tone: "rose",
      createdAt: openRequests[0].createdAt,
      category: "request"
    });
  }

  if (todayShifts.length) {
    notifications.push({
      id: `today-shifts-${today}`,
      title: `${todayShifts.length} Schichten f\u00fcr heute`,
      body: "Pr\u00fcfe Besetzung, Welten und letzte Briefings.",
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

  if (pendingCreatorApplications.length) {
    notifications.push({
      id: `creator-pending-${pendingCreatorApplications.length}`,
      title: `${pendingCreatorApplications.length} Creator-Bewerbungen warten`,
      body: `Pruefe neue Creator-Anfragen ab ${CREATOR_MIN_FOLLOWERS} Followern.`,
      tone: "amber",
      createdAt: new Date().toISOString(),
      category: "creator-review"
    });
  }

  const openSwapRequests = (store.swapRequests || []).filter((entry) => ["offen", "angeboten"].includes(entry.status));
  if (openSwapRequests.length) {
    notifications.push({
      id: `swap-${openSwapRequests.length}`,
      title: `${openSwapRequests.length} offene Tauschw\u00fcnsche`,
      body: "Pr\u00fcfe, ob eine \u00dcbernahme genehmigt werden soll.",
      tone: "amber",
      createdAt: openSwapRequests[0].updatedAt,
      category: "swap"
    });
  }

  const upcomingEvents = buildUpcomingEventNotifications(store, 2);
  const creatorNotifications = buildCreatorPresenceNotifications(store, 2);
  notifications.push(...creatorNotifications);
  notifications.push(...upcomingEvents);

  return notifications.slice(0, 6);
}

function normalizeCreatorPresence(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["live", "new-release"].includes(normalized) ? normalized : "offline";
}

function normalizeCreatorPresenceText(value) {
  return String(value || "").trim().slice(0, 180);
}

function normalizeCreatorPresenceUrl(value) {
  return normalizeExternalLink(value);
}

function normalizeCreatorCommunityName(value) {
  return String(value || "").trim().slice(0, 80);
}

function normalizeCreatorCommunitySummary(value) {
  return String(value || "").trim().slice(0, 500);
}

function normalizeCreatorCommunityInviteUrl(value) {
  return normalizeExternalLink(value);
}

function normalizeCreatorApplicationStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["pending", "approved", "rejected"].includes(normalized) ? normalized : "none";
}

function normalizeCreatorFollowerCount(value) {
  const numeric = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.min(numeric, 100000000);
}

function normalizeCreatorPrimaryPlatform(value) {
  return String(value || "").trim().slice(0, 40);
}

function normalizeCreatorProofUrl(value) {
  return normalizeExternalLink(value);
}

function normalizeCreatorApplicationNote(value) {
  return String(value || "").trim().slice(0, 300);
}

function normalizeCreatorReviewNote(value) {
  return String(value || "").trim().slice(0, 300);
}

function hasMinimumCreatorFollowers(value) {
  return normalizeCreatorFollowerCount(value) >= CREATOR_MIN_FOLLOWERS;
}

function getCreatorPresenceTimestamp(user) {
  const timestamp = Date.parse(String(user?.creatorPresenceUpdatedAt || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function hasVisibleCreatorProfile(user) {
  return Boolean(
    normalizeCreatorApplicationStatus(user?.creatorApplicationStatus) === "approved" &&
      user?.creatorVisible &&
      (((user?.creatorLinks || []).length > 0) || user?.creatorBlurb)
  );
}

function normalizeCreatorCommunityId(value, store, options = {}) {
  const creatorCommunityId = String(value || "").trim();
  if (!creatorCommunityId) return "";

  const creator = (store?.users || []).find((entry) => entry.id === creatorCommunityId && !entry.isBlocked && hasVisibleCreatorProfile(entry));
  if (creator) return creator.id;

  if (options.throwIfInvalid) {
    const error = new Error("Die ausgewaehlte Creator-Community ist nicht gueltig.");
    error.statusCode = 400;
    throw error;
  }

  return "";
}

function isFreshCreatorRelease(user, windowHours = 72) {
  if (normalizeCreatorPresence(user?.creatorPresence) !== "new-release") return false;
  const timestamp = getCreatorPresenceTimestamp(user);
  return Boolean(timestamp && timestamp >= Date.now() - windowHours * 60 * 60 * 1000);
}

function getCreatorPresenceUsers(store, options = {}) {
  const { includeOffline = false } = options;
  const activeUsers = (store.users || []).filter((entry) => !entry.isBlocked && hasVisibleCreatorProfile(entry));

  return activeUsers
    .filter((entry) => includeOffline || normalizeCreatorPresence(entry.creatorPresence) === "live" || isFreshCreatorRelease(entry))
    .slice()
    .sort((left, right) => {
      const rank = (entry) => {
        const status = normalizeCreatorPresence(entry?.creatorPresence);
        if (status === "live") return 0;
        if (status === "new-release") return 1;
        return 2;
      };

      const rankDiff = rank(left) - rank(right);
      if (rankDiff !== 0) return rankDiff;

      const timeDiff = getCreatorPresenceTimestamp(right) - getCreatorPresenceTimestamp(left);
      if (timeDiff !== 0) return timeDiff;

      return findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de");
    });
}

function buildCreatorPresenceNotifications(store, limit = 2) {
  return getCreatorPresenceUsers(store)
    .slice(0, limit)
    .map((entry) => {
      const name = findUserName(store.users, entry.id);
      const live = normalizeCreatorPresence(entry.creatorPresence) === "live";
      const platformHint = entry.creatorPresenceUrl ? deriveCreatorLabel(entry.creatorPresenceUrl) : deriveCreatorLabel(entry.creatorLinks?.[0]?.url || "");

      return {
        id: `creator-${entry.id}-${entry.creatorPresence}-${entry.creatorPresenceUpdatedAt || "now"}`,
        title: live ? `${name} ist gerade live` : `Neu von ${name}`,
        body:
          entry.creatorPresenceText ||
          (live ? `Direkt zu ${platformHint} wechseln.` : `Es gibt frischen Content auf ${platformHint}.`),
        tone: live ? "amber" : "sky",
        createdAt: entry.creatorPresenceUpdatedAt || new Date().toISOString(),
        category: "creator"
      };
    });
}

function compareShifts(left, right) {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  if ((left.startTime || "") !== (right.startTime || "")) return compareTimeValues(left.startTime || "", right.startTime || "");
  if (left.shiftType !== right.shiftType) return left.shiftType.localeCompare(right.shiftType, "de");
  return left.world.localeCompare(right.world, "de");
}

function createSession(userId) {
  const sessionId = createSignedSessionToken(userId);
  sessionStore.set(sessionId, { userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_COOKIE_MAX_AGE_SECONDS * 1000 });
  return sessionId;
}

function normalizeVrchatLinkSource(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (["browser", "1", "true", "yes", "vrchat-browser"].includes(normalized)) return "vrchat-browser";
  if (["chat", "vrchat-chat"].includes(normalized)) return "vrchat-chat";
  if (["world", "vrchat-world"].includes(normalized)) return "vrchat-world";
  return "";
}

function applyVrchatLinkState(target, source) {
  const normalizedSource = normalizeVrchatLinkSource(source);
  if (!normalizedSource || !target) return false;
  target.vrchatLinkedAt = new Date().toISOString();
  target.vrchatLinkSource = normalizedSource;
  return true;
}

function validateRegistrationPayload(body, store) {
  const password = String(body.password || "").trim();
  const vrchatName = String(body.vrchatName || "").trim();
  const discordName = String(body.discordName || "").trim();
  const avatarUrl = normalizeOptionalUrl(body.avatarUrl);
  const bio = String(body.bio || "").trim();

  if (!password || !vrchatName || !discordName) {
    const error = new Error("Bitte VRChat-Name, Discord-Name und Passwort angeben.");
    error.statusCode = 400;
    throw error;
  }

  validatePassword(password);

  ensureUserIdentityUnique(store.users, null, { vrchatName, discordName });

  return {
    displayName: vrchatName,
    username: createUniqueUsername(vrchatName, store.users.map((entry) => entry.username)),
    password,
    vrchatName,
    discordName,
    avatarUrl,
    bio
  };
}

function validateAdminUserPayload(body, store) {
  const normalized = validateRegistrationPayload(body, store);
  normalized.role = validateRole(body.role);
  return normalized;
}

function validateCreatorApplicationPayload(body) {
  const creatorFollowerCount = normalizeCreatorFollowerCount(body.creatorFollowerCount);
  const creatorPrimaryPlatform = normalizeCreatorPrimaryPlatform(body.creatorPrimaryPlatform);
  const creatorProofUrl = normalizeCreatorProofUrl(body.creatorProofUrl);
  const creatorApplicationNote = normalizeCreatorApplicationNote(body.creatorApplicationNote);

  if (!creatorPrimaryPlatform || !creatorProofUrl) {
    const error = new Error("Bitte Plattform und Nachweis fuer die Creator-Pruefung angeben.");
    error.statusCode = 400;
    throw error;
  }

  if (!hasMinimumCreatorFollowers(creatorFollowerCount)) {
    const error = new Error(`Fuer eine Creator-Bewerbung sind aktuell mindestens ${CREATOR_MIN_FOLLOWERS} Follower noetig.`);
    error.statusCode = 400;
    throw error;
  }

  return {
    creatorFollowerCount,
    creatorPrimaryPlatform,
    creatorProofUrl,
    creatorApplicationNote
  };
}

function applyCreatorApplication(target, payload) {
  target.creatorFollowerCount = payload.creatorFollowerCount;
  target.creatorPrimaryPlatform = payload.creatorPrimaryPlatform;
  target.creatorProofUrl = payload.creatorProofUrl;
  target.creatorApplicationNote = payload.creatorApplicationNote;
  target.creatorApplicationStatus = "pending";
  target.creatorReviewNote = "";
  target.creatorReviewedAt = "";
  target.creatorReviewedBy = "";
  target.creatorVisible = false;
}

function validateShiftPayload(body, store) {
  const date = String(body.date || "").trim();
  const startTime = normalizeTimeValue(body.startTime);
  const endTime = normalizeTimeValue(body.endTime) || addHoursToTime(startTime, 4);
  const memberId = String(body.memberId || "").trim();
  const shiftType = String(body.shiftType || "").trim();
  const world = String(body.world || "").trim();
  const task = String(body.task || "").trim();
  const notes = String(body.notes || "").trim();
  const isLead = normalizeBooleanInput(body.isLead);
  const catalogAdds = normalizeCatalogAdds(body.catalogAdds || {}, store.settings);

  if (!isDateKey(date) || !isTimeValue(startTime) || !isTimeValue(endTime) || !memberId || !shiftType || !world || !task) {
    const error = new Error("Datum, Uhrzeit, Moderator, Schichttyp, Welt und Aufgabe sind erforderlich.");
    error.statusCode = 400;
    throw error;
  }

  if (!store.users.some((entry) => entry.id === memberId)) {
    const error = new Error("Der ausgewaehlte Benutzer existiert nicht.");
    error.statusCode = 400;
    throw error;
  }

  return { date, startTime, endTime, memberId, shiftType, world, task, notes, isLead, catalogAdds };
}

function validateRequestPayload(body) {
  const type = String(body.type || "Notiz").trim() || "Notiz";
  const date = String(body.date || "").trim();
  const content = String(body.content || "").trim();
  const rating = normalizeRating(body.rating);

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

  return { type, date, content, rating };
}

function validateRequestStatus(status) {
  const normalized = String(status || "").trim();
  return ["offen", "in_planung", "beruecksichtigt"].includes(normalized) ? normalized : "offen";
}

function validateAnnouncementPayload(body) {
  const title = String(body.title || "").trim();
  const bodyText = String(body.body || "").trim();
  const pinned = Boolean(body.pinned);
  const imageUrl = normalizeOptionalUrl(body.imageUrl);

  if (!title || !bodyText) {
    const error = new Error("Titel und Nachricht sind erforderlich.");
    error.statusCode = 400;
    throw error;
  }

  return { title, body: bodyText, pinned, imageUrl };
}

function validateSystemNoticePayload(body) {
  const enabled = normalizeBooleanInput(body.enabled);
  const tone = normalizeSystemNoticeTone(String(body.tone || "").trim().toLowerCase());
  const title = String(body.title || "").trim().slice(0, 120);
  const bodyText = String(body.body || "").trim().slice(0, 1200);
  const contactHint = String(body.contactHint || "").trim().slice(0, 220);

  if (enabled && !bodyText) {
    const error = new Error("Bitte eine Hinweis-Nachricht eingeben, solange der Systemhinweis aktiv ist.");
    error.statusCode = 400;
    throw error;
  }

  return {
    enabled,
    tone,
    title,
    body: bodyText,
    contactHint
  };
}

function validatePromoVideoPayload(body) {
  const enabled = normalizeBooleanInput(body.enabled);
  const title = String(body.title || "").trim().slice(0, 120);
  const intro = String(body.intro || "").trim().slice(0, 500);
  const url = normalizeExternalLink(body.url);

  if (body.url && !url) {
    const error = new Error("Bitte eine gueltige Video-URL angeben.");
    error.statusCode = 400;
    throw error;
  }

  if (enabled && !url) {
    const error = new Error("Zum sichtbaren Promo-Video wird eine gueltige URL gebraucht.");
    error.statusCode = 400;
    throw error;
  }

  return {
    enabled: Boolean(enabled && url),
    title,
    intro,
    url
  };
}

function validateCreatorPresenceWebhookPayload(body, target) {
  const eventType = String(body?.event || "").trim().toLowerCase();
  let creatorPresence =
    body?.status !== undefined || body?.creatorPresence !== undefined
      ? normalizeCreatorPresence(body?.status ?? body?.creatorPresence)
      : normalizeCreatorPresence(target?.creatorPresence);
  if (eventType) {
    if (["live", "live.start", "stream.online", "online", "go-live"].includes(eventType)) creatorPresence = "live";
    if (["offline", "live.stop", "stream.offline", "stop-live"].includes(eventType)) creatorPresence = "offline";
    if (["release", "upload", "new-release", "video.published", "content.published"].includes(eventType)) creatorPresence = "new-release";
  }

  const rawUrl = body?.url ?? body?.creatorPresenceUrl;
  const rawText = body?.text ?? body?.creatorPresenceText;
  const creatorPresenceUrl =
    rawUrl !== undefined ? normalizeCreatorPresenceUrl(rawUrl) : normalizeCreatorPresenceUrl(target?.creatorPresenceUrl);
  const creatorPresenceText =
    rawText !== undefined ? normalizeCreatorPresenceText(rawText) : normalizeCreatorPresenceText(target?.creatorPresenceText);
  const source = normalizeCreatorAutomationSource(body?.source || body?.platform || body?.provider || body?.service || "Automation");

  if (rawUrl !== undefined && rawUrl && !creatorPresenceUrl) {
    const error = new Error("Der uebergebene Live- oder Upload-Link ist nicht gueltig.");
    error.statusCode = 400;
    throw error;
  }

  return {
    creatorPresence,
    creatorPresenceText,
    creatorPresenceUrl,
    source
  };
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
    if (user.role === "member") {
      const error = new Error("Community-Mitglieder koennen keine Schichten im Chat referenzieren.");
      error.statusCode = 403;
      throw error;
    }

    const shift = store.shifts.find((entry) => entry.id === relatedShiftId);
    if (!shift) {
      const error = new Error("Die ausgewaehlte Schicht existiert nicht.");
      error.statusCode = 400;
      throw error;
    }
    if (user.role === "moderator" && shift.memberId !== user.id) {
      const error = new Error("Moderatoren duerfen nur ihre eigenen Schichten referenzieren.");
      error.statusCode = 403;
      throw error;
    }
  }

  return { content, relatedShiftId };
}

function validateSwapRequestPayload(body, user, store) {
  if (user.role === "member") {
    const error = new Error("Nur Moderatoren koennen Tauschwuesche fuer Schichten erstellen.");
    error.statusCode = 403;
    throw error;
  }

  const shiftId = String(body.shiftId || "").trim();
  const message = String(body.message || "").trim();
  const shift = store.shifts.find((entry) => entry.id === shiftId);

  if (!shift) {
    const error = new Error("Die ausgewaehlte Schicht existiert nicht.");
    error.statusCode = 400;
    throw error;
  }

  if (user.role === "moderator" && shift.memberId !== user.id) {
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
  if (user.role === "member") {
    const error = new Error("Nur Moderatoren koennen Schichten uebernehmen.");
    error.statusCode = 403;
    throw error;
  }

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
  if (!["member", "moderator", "moderation_lead", "planner", "admin"].includes(role)) {
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

function applyUserIdentityUpdates(users, target, body, allowEmptyBio = true) {
  const nextVrchatName = body.vrchatName !== undefined ? String(body.vrchatName || "").trim() : target.vrchatName;
  const nextDiscordName = body.discordName !== undefined ? String(body.discordName || "").trim() : target.discordName;
  const nextAvatarUrl = body.avatarUrl !== undefined ? normalizeOptionalUrl(body.avatarUrl) : target.avatarUrl || "";
  const nextBio = body.bio !== undefined ? String(body.bio || "").trim() : target.bio || "";

  if (!nextVrchatName) {
    const error = new Error("VRChat-Name darf nicht leer sein.");
    error.statusCode = 400;
    throw error;
  }

  if (!nextDiscordName) {
    const error = new Error("Discord-Name darf nicht leer sein.");
    error.statusCode = 400;
    throw error;
  }

  if (!allowEmptyBio && body.bio !== undefined && !nextBio) {
    const error = new Error("Profiltext darf nicht leer sein.");
    error.statusCode = 400;
    throw error;
  }

  ensureUserIdentityUnique(users, target.id, {
    vrchatName: nextVrchatName,
    discordName: nextDiscordName
  });

  target.vrchatName = nextVrchatName;
  target.displayName = nextVrchatName;
  target.discordName = nextDiscordName;
  target.avatarUrl = nextAvatarUrl;
  target.bio = nextBio;
}

function ensureUserIdentityUnique(users, currentUserId, identity) {
  const vrchatKey = normalizeLoginIdentifier(identity.vrchatName);
  const discordKey = normalizeLoginIdentifier(identity.discordName);

  if (users.some((entry) => entry.id !== currentUserId && normalizeLoginIdentifier(entry.vrchatName) === vrchatKey)) {
    const error = new Error("Dieser VRChat-Name ist bereits vergeben.");
    error.statusCode = 409;
    throw error;
  }

  if (users.some((entry) => entry.id !== currentUserId && normalizeLoginIdentifier(entry.discordName) === discordKey)) {
    const error = new Error("Dieser Discord-Name ist bereits vergeben.");
    error.statusCode = 409;
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

function normalizeCatalogAdds(source, settings) {
  const currentSettings = settings || { shiftTypes: [], worlds: [], tasks: [] };

  return {
    shiftTypes: filterUnknownCatalogValues(source.shiftTypes, currentSettings.shiftTypes),
    worlds: filterUnknownCatalogValues(source.worlds, currentSettings.worlds),
    tasks: filterUnknownCatalogValues(source.tasks, currentSettings.tasks)
  };
}

function filterUnknownCatalogValues(values, existingValues) {
  const known = new Set(uniqueStrings(existingValues).map((entry) => entry.toLowerCase()));
  return uniqueStrings(Array.isArray(values) ? values : [])
    .filter((entry) => !known.has(entry.toLowerCase()));
}

function applyCatalogAdds(settings, catalogAdds = {}) {
  for (const key of ["shiftTypes", "worlds", "tasks"]) {
    const values = uniqueStrings([...(settings[key] || []), ...((catalogAdds[key] || []))]);
    settings[key] = values;
  }
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function normalizeLoginIdentifier(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findUserByLoginIdentifier(users, identifier) {
  const normalized = normalizeLoginIdentifier(identifier);
  if (!normalized) return null;

  return (
    users.find((entry) => normalizeLoginIdentifier(entry.vrchatName) === normalized) ||
    users.find((entry) => normalizeLoginIdentifier(entry.discordName) === normalized) ||
    users.find((entry) => normalizeLoginIdentifier(entry.username) === normalized) ||
    null
  );
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

function normalizeCreatorSlugValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function createUniqueCreatorSlug(value, existingSlugs) {
  const used = new Set((existingSlugs || []).map((entry) => String(entry || "").toLowerCase()).filter(Boolean));
  const base = normalizeCreatorSlugValue(value) || "creator";

  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

function resolveUniqueCreatorSlug(users, targetId, desiredSlug, fallbackValue = "creator") {
  const existingSlugs = (users || [])
    .filter((entry) => entry.id !== targetId)
    .map((entry) => normalizeCreatorSlugValue(entry.creatorSlug || entry.creatorCommunityName || entry.displayName));

  return createUniqueCreatorSlug(desiredSlug || fallbackValue, existingSlugs);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeOptionalUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return "";
}

function normalizeRating(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(5, Math.round(numeric)));
}

function normalizeTimeValue(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) return "";
  const [hours, minutes] = normalized.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function isTimeValue(value) {
  return Boolean(normalizeTimeValue(value));
}

function suggestLegacyShiftStart(shiftType) {
  const normalized = String(shiftType || "").trim().toLowerCase();
  if (normalized === "frueh") return "12:00";
  if (normalized === "prime time") return "16:00";
  if (normalized === "event") return "20:00";
  if (normalized === "spaet") return "00:00";
  return "12:00";
}

function addHoursToTime(timeValue, hoursToAdd) {
  const normalized = normalizeTimeValue(timeValue);
  if (!normalized) return "";
  const [hours, minutes] = normalized.split(":").map(Number);
  const totalMinutes = (hours * 60 + minutes + hoursToAdd * 60 + 1440) % 1440;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function compareTimeValues(left, right) {
  return timeValueToMinutes(left) - timeValueToMinutes(right);
}

function timeValueToMinutes(value) {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return Number.MAX_SAFE_INTEGER;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
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
  parts.push(expire ? "Max-Age=0" : `Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`);
  return parts.join("; ");
}

function getSessionSecret() {
  return String(process.env.SESSION_SECRET || "sonara-portal-session-secret").trim();
}

function signSessionPayload(payload) {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function createSignedSessionToken(userId) {
  const expiresAt = Date.now() + SESSION_COOKIE_MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${signSessionPayload(payload)}`;
}

function parseSignedSession(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;

  const [userId, expiresAtText, signature] = parts;
  const expiresAt = Number(expiresAtText);
  if (!userId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  const payload = `${userId}.${expiresAtText}`;
  const expected = signSessionPayload(payload);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  return { userId, expiresAt };
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

function resolveRootHtmlFile(pathname) {
  const normalizedPath = String(pathname || "").trim();
  if (!/^\/[^/]+\.html$/i.test(normalizedPath)) return "";

  const fileName = path.basename(normalizedPath);
  if (!/^[a-zA-Z0-9._-]+\.html$/.test(fileName)) return "";

  const resolvedPath = path.join(ROOT, fileName);
  if (!resolvedPath.startsWith(ROOT)) return "";
  if (!fs.existsSync(resolvedPath)) return "";
  if (!fs.statSync(resolvedPath).isFile()) return "";
  return fileName;
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", ...headers });
  if (payload === null) {
    res.end();
    return;
  }

  res.end(JSON.stringify(payload));
}

async function notifyDiscord(message, options = {}) {
  discordState.lastAttemptAt = new Date().toISOString();
  discordState.lastSuccessAt = "";
  discordState.lastError = "Der Discord-Webhook-Bereich wurde entfernt.";
  discordState.lastStatusCode = 410;
  discordState.blockedUntil = "";
  return { ok: false, skipped: true, removed: true, message: discordState.lastError };
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
    { name: "Zeit", value: formatShiftWindow(shift.startTime, shift.endTime), inline: true },
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
      value: `${formatDisplayDate(previousShift.date)} · ${formatShiftWindow(previousShift.startTime, previousShift.endTime)} · ${previousShift.shiftType} · ${previousShift.world} · ${previousShift.task}`,
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

function buildDiscordTestMessage(user) {
  return {
    username: "VRC Team Planner",
    embeds: [
      {
        title: "Discord-Verbindung getestet",
        description: "Diese Testnachricht wurde direkt aus dem Admin-Portal gesendet.",
        color: 1922777,
        fields: [
          { name: "Ausgeloest von", value: user.displayName, inline: true },
          { name: "Zeit", value: new Date().toLocaleString("de-DE"), inline: true }
        ],
        timestamp: new Date().toISOString()
      }
    ]
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
            resolve({
              statusCode: response.statusCode,
              body: Buffer.concat(chunks).toString("utf8")
            });
            return;
          }
          const responseBody = Buffer.concat(chunks).toString("utf8").trim();
          const error = new Error(responseBody ? `Discord returned ${response.statusCode || 0}: ${responseBody}` : `Discord returned ${response.statusCode || 0}`);
          error.statusCode = response.statusCode || 0;
          reject(error);
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function waitForDiscordSlot() {
  const elapsed = Date.now() - discordLastDispatchAt;
  const waitMs = Math.max(0, DISCORD_MIN_INTERVAL_MS - elapsed);
  if (!waitMs) return;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

function humanizeDiscordError(error) {
  const rawMessage = String(error?.message || "").trim();
  if (rawMessage.includes("1015")) {
    return buildDiscordBlockedUntilMessage(discordState.blockedUntil);
  }

  if (rawMessage.includes("429")) {
    return "Discord meldet gerade zu viele Anfragen. Bitte kurz warten und dann erneut testen.";
  }

  return rawMessage || "Discord konnte nicht erreicht werden.";
}

function clipText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function isDiscord1015Error(error) {
  const rawMessage = String(error?.message || "").trim();
  return rawMessage.includes("1015") || Number(error?.statusCode || 0) === 1015;
}

function getDiscord1015Cooldown() {
  const blockedUntilMs = Date.parse(discordState.blockedUntil || "");
  return {
    active: Number.isFinite(blockedUntilMs) && blockedUntilMs > Date.now(),
    blockedUntilMs
  };
}

function buildDiscordBlockedUntilMessage(blockedUntil) {
  const formattedUntil = blockedUntil ? formatStatusDateTime(blockedUntil) : "";
  return formattedUntil
    ? `Discord blockiert die aktuelle Server-IP gerade wegen zu vieler Anfragen (Cloudflare 1015). Neue Versuche pausieren bis ${formattedUntil}. Ein neuer Webhook hilft dabei meistens nicht, weil die Sperre an der IP haengt und nicht am Webhook selbst.`
    : "Discord blockiert die aktuelle Server-IP gerade wegen zu vieler Anfragen (Cloudflare 1015). Ein neuer Webhook hilft dabei meistens nicht, weil die Sperre an der IP haengt und nicht am Webhook selbst.";
}

function formatStatusDateTime(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return String(value || "");
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(parsed));
}

function normalizeWeeklyHoursCapacity(value) {
  const numeric = Number.parseFloat(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(168, Math.round(numeric * 10) / 10));
}

function normalizeWeeklyDaysCapacity(value) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(7, numeric));
}

function normalizeOvertimeAdjustmentHours(value) {
  const numeric = Number.parseFloat(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-500, Math.min(500, Math.round(numeric * 10) / 10));
}

function normalizeOvertimeAdjustmentNote(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, 320);
}

function normalizeOvertimeAdjustments(value) {
  const source = Array.isArray(value) ? value : [];

  return source
    .map((entry) => {
      const hours = normalizeOvertimeAdjustmentHours(entry?.hours);
      if (!hours) return null;

      return {
        id: String(entry?.id || crypto.randomUUID()),
        hours,
        note: normalizeOvertimeAdjustmentNote(entry?.note),
        createdAt: isIsoDate(entry?.createdAt) ? entry.createdAt : new Date().toISOString(),
        createdBy: String(entry?.createdBy || "").trim()
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function normalizeAvailabilitySchedule(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, 1200);
}

function normalizeAvailabilitySlotNote(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, 160);
}

function buildEmptyAvailabilitySlots() {
  return AVAILABILITY_DAY_IDS.map((day) => ({
    day,
    enabled: false,
    startTime: "",
    endTime: "",
    note: ""
  }));
}

function normalizeAvailabilitySlots(value) {
  let source = [];
  if (Array.isArray(value)) {
    source = value;
  } else if (typeof value === "string" && String(value).trim()) {
    try {
      const parsed = JSON.parse(String(value));
      source = Array.isArray(parsed) ? parsed : [];
    } catch {
      source = [];
    }
  } else if (value && typeof value === "object") {
    source = Object.entries(value).map(([day, slot]) => ({
      ...(slot && typeof slot === "object" ? slot : {}),
      day
    }));
  }

  const byDay = new Map(
    source
      .map((entry) => [String(entry?.day || "").trim().toLowerCase(), entry])
      .filter(([day]) => AVAILABILITY_DAY_IDS.includes(day))
  );

  return buildEmptyAvailabilitySlots().map((slot) => {
    const raw = byDay.get(slot.day) || {};
    const startTime = normalizeTimeValue(raw.startTime);
    const endTime = normalizeTimeValue(raw.endTime);
    const note = normalizeAvailabilitySlotNote(raw.note);
    const enabled = Boolean(raw.enabled || startTime || endTime || note);

    return {
      day: slot.day,
      enabled,
      startTime,
      endTime,
      note
    };
  });
}

function hasAvailabilitySlots(value) {
  return normalizeAvailabilitySlots(value).some((slot) => slot.enabled && (slot.startTime || slot.endTime || slot.note));
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function getDiscordStatus() {
  const cooldownState = getDiscord1015Cooldown();
  return {
    configured: Boolean(String(process.env.DISCORD_WEBHOOK_URL || "").trim()),
    autoNotificationsEnabled: DISCORD_AUTO_NOTIFICATIONS_ENABLED,
    lastAttemptAt: discordState.lastAttemptAt,
    lastSuccessAt: discordState.lastSuccessAt,
    lastError: discordState.lastError,
    lastStatusCode: discordState.lastStatusCode,
    blockedUntil: discordState.blockedUntil,
    cooldownActive: cooldownState.active
  };
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

function formatShiftWindow(startTime, endTime) {
  const start = normalizeTimeValue(startTime);
  const end = normalizeTimeValue(endTime);
  if (!start && !end) return "Ohne Uhrzeit";
  if (!start) return `bis ${end}`;
  if (!end) return `ab ${start}`;
  return `${start} - ${end}`;
}

function normalizeOptionalUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(normalized) && normalized.length <= 2_500_000) {
    return normalized;
  }
  return "";
}

function validateRegistrationPayload(body, store) {
  const password = String(body.password || "").trim();
  const vrchatName = String(body.vrchatName || "").trim();
  const discordName = String(body.discordName || "").trim();
  const avatarUrl = normalizeOptionalUrl(body.avatarUrl);
  const bio = String(body.bio || "").trim();

  if (!password || !vrchatName || !discordName) {
    const error = new Error("Bitte VRChat-Name, Discord-Name und Passwort angeben.");
    error.statusCode = 400;
    throw error;
  }

  if (body.avatarUrl && !avatarUrl) {
    const error = new Error("Das Profilbild muss ein gueltiges Bild sein.");
    error.statusCode = 400;
    throw error;
  }

  validatePassword(password);
  ensureUserIdentityUnique(store.users, null, { vrchatName, discordName });

  return {
    displayName: vrchatName,
    username: createUniqueUsername(vrchatName, store.users.map((entry) => entry.username)),
    password,
    vrchatName,
    discordName,
    avatarUrl,
    bio
  };
}

function applyUserIdentityUpdates(users, target, body, allowEmptyBio = true) {
  const nextVrchatName = body.vrchatName !== undefined ? String(body.vrchatName || "").trim() : target.vrchatName;
  const nextDiscordName = body.discordName !== undefined ? String(body.discordName || "").trim() : target.discordName;
  const nextAvatarUrl = body.avatarUrl !== undefined ? normalizeOptionalUrl(body.avatarUrl) : target.avatarUrl || "";
  const nextBio = body.bio !== undefined ? String(body.bio || "").trim() : target.bio || "";

  if (!nextVrchatName) {
    const error = new Error("VRChat-Name darf nicht leer sein.");
    error.statusCode = 400;
    throw error;
  }

  if (!nextDiscordName) {
    const error = new Error("Discord-Name darf nicht leer sein.");
    error.statusCode = 400;
    throw error;
  }

  if (body.avatarUrl !== undefined && body.avatarUrl && !nextAvatarUrl) {
    const error = new Error("Das Profilbild muss ein gueltiges Bild sein.");
    error.statusCode = 400;
    throw error;
  }

  if (!allowEmptyBio && body.bio !== undefined && !nextBio) {
    const error = new Error("Profiltext darf nicht leer sein.");
    error.statusCode = 400;
    throw error;
  }

  ensureUserIdentityUnique(users, target.id, {
    vrchatName: nextVrchatName,
    discordName: nextDiscordName
  });

  target.vrchatName = nextVrchatName;
  target.displayName = nextVrchatName;
  target.discordName = nextDiscordName;
  target.avatarUrl = nextAvatarUrl;
  target.bio = nextBio;
}

function normalizeChatMessages(messages, users, shifts) {
  const validUserIds = new Set(users.map((entry) => entry.id));
  const validShiftIds = new Set(shifts.map((entry) => entry.id));
  const validChannels = new Set(["community", "staff"]);

  return messages
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      authorId: String(entry.authorId || "").trim(),
      channel: validChannels.has(String(entry.channel || "").trim()) ? String(entry.channel).trim() : "community",
      relatedShiftId: validShiftIds.has(String(entry.relatedShiftId || "").trim()) ? String(entry.relatedShiftId).trim() : "",
      content: String(entry.content || "").trim(),
      createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString()
    }))
    .filter((entry) => validUserIds.has(entry.authorId) && entry.content);
}

function normalizeDirectMessages(messages, users) {
  const validUserIds = new Set(users.map((entry) => entry.id));

  return (messages || [])
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      senderId: String(entry.senderId || "").trim(),
      recipientId: String(entry.recipientId || "").trim(),
      content: String(entry.content || "").trim(),
      createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString()
    }))
    .filter((entry) => validUserIds.has(entry.senderId) && validUserIds.has(entry.recipientId) && entry.senderId !== entry.recipientId && entry.content);
}

function normalizeForumThreads(threads, users) {
  const validUserIds = new Set(users.map((entry) => entry.id));
  const validCreatorCommunityIds = new Set(users.filter((entry) => hasVisibleCreatorProfile(entry)).map((entry) => entry.id));

  return (threads || [])
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      authorId: String(entry.authorId || "").trim(),
      title: String(entry.title || "").trim(),
      body: String(entry.body || "").trim(),
      category: String(entry.category || "Allgemein").trim() || "Allgemein",
      creatorCommunityId: validCreatorCommunityIds.has(String(entry.creatorCommunityId || "").trim()) ? String(entry.creatorCommunityId).trim() : "",
      createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString(),
      updatedAt: isIsoDate(entry.updatedAt) ? entry.updatedAt : isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString(),
      replies: Array.isArray(entry.replies)
        ? entry.replies
            .map((reply) => ({
              id: String(reply.id || crypto.randomUUID()),
              authorId: String(reply.authorId || "").trim(),
              body: String(reply.body || "").trim(),
              createdAt: isIsoDate(reply.createdAt) ? reply.createdAt : new Date().toISOString()
            }))
            .filter((reply) => validUserIds.has(reply.authorId) && reply.body)
        : []
    }))
    .filter((entry) => validUserIds.has(entry.authorId) && entry.title && entry.body)
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}

function normalizeWarnings(warnings, users) {
  const validUserIds = new Set(users.map((entry) => entry.id));
  const validStatuses = new Set(["active", "cleared"]);

  return (warnings || [])
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      userId: String(entry.userId || "").trim(),
      reason: String(entry.reason || "").trim(),
      createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString(),
      createdBy: String(entry.createdBy || "").trim(),
      status: validStatuses.has(String(entry.status || "").trim()) ? String(entry.status).trim() : "active",
      acknowledgedAt: isIsoDate(entry.acknowledgedAt) ? entry.acknowledgedAt : "",
      clearedAt: isIsoDate(entry.clearedAt) ? entry.clearedAt : "",
      clearedBy: String(entry.clearedBy || "").trim()
    }))
    .filter((entry) => validUserIds.has(entry.userId) && validUserIds.has(entry.createdBy) && entry.reason)
    .map((entry) => ({
      ...entry,
      clearedBy: validUserIds.has(entry.clearedBy) ? entry.clearedBy : ""
    }));
}

function normalizeStore(store) {
  const hasUsers = Array.isArray(store.users) && store.users.length;
  if (!hasUsers) {
    return {
      ...buildDefaultStore(),
      chatMessages: [],
      directMessages: [],
      forumThreads: [],
      warnings: []
    };
  }

  const users = normalizeUsers(store.users, store.lists?.moderators || []);
  const settings = normalizeSettings(store.settings || store.lists || {}, Array.isArray(store.slots) ? store.slots : []);
  const shifts = Array.isArray(store.shifts)
    ? normalizeShifts(store.shifts, users)
    : migrateLegacyPlanning(store, users, settings);

  return {
    users,
    settings,
    systemNotice: normalizeSystemNotice(store.systemNotice),
    shifts,
    requests: Array.isArray(store.requests) ? normalizeRequests(store.requests, users) : [],
    announcements: Array.isArray(store.announcements) ? normalizeAnnouncements(store.announcements, users) : [],
    chatMessages: Array.isArray(store.chatMessages) ? normalizeChatMessages(store.chatMessages, users, shifts) : [],
    directMessages: Array.isArray(store.directMessages) ? normalizeDirectMessages(store.directMessages, users) : [],
    forumThreads: Array.isArray(store.forumThreads) ? normalizeForumThreads(store.forumThreads, users) : [],
    warnings: Array.isArray(store.warnings) ? normalizeWarnings(store.warnings, users) : [],
    swapRequests: Array.isArray(store.swapRequests) ? normalizeSwapRequests(store.swapRequests, users, shifts) : [],
    timeEntries: Array.isArray(store.timeEntries) ? normalizeTimeEntries(store.timeEntries, users, shifts) : []
  };
}

function validateChatPayload(body, user, store) {
  const content = String(body.content || "").trim();
  const requestedChannel = String(body.channel || "").trim();
  const channel = ["community", "staff"].includes(requestedChannel)
    ? requestedChannel
    : user.role === "member"
      ? "community"
      : "staff";
  const relatedShiftId = String(body.relatedShiftId || "").trim();

  if (!content) {
    const error = new Error("Bitte eine Chat-Nachricht eingeben.");
    error.statusCode = 400;
    throw error;
  }

  if (channel === "staff" && user.role === "member") {
    const error = new Error("Community-Mitglieder koennen nicht in den Staff-Chat posten.");
    error.statusCode = 403;
    throw error;
  }

  if (channel === "community" && relatedShiftId) {
    const error = new Error("Im allgemeinen Chat koennen keine Schichten referenziert werden.");
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
    if (user.role === "moderator" && shift.memberId !== user.id) {
      const error = new Error("Moderatoren duerfen nur ihre eigenen Schichten referenzieren.");
      error.statusCode = 403;
      throw error;
    }
  }

  return { content, relatedShiftId, channel };
}

function buildCommunityPayload(store) {
  const activeUsers = (store.users || []).filter((entry) => !entry.isBlocked);
  const team = activeUsers
    .filter((entry) => entry.role !== "member")
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  const creators = activeUsers
    .filter((entry) => hasVisibleCreatorProfile(entry))
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  return {
    team,
    creators,
    events: getOrderedEvents(store.events || []),
    rules: COMMUNITY_RULES,
    faq: COMMUNITY_FAQ,
    stats: {
      members: activeUsers.filter((entry) => entry.role === "member").length,
      moderators: activeUsers.filter((entry) => entry.role === "moderator").length,
      planners: activeUsers.filter((entry) => entry.role === "planner" || entry.role === "admin").length,
      news: store.announcements.length,
      creators: creators.length
    }
  };
}

function projectDataForRole(user, store) {
  const community = buildCommunityPayload(store);
  const notifications = buildNotifications(user, store);
  const announcements = store.announcements
    .slice()
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return new Date(right.createdAt) - new Date(left.createdAt);
    })
    .map((entry) => decorateAnnouncement(entry, store));
  const directory = store.users
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);
  const communityChatMessages = getChatMessagesForUser(user, store, "community");
  const staffChatMessages = getChatMessagesForUser(user, store, "staff");

  const base = {
    community,
    announcements,
    systemNotice: decorateSystemNotice(store.systemNotice, store),
    promoVideo: decoratePromoVideo(store.promoVideo, store),
    directory,
    communityChatMessages,
    staffChatMessages,
    chatMessages: user.role === "member" ? communityChatMessages : staffChatMessages,
    directMessages: getDirectMessagesForUser(user, store),
    forumThreads: (store.forumThreads || []).map((entry) => decorateForumThread(entry, store)),
    warnings: getWarningsForUser(user, store),
    notifications,
    swapRequests: getSwapRequestsForUser(user, store)
  };

  if (user.role === "member") {
    return {
      ...base,
      requests: store.requests
        .filter((entry) => entry.userId === user.id)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map((entry) => decorateRequest(entry, store))
    };
  }

  if (user.role === "moderator") {
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
    settings: store.settings,
    users: directory,
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

function projectDataForRole(user, store) {
  const community = buildCommunityPayload(store);
  const notifications = buildNotifications(user, store);
  const announcements = store.announcements
    .slice()
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return new Date(right.createdAt) - new Date(left.createdAt);
    })
    .map((entry) => decorateAnnouncement(entry, store));
  const directory = store.users
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);
  const communityChatMessages = getChatMessagesForUser(user, store, "community");
  const staffChatMessages = getChatMessagesForUser(user, store, "staff");

  const base = {
    community,
    announcements,
    systemNotice: decorateSystemNotice(store.systemNotice, store),
    promoVideo: decoratePromoVideo(store.promoVideo, store),
    directory,
    communityChatMessages,
    staffChatMessages,
    chatMessages: user.role === "member" ? communityChatMessages : staffChatMessages,
    directMessages: getDirectMessagesForUser(user, store),
    forumThreads: (store.forumThreads || []).map((entry) => decorateForumThread(entry, store)),
    warnings: getWarningsForUser(user, store),
    notifications,
    swapRequests: getSwapRequestsForUser(user, store)
  };

  if (user.role === "member") {
    return {
      ...base,
      requests: store.requests
        .filter((entry) => entry.userId === user.id)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map((entry) => decorateRequest(entry, store))
    };
  }

  if (user.role === "moderator") {
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
    settings: store.settings,
    users: directory,
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

function normalizeSlots(source, fallback = []) {
  const raw = Array.isArray(source) && source.length ? source : Array.isArray(fallback) ? fallback : [];

  return raw
    .map((entry, index) => ({
      id: String(entry?.id || `slot-${index + 1}`).trim(),
      name: String(entry?.name || entry?.task || "").trim(),
      task: String(entry?.task || entry?.name || "").trim()
    }))
    .filter((entry) => entry.id && entry.name)
    .map((entry) => ({
      ...entry,
      task: entry.task || entry.name
    }));
}

function normalizeDiscordStatus(source) {
  return {
    lastAttemptAt: isIsoDate(source?.lastAttemptAt) ? source.lastAttemptAt : discordState.lastAttemptAt || "",
    lastSuccessAt: isIsoDate(source?.lastSuccessAt) ? source.lastSuccessAt : discordState.lastSuccessAt || "",
    lastError: String(source?.lastError || discordState.lastError || "").trim(),
    lastStatusCode: Number(source?.lastStatusCode || discordState.lastStatusCode || 0)
  };
}

function normalizeVrchatAnalytics(source) {
  if (!source || typeof source !== "object") {
    return {};
  }

  const next = { ...source };
  if (next.lastSyncAt && !isIsoDate(next.lastSyncAt)) {
    delete next.lastSyncAt;
  }
  if (next.lastSuccessAt && !isIsoDate(next.lastSuccessAt)) {
    delete next.lastSuccessAt;
  }
  if (next.lastErrorAt && !isIsoDate(next.lastErrorAt)) {
    delete next.lastErrorAt;
  }
  return next;
}

function normalizeExternalLink(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) ? normalized : `https://${normalized}`;

  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function deriveCreatorLabel(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    const base = hostname.split(".")[0] || "Link";
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return "Link";
  }
}

function normalizeCreatorLinks(input) {
  const rawEntries = Array.isArray(input)
    ? input
    : String(input || "")
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean);

  const links = [];
  const seen = new Set();

  for (const rawEntry of rawEntries) {
    let label = "";
    let url = "";

    if (typeof rawEntry === "string") {
      const [left, ...rightParts] = rawEntry.split("|");
      if (rightParts.length) {
        label = String(left || "").trim();
        url = String(rightParts.join("|") || "").trim();
      } else {
        url = String(rawEntry || "").trim();
      }
    } else if (rawEntry && typeof rawEntry === "object") {
      label = String(rawEntry.label || "").trim();
      url = String(rawEntry.url || "").trim();
    }

    const normalizedUrl = normalizeExternalLink(url);
    if (!normalizedUrl || seen.has(normalizedUrl)) continue;

    seen.add(normalizedUrl);
    links.push({
      label: (label || deriveCreatorLabel(normalizedUrl)).slice(0, 60),
      url: normalizedUrl
    });

    if (links.length >= 10) break;
  }

  return links;
}

function normalizeUsers(users, legacyModeratorNames) {
  const normalized = [];
  const usedUsernames = new Set();
  const usedCreatorSlugs = new Set();

  for (const entry of users) {
    const username = normalizeUsername(entry.username);
    const fallbackDisplayName = String(entry.displayName || "").trim();
    const vrchatName = String(entry.vrchatName || fallbackDisplayName).trim();
    const displayName = vrchatName || fallbackDisplayName;
    const discordName = String(entry.discordName || username).trim();
    const avatarUrl = normalizeOptionalUrl(entry.avatarUrl);
    const bio = String(entry.bio || "").trim().slice(0, 600);
    const contactNote = String(entry.contactNote || "").trim().slice(0, 600);
    const creatorBlurb = String(entry.creatorBlurb || "").trim().slice(0, 300);
    const creatorLinks = normalizeCreatorLinks(entry.creatorLinks);
    const hasLegacyCreatorApproval =
      entry?.creatorApplicationStatus === undefined &&
      entry?.creatorFollowerCount === undefined &&
      entry?.creatorPrimaryPlatform === undefined &&
      entry?.creatorProofUrl === undefined &&
      entry?.creatorReviewNote === undefined &&
      entry?.creatorApplicationNote === undefined;
    const creatorApplicationStatus = normalizeCreatorApplicationStatus(
      hasLegacyCreatorApproval && entry.creatorVisible && (creatorLinks.length || creatorBlurb) ? "approved" : entry.creatorApplicationStatus
    );
    const creatorVisible = Boolean(creatorApplicationStatus === "approved" && entry.creatorVisible && (creatorLinks.length || creatorBlurb));
    const creatorCommunityName = normalizeCreatorCommunityName(entry.creatorCommunityName);
    const creatorCommunitySummary = normalizeCreatorCommunitySummary(entry.creatorCommunitySummary);
    const creatorCommunityInviteUrl = normalizeCreatorCommunityInviteUrl(entry.creatorCommunityInviteUrl);
    const creatorSlug = createUniqueCreatorSlug(entry.creatorSlug || creatorCommunityName || displayName, [...usedCreatorSlugs]);
    const creatorFollowerCount = normalizeCreatorFollowerCount(entry.creatorFollowerCount);
    const creatorPrimaryPlatform = normalizeCreatorPrimaryPlatform(entry.creatorPrimaryPlatform);
    const creatorProofUrl = normalizeCreatorProofUrl(entry.creatorProofUrl);
    const creatorApplicationNote = normalizeCreatorApplicationNote(entry.creatorApplicationNote);
    const creatorReviewNote = normalizeCreatorReviewNote(entry.creatorReviewNote);
    const creatorReviewedAt = isIsoDate(entry.creatorReviewedAt) ? entry.creatorReviewedAt : "";
    const creatorReviewedBy = String(entry.creatorReviewedBy || "").trim();
    const creatorPresence = normalizeCreatorPresence(entry.creatorPresence);
    const creatorPresenceText = normalizeCreatorPresenceText(entry.creatorPresenceText);
    const creatorPresenceUrl = normalizeCreatorPresenceUrl(entry.creatorPresenceUrl);
    const creatorPresenceUpdatedAt = isIsoDate(entry.creatorPresenceUpdatedAt) ? entry.creatorPresenceUpdatedAt : "";
    const creatorWebhookToken = normalizeCreatorWebhookToken(entry.creatorWebhookToken);
    const creatorAutomationLastAt = isIsoDate(entry.creatorAutomationLastAt) ? entry.creatorAutomationLastAt : "";
    const creatorAutomationLastSource = normalizeCreatorAutomationSource(entry.creatorAutomationLastSource);
    const vrchatLinkedAt = isIsoDate(entry.vrchatLinkedAt) ? entry.vrchatLinkedAt : "";
    const vrchatLinkSource = normalizeVrchatLinkSource(entry.vrchatLinkSource);
    const weeklyHoursCapacity = normalizeWeeklyHoursCapacity(entry.weeklyHoursCapacity);
    const weeklyDaysCapacity = normalizeWeeklyDaysCapacity(entry.weeklyDaysCapacity);
    const overtimeAdjustments = normalizeOvertimeAdjustments(entry.overtimeAdjustments);
    const availabilitySchedule = normalizeAvailabilitySchedule(entry.availabilitySchedule);
    const availabilitySlots = normalizeAvailabilitySlots(entry.availabilitySlots);
    const availabilityUpdatedAt = isIsoDate(entry.availabilityUpdatedAt) ? entry.availabilityUpdatedAt : "";
    const lastLoginAt = isIsoDate(entry.lastLoginAt) ? entry.lastLoginAt : "";
    const lastSeenAt = isIsoDate(entry.lastSeenAt) ? entry.lastSeenAt : "";
    const isBlocked = Boolean(entry.isBlocked);
    const blockReason = String(entry.blockReason || "").trim().slice(0, 500);
    const blockedAt = isIsoDate(entry.blockedAt) ? entry.blockedAt : "";
    const blockedBy = String(entry.blockedBy || "").trim();
    const passwordHash = String(entry.passwordHash || "").trim();
    const normalizedRole = entry.role === "viewer" ? "member" : entry.role;
    const role = ["member", "moderator", "moderation_lead", "planner", "admin"].includes(normalizedRole) ? normalizedRole : "member";

    if (!username || !displayName || !vrchatName || !discordName || !passwordHash || usedUsernames.has(username)) continue;

    usedUsernames.add(username);
    usedCreatorSlugs.add(creatorSlug);
    normalized.push({
      id: String(entry.id || crypto.randomUUID()),
      username,
      displayName,
      role,
      vrchatName,
      discordName,
      avatarUrl,
      bio,
      contactNote,
      creatorBlurb,
      creatorLinks,
      creatorVisible,
      creatorSlug,
      creatorApplicationStatus,
      creatorFollowerCount,
      creatorPrimaryPlatform,
      creatorProofUrl,
      creatorApplicationNote,
      creatorReviewNote,
      creatorReviewedAt,
      creatorReviewedBy,
      creatorCommunityName,
      creatorCommunitySummary,
      creatorCommunityInviteUrl,
      creatorPresence,
      creatorPresenceText,
      creatorPresenceUrl,
      creatorPresenceUpdatedAt,
      creatorWebhookToken,
      creatorAutomationLastAt,
      creatorAutomationLastSource,
      vrchatLinkedAt,
      vrchatLinkSource,
      weeklyHoursCapacity,
      weeklyDaysCapacity,
      overtimeAdjustments,
      availabilitySchedule,
      availabilitySlots,
      availabilityUpdatedAt,
      lastLoginAt,
      lastSeenAt,
      isBlocked,
      blockReason,
      blockedAt,
      blockedBy,
      passwordHash
    });
  }

  if (!normalized.some((entry) => entry.role === "admin")) {
    normalized.unshift(buildSeedUser("admin", "System Admin", "admin", "admin123!"));
  }

  for (const name of uniqueStrings(legacyModeratorNames)) {
    if (normalized.some((entry) => entry.displayName.toLowerCase() === name.toLowerCase())) continue;

    const username = createUniqueUsername(name, normalized.map((entry) => entry.username));
    const creatorSlug = createUniqueCreatorSlug(name, [...usedCreatorSlugs]);
    usedCreatorSlugs.add(creatorSlug);
    normalized.push({
      id: crypto.randomUUID(),
      username,
      displayName: name,
      role: "moderator",
      vrchatName: name,
      discordName: username,
      avatarUrl: "",
      bio: "",
      contactNote: "",
      creatorBlurb: "",
      creatorLinks: [],
      creatorVisible: false,
      creatorSlug,
      creatorApplicationStatus: "none",
      creatorFollowerCount: 0,
      creatorPrimaryPlatform: "",
      creatorProofUrl: "",
      creatorApplicationNote: "",
      creatorReviewNote: "",
      creatorReviewedAt: "",
      creatorReviewedBy: "",
      creatorCommunityName: "",
      creatorCommunitySummary: "",
      creatorCommunityInviteUrl: "",
      creatorPresence: "offline",
      creatorPresenceText: "",
      creatorPresenceUrl: "",
      creatorPresenceUpdatedAt: "",
      creatorWebhookToken: createCreatorWebhookToken(),
      creatorAutomationLastAt: "",
      creatorAutomationLastSource: "",
      vrchatLinkedAt: "",
      vrchatLinkSource: "",
      weeklyHoursCapacity: 0,
      weeklyDaysCapacity: 0,
      overtimeAdjustments: [],
      availabilitySchedule: "",
      availabilitySlots: buildEmptyAvailabilitySlots(),
      availabilityUpdatedAt: "",
      lastLoginAt: "",
      lastSeenAt: "",
      isBlocked: false,
      blockReason: "",
      blockedAt: "",
      blockedBy: "",
      passwordHash: hashPassword("mod123!")
    });
  }

  return normalized;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    vrchatName: user.vrchatName || "",
    discordName: user.discordName || "",
    avatarUrl: user.avatarUrl || "",
    bio: user.bio || "",
    contactNote: user.contactNote || "",
    creatorBlurb: user.creatorBlurb || "",
    creatorLinks: normalizeCreatorLinks(user.creatorLinks),
    creatorVisible: Boolean(user.creatorVisible),
    creatorSlug: normalizeCreatorSlugValue(user.creatorSlug || user.creatorCommunityName || user.displayName),
    creatorCommunityName: normalizeCreatorCommunityName(user.creatorCommunityName),
    creatorCommunitySummary: normalizeCreatorCommunitySummary(user.creatorCommunitySummary),
    creatorCommunityInviteUrl: user.creatorCommunityInviteUrl || "",
    creatorPresence: normalizeCreatorPresence(user.creatorPresence),
    creatorPresenceText: normalizeCreatorPresenceText(user.creatorPresenceText),
    creatorPresenceUrl: user.creatorPresenceUrl || "",
    creatorPresenceUpdatedAt: isIsoDate(user.creatorPresenceUpdatedAt) ? user.creatorPresenceUpdatedAt : "",
    vrchatLinkedAt: isIsoDate(user.vrchatLinkedAt) ? user.vrchatLinkedAt : "",
    vrchatLinkSource: normalizeVrchatLinkSource(user.vrchatLinkSource)
  };
}

function buildCommunityPayload(store) {
  const team = store.users
    .filter((entry) => entry.role !== "member")
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  const creators = store.users
    .filter((entry) => entry.creatorVisible && (entry.creatorLinks || []).length)
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  return {
    team,
    creators,
    events: COMMUNITY_EVENTS,
    rules: COMMUNITY_RULES,
    faq: COMMUNITY_FAQ,
    stats: {
      members: store.users.filter((entry) => entry.role === "member").length,
      moderators: store.users.filter((entry) => entry.role === "moderator").length,
      planners: store.users.filter((entry) => entry.role === "planner" || entry.role === "admin").length,
      news: store.announcements.length,
      creators: creators.length
    }
  };
}

function validateRegistrationPayload(body, store) {
  const password = String(body.password || "");
  const vrchatName = String(body.vrchatName || "").trim();
  const discordName = String(body.discordName || "").trim();
  const avatarUrl = normalizeOptionalUrl(body.avatarUrl);
  const bio = String(body.bio || "").trim().slice(0, 600);
  const contactNote = String(body.contactNote || "").trim().slice(0, 600);
  const creatorBlurb = String(body.creatorBlurb || "").trim().slice(0, 300);
  const creatorLinks = normalizeCreatorLinks(body.creatorLinks);
  const creatorVisible = Boolean(body.creatorVisible && (creatorLinks.length || creatorBlurb));
  const creatorSlug = resolveUniqueCreatorSlug(store.users, null, body.creatorSlug || body.creatorCommunityName || vrchatName, vrchatName);
  const creatorCommunityName = normalizeCreatorCommunityName(body.creatorCommunityName);
  const creatorCommunitySummary = normalizeCreatorCommunitySummary(body.creatorCommunitySummary);
  const creatorCommunityInviteUrl = normalizeCreatorCommunityInviteUrl(body.creatorCommunityInviteUrl);
  const creatorApplicationStatus = normalizeCreatorApplicationStatus(body.creatorApplicationStatus);
  const creatorFollowerCount = normalizeCreatorFollowerCount(body.creatorFollowerCount);
  const creatorPrimaryPlatform = normalizeCreatorPrimaryPlatform(body.creatorPrimaryPlatform);
  const creatorProofUrl = normalizeCreatorProofUrl(body.creatorProofUrl);
  const creatorApplicationNote = normalizeCreatorApplicationNote(body.creatorApplicationNote);
  const creatorReviewNote = normalizeCreatorReviewNote(body.creatorReviewNote);
  const creatorReviewedAt = isIsoDate(body.creatorReviewedAt) ? body.creatorReviewedAt : "";
  const creatorReviewedBy = String(body.creatorReviewedBy || "").trim();
  const creatorPresence = normalizeCreatorPresence(body.creatorPresence);
  const creatorPresenceText = normalizeCreatorPresenceText(body.creatorPresenceText);
  const creatorPresenceUrl = normalizeCreatorPresenceUrl(body.creatorPresenceUrl);
  const creatorPresenceUpdatedAt =
    creatorPresence !== "offline" || creatorPresenceText || creatorPresenceUrl ? new Date().toISOString() : "";
  const weeklyHoursCapacity = normalizeWeeklyHoursCapacity(body.weeklyHoursCapacity);
  const weeklyDaysCapacity = normalizeWeeklyDaysCapacity(body.weeklyDaysCapacity);
  const availabilitySchedule = normalizeAvailabilitySchedule(body.availabilitySchedule);
  const availabilitySlots = normalizeAvailabilitySlots(body.availabilitySlots);
  const availabilityUpdatedAt =
    availabilitySchedule || weeklyHoursCapacity || weeklyDaysCapacity || hasAvailabilitySlots(availabilitySlots) ? new Date().toISOString() : "";

  if (!password || !vrchatName || !discordName) {
    const error = new Error("Bitte VRChat-Name, Discord-Name und Passwort ausfuellen.");
    error.statusCode = 400;
    throw error;
  }

  if (body.avatarUrl && !avatarUrl) {
    const error = new Error("Das Profilbild muss eine gueltige Bild-URL oder ein gueltiges Bild sein.");
    error.statusCode = 400;
    throw error;
  }

  ensureUserIdentityUnique(store.users, null, { vrchatName, discordName });

  return {
    displayName: vrchatName,
    username: createUniqueUsername(vrchatName, store.users.map((entry) => entry.username)),
    passwordHash: hashPassword(password),
    vrchatName,
    discordName,
    avatarUrl,
    bio,
    contactNote,
    creatorBlurb,
    creatorLinks,
    creatorVisible,
    creatorSlug,
    creatorApplicationStatus,
    creatorFollowerCount,
    creatorPrimaryPlatform,
    creatorProofUrl,
    creatorApplicationNote,
    creatorReviewNote,
    creatorReviewedAt,
    creatorReviewedBy,
    creatorCommunityName,
    creatorCommunitySummary,
    creatorCommunityInviteUrl,
    creatorPresence,
    creatorPresenceText,
    creatorPresenceUrl,
    creatorPresenceUpdatedAt,
    weeklyHoursCapacity,
    weeklyDaysCapacity,
    availabilitySchedule,
    availabilitySlots,
    availabilityUpdatedAt
  };
}

function applyUserIdentityUpdates(users, target, body, allowEmptyBio = true) {
  const nextVrchatName = body.vrchatName !== undefined ? String(body.vrchatName || "").trim() : target.vrchatName;
  const nextDiscordName = body.discordName !== undefined ? String(body.discordName || "").trim() : target.discordName;
  const nextAvatarUrl = body.avatarUrl !== undefined ? normalizeOptionalUrl(body.avatarUrl) : target.avatarUrl || "";
  const nextBio = body.bio !== undefined ? String(body.bio || "").trim().slice(0, 600) : target.bio || "";
  const nextContactNote = body.contactNote !== undefined ? String(body.contactNote || "").trim().slice(0, 600) : target.contactNote || "";
  const nextCreatorBlurb = body.creatorBlurb !== undefined ? String(body.creatorBlurb || "").trim().slice(0, 300) : target.creatorBlurb || "";
  const nextCreatorLinks = body.creatorLinks !== undefined ? normalizeCreatorLinks(body.creatorLinks) : Array.isArray(target.creatorLinks) ? target.creatorLinks : [];
  const nextCreatorCommunityName =
    body.creatorCommunityName !== undefined ? normalizeCreatorCommunityName(body.creatorCommunityName) : normalizeCreatorCommunityName(target.creatorCommunityName);
  const nextCreatorCommunitySummary =
    body.creatorCommunitySummary !== undefined
      ? normalizeCreatorCommunitySummary(body.creatorCommunitySummary)
      : normalizeCreatorCommunitySummary(target.creatorCommunitySummary);
  const nextCreatorCommunityInviteUrl =
    body.creatorCommunityInviteUrl !== undefined
      ? normalizeCreatorCommunityInviteUrl(body.creatorCommunityInviteUrl)
      : normalizeCreatorCommunityInviteUrl(target.creatorCommunityInviteUrl);
  const currentCreatorPresence = normalizeCreatorPresence(target.creatorPresence);
  const currentCreatorPresenceText = normalizeCreatorPresenceText(target.creatorPresenceText);
  const currentCreatorPresenceUrl = normalizeCreatorPresenceUrl(target.creatorPresenceUrl);
  const nextCreatorPresence =
    body.creatorPresence !== undefined ? normalizeCreatorPresence(body.creatorPresence) : currentCreatorPresence;
  const nextCreatorPresenceText =
    body.creatorPresenceText !== undefined ? normalizeCreatorPresenceText(body.creatorPresenceText) : currentCreatorPresenceText;
  const nextCreatorPresenceUrl =
    body.creatorPresenceUrl !== undefined ? normalizeCreatorPresenceUrl(body.creatorPresenceUrl) : currentCreatorPresenceUrl;
  const currentWeeklyHoursCapacity = normalizeWeeklyHoursCapacity(target.weeklyHoursCapacity);
  const currentWeeklyDaysCapacity = normalizeWeeklyDaysCapacity(target.weeklyDaysCapacity);
  const currentAvailabilitySchedule = normalizeAvailabilitySchedule(target.availabilitySchedule);
  const currentAvailabilitySlots = normalizeAvailabilitySlots(target.availabilitySlots);
  const nextWeeklyHoursCapacity =
    body.weeklyHoursCapacity !== undefined ? normalizeWeeklyHoursCapacity(body.weeklyHoursCapacity) : currentWeeklyHoursCapacity;
  const nextWeeklyDaysCapacity =
    body.weeklyDaysCapacity !== undefined ? normalizeWeeklyDaysCapacity(body.weeklyDaysCapacity) : currentWeeklyDaysCapacity;
  const nextAvailabilitySchedule =
    body.availabilitySchedule !== undefined ? normalizeAvailabilitySchedule(body.availabilitySchedule) : currentAvailabilitySchedule;
  const nextAvailabilitySlots =
    body.availabilitySlots !== undefined ? normalizeAvailabilitySlots(body.availabilitySlots) : currentAvailabilitySlots;
  const creatorApproved = normalizeCreatorApplicationStatus(target.creatorApplicationStatus) === "approved";
  const nextCreatorVisible =
    creatorApproved && body.creatorVisible !== undefined
      ? Boolean(body.creatorVisible && (nextCreatorLinks.length || nextCreatorBlurb))
      : Boolean(creatorApproved && target.creatorVisible && (nextCreatorLinks.length || nextCreatorBlurb));
  const nextCreatorSlug = resolveUniqueCreatorSlug(
    users,
    target.id,
    body.creatorSlug !== undefined ? body.creatorSlug || nextCreatorCommunityName || nextVrchatName : target.creatorSlug || nextCreatorCommunityName || nextVrchatName,
    nextVrchatName
  );

  if (!nextVrchatName) {
    const error = new Error("Der VRChat-Name darf nicht leer sein.");
    error.statusCode = 400;
    throw error;
  }

  if (!nextDiscordName) {
    const error = new Error("Der Discord-Name darf nicht leer sein.");
    error.statusCode = 400;
    throw error;
  }

  if (!allowEmptyBio && !nextBio) {
    const error = new Error("Bitte ein Kurzprofil eintragen.");
    error.statusCode = 400;
    throw error;
  }

  if (body.avatarUrl !== undefined && body.avatarUrl && !nextAvatarUrl) {
    const error = new Error("Das Profilbild ist nicht gueltig.");
    error.statusCode = 400;
    throw error;
  }

  if (body.creatorPresenceUrl !== undefined && body.creatorPresenceUrl && !nextCreatorPresenceUrl) {
    const error = new Error("Der Sonara-Live-Link ist nicht gueltig.");
    error.statusCode = 400;
    throw error;
  }

  if (body.creatorCommunityInviteUrl !== undefined && body.creatorCommunityInviteUrl && !nextCreatorCommunityInviteUrl) {
    const error = new Error("Der Creator-Community-Link ist nicht gueltig.");
    error.statusCode = 400;
    throw error;
  }

  ensureUserIdentityUnique(users, target.id, {
    vrchatName: nextVrchatName,
    discordName: nextDiscordName
  });

  target.vrchatName = nextVrchatName;
  target.displayName = nextVrchatName;
  target.discordName = nextDiscordName;
  target.avatarUrl = nextAvatarUrl;
  target.bio = nextBio;
  target.contactNote = nextContactNote;
  target.creatorBlurb = nextCreatorBlurb;
  target.creatorLinks = nextCreatorLinks;
  target.creatorVisible = nextCreatorVisible;
  target.creatorSlug = nextCreatorSlug;
  target.creatorCommunityName = nextCreatorCommunityName;
  target.creatorCommunitySummary = nextCreatorCommunitySummary;
  target.creatorCommunityInviteUrl = nextCreatorCommunityInviteUrl;
  target.creatorPresence = nextCreatorPresence;
  target.creatorPresenceText = nextCreatorPresenceText;
  target.creatorPresenceUrl = nextCreatorPresenceUrl;
  target.weeklyHoursCapacity = nextWeeklyHoursCapacity;
  target.weeklyDaysCapacity = nextWeeklyDaysCapacity;
  target.availabilitySchedule = nextAvailabilitySchedule;
  target.availabilitySlots = nextAvailabilitySlots;
  if (
    nextCreatorPresence !== currentCreatorPresence ||
    nextCreatorPresenceText !== currentCreatorPresenceText ||
    nextCreatorPresenceUrl !== currentCreatorPresenceUrl
  ) {
    target.creatorPresenceUpdatedAt =
      nextCreatorPresence !== "offline" || nextCreatorPresenceText || nextCreatorPresenceUrl ? new Date().toISOString() : "";
  }
  if (
    nextWeeklyHoursCapacity !== currentWeeklyHoursCapacity ||
    nextWeeklyDaysCapacity !== currentWeeklyDaysCapacity ||
    nextAvailabilitySchedule !== currentAvailabilitySchedule ||
    JSON.stringify(nextAvailabilitySlots) !== JSON.stringify(currentAvailabilitySlots)
  ) {
    target.availabilityUpdatedAt =
      nextAvailabilitySchedule || nextWeeklyHoursCapacity || nextWeeklyDaysCapacity || hasAvailabilitySlots(nextAvailabilitySlots)
        ? new Date().toISOString()
        : "";
  }
}

function normalizeStore(store) {
  const defaults = buildDefaultStore();
  const slots = normalizeSlots(store?.slots, defaults.slots);
  const users = normalizeUsers(store?.users || [], slots.map((entry) => entry.name));
  const settings = normalizeSettings(store?.settings || {}, slots);
  const rawShifts = Array.isArray(store?.shifts) ? store.shifts : migrateLegacyPlanning(store || defaults, users, settings);
  const shifts = normalizeShifts(rawShifts, users);
  const events = normalizeEvents(Array.isArray(store?.events) ? store.events : buildDefaultEvents());

  return {
    slots,
    users,
    settings,
    systemNotice: normalizeSystemNotice(store?.systemNotice),
    promoVideo: normalizePromoVideo(store?.promoVideo),
    shifts,
    events,
    requests: Array.isArray(store?.requests) ? normalizeRequests(store.requests, users) : [],
    announcements: Array.isArray(store?.announcements) ? normalizeAnnouncements(store.announcements, users) : [],
    chatMessages: Array.isArray(store?.chatMessages) ? normalizeChatMessages(store.chatMessages, users, shifts) : [],
    timeEntries: Array.isArray(store?.timeEntries) ? normalizeTimeEntries(store.timeEntries, users, shifts) : [],
    swapRequests: Array.isArray(store?.swapRequests) ? normalizeSwapRequests(store.swapRequests, users, shifts) : [],
    discordStatus: normalizeDiscordStatus(store?.discordStatus),
    vrchatAnalytics: normalizeVrchatAnalytics(store?.vrchatAnalytics),
    directMessages: Array.isArray(store?.directMessages) ? normalizeDirectMessages(store.directMessages, users) : [],
    forumThreads: Array.isArray(store?.forumThreads) ? normalizeForumThreads(store.forumThreads, users) : [],
    warnings: Array.isArray(store?.warnings) ? normalizeWarnings(store.warnings, users) : [],
    feedPosts: normalizeFeedPosts(store?.feedPosts, users)
  };
}

function projectDataForRole(user, store) {
  const community = buildCommunityPayload(store);
  const notifications = buildNotifications(user, store);
  const announcements = store.announcements
    .slice()
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return new Date(right.createdAt) - new Date(left.createdAt);
    })
    .map((entry) => decorateAnnouncement(entry, store));
  const directory = store.users
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);
  const communityChatMessages = getChatMessagesForUser(user, store, "community");
  const staffChatMessages = getChatMessagesForUser(user, store, "staff");

  const base = {
    community,
    announcements,
    systemNotice: decorateSystemNotice(store.systemNotice, store),
    promoVideo: decoratePromoVideo(store.promoVideo, store),
    directory,
    communityChatMessages,
    staffChatMessages,
    chatMessages: user.role === "member" ? communityChatMessages : staffChatMessages,
    directMessages: getDirectMessagesForUser(user, store),
    forumThreads: (store.forumThreads || []).map((entry) => decorateForumThread(entry, store)),
    warnings: getWarningsForUser(user, store),
    notifications,
    swapRequests: getSwapRequestsForUser(user, store)
  };

  if (user.role === "member") {
    return {
      ...base,
      requests: store.requests
        .filter((entry) => entry.userId === user.id)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map((entry) => decorateRequest(entry, store))
    };
  }

  if (user.role === "moderator") {
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
    settings: store.settings,
    users: directory,
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

function validateDirectMessagePayload(body, user, store) {
  const recipientId = String(body.recipientId || "").trim();
  const content = String(body.content || "").trim();

  if (!recipientId || !content) {
    const error = new Error("Bitte Empfaenger und Nachricht angeben.");
    error.statusCode = 400;
    throw error;
  }

  if (recipientId === user.id) {
    const error = new Error("Du kannst dir nicht selbst schreiben.");
    error.statusCode = 400;
    throw error;
  }

  if (!store.users.some((entry) => entry.id === recipientId)) {
    const error = new Error("Der ausgewaehlte Empfaenger existiert nicht.");
    error.statusCode = 400;
    throw error;
  }

  return { recipientId, content };
}

function validateForumThreadPayload(body, store) {
  const title = String(body.title || "").trim();
  const category = String(body.category || "Allgemein").trim() || "Allgemein";
  const threadBody = String(body.body || "").trim();
  const creatorCommunityId = normalizeCreatorCommunityId(body.creatorCommunityId, store, { throwIfInvalid: true });

  if (!title || !threadBody) {
    const error = new Error("Bitte Titel und Beitrag angeben.");
    error.statusCode = 400;
    throw error;
  }

  return { title, body: threadBody, category, creatorCommunityId };
}

function validateForumReplyPayload(body) {
  const replyBody = String(body.body || "").trim();
  if (!replyBody) {
    const error = new Error("Bitte eine Antwort eingeben.");
    error.statusCode = 400;
    throw error;
  }
  return { body: replyBody };
}

function validateWarningPayload(body, store) {
  const userId = String(body.userId || "").trim();
  const reason = String(body.reason || "").trim();

  if (!userId || !reason) {
    const error = new Error("Bitte Benutzer und Begruendung angeben.");
    error.statusCode = 400;
    throw error;
  }

  if (!store.users.some((entry) => entry.id === userId)) {
    const error = new Error("Der ausgewaehlte Benutzer existiert nicht.");
    error.statusCode = 400;
    throw error;
  }

  return { userId, reason };
}

function decorateDirectMessage(entry, store) {
  return {
    ...entry,
    senderName: findUserName(store.users, entry.senderId),
    recipientName: findUserName(store.users, entry.recipientId)
  };
}

function decorateForumThread(entry, store) {
  const creatorCommunity = (store.users || []).find((user) => user.id === entry.creatorCommunityId && hasVisibleCreatorProfile(user));
  return {
    ...entry,
    authorName: findUserName(store.users, entry.authorId),
    creatorCommunityId: creatorCommunity?.id || "",
    creatorCommunityName: creatorCommunity ? normalizeCreatorCommunityName(creatorCommunity.creatorCommunityName) || `${findUserName(store.users, creatorCommunity.id)} Community` : "",
    creatorCommunityOwnerName: creatorCommunity ? findUserName(store.users, creatorCommunity.id) : "",
    replies: (entry.replies || [])
      .slice()
      .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
      .map((reply) => ({
        ...reply,
        authorName: findUserName(store.users, reply.authorId)
      }))
  };
}

function decorateWarning(entry, store) {
  return {
    ...entry,
    userName: findUserName(store.users, entry.userId),
    createdByName: findUserName(store.users, entry.createdBy),
    clearedByName: entry.clearedBy ? findUserName(store.users, entry.clearedBy) : ""
  };
}

function getChatMessagesForUser(user, store, channel) {
  if (channel === "staff" && user.role === "member") {
    return [];
  }

  return store.chatMessages
    .filter((entry) => entry.channel === channel)
    .slice()
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .map((entry) => decorateChatMessage(entry, store));
}

function getDirectMessagesForUser(user, store) {
  return (store.directMessages || [])
    .filter((entry) => entry.senderId === user.id || entry.recipientId === user.id)
    .slice()
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .map((entry) => decorateDirectMessage(entry, store));
}

function getWarningsForUser(user, store) {
  const warnings = (store.warnings || []).slice().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  return warnings.filter((entry) => entry.userId === user.id).map((entry) => decorateWarning(entry, store));
}

function getManagedWarnings(store) {
  return (store.warnings || [])
    .slice()
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .map((entry) => decorateWarning(entry, store));
}

function projectDataForRole(user, store) {
  const community = buildCommunityPayload(store);
  const notifications = buildNotifications(user, store);
  const announcements = store.announcements
    .slice()
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return new Date(right.createdAt) - new Date(left.createdAt);
    })
    .map((entry) => decorateAnnouncement(entry, store));
  const directory = store.users
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  const base = {
    community,
    announcements,
    directory,
    communityChatMessages: getChatMessagesForUser(user, store, "community"),
    staffChatMessages: getChatMessagesForUser(user, store, "staff"),
    directMessages: getDirectMessagesForUser(user, store),
    forumThreads: (store.forumThreads || []).map((entry) => decorateForumThread(entry, store)),
    warnings: getWarningsForUser(user, store),
    notifications,
    swapRequests: getSwapRequestsForUser(user, store)
  };

  if (user.role === "member") {
    return {
      ...base,
      requests: store.requests
        .filter((entry) => entry.userId === user.id)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map((entry) => decorateRequest(entry, store))
    };
  }

  if (user.role === "moderator") {
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
    settings: store.settings,
    users: directory,
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

function buildNotifications(user, store) {
  const warningNotifications = (store.warnings || [])
    .filter((entry) => entry.status === "active" && entry.userId === user.id && !entry.acknowledgedAt)
    .map((entry) => ({
      id: `warning-${entry.id}`,
      title: "Wichtige Verwarnung",
      body: entry.reason,
      tone: "rose",
      createdAt: entry.createdAt,
      category: "warnung"
    }));

  const rest =
    user.role === "member"
      ? buildCommunityNotifications(store)
      : user.role === "moderator"
        ? buildViewerNotifications(user, store)
        : buildManagerNotifications(store);

  return [...warningNotifications, ...rest]
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, 8);
}

function ensureUserIsNotLinked(userId, store) {
  const linked =
    store.shifts.some((entry) => entry.memberId === userId) ||
    store.requests.some((entry) => entry.userId === userId) ||
    store.chatMessages.some((entry) => entry.authorId === userId) ||
    (store.directMessages || []).some((entry) => entry.senderId === userId || entry.recipientId === userId) ||
    (store.forumThreads || []).some(
      (entry) => entry.authorId === userId || (entry.replies || []).some((reply) => reply.authorId === userId)
    ) ||
    (store.warnings || []).some((entry) => entry.userId === userId || entry.createdBy === userId || entry.clearedBy === userId) ||
    store.swapRequests.some((entry) => entry.requesterId === userId || entry.candidateIds.includes(userId) || entry.approvedCandidateId === userId) ||
    store.timeEntries.some((entry) => entry.userId === userId);

  if (linked) {
    const error = new Error("Der Benutzer hat noch verknuepfte Daten und kann nicht geloescht werden.");
    error.statusCode = 400;
    throw error;
  }
}

function normalizeChatMessages(messages, users, shifts) {
  const validUserIds = new Set(users.map((entry) => entry.id));
  const validShiftIds = new Set(shifts.map((entry) => entry.id));
  const validChannels = new Set(["community", "staff"]);

  return messages
    .map((entry) => {
      const channel = validChannels.has(String(entry.channel || "").trim()) ? String(entry.channel).trim() : "staff";
      return {
        id: String(entry.id || crypto.randomUUID()),
        authorId: String(entry.authorId || "").trim(),
        channel,
        relatedShiftId: validShiftIds.has(String(entry.relatedShiftId || "").trim()) ? String(entry.relatedShiftId).trim() : "",
        content: String(entry.content || "").trim(),
        createdAt: isIsoDate(entry.createdAt) ? entry.createdAt : new Date().toISOString()
      };
    })
    .filter((entry) => validUserIds.has(entry.authorId) && entry.content);
}

function projectDataForRole(user, store) {
  const community = buildCommunityPayload(store);
  const notifications = buildNotifications(user, store);
  const announcements = store.announcements
    .slice()
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return new Date(right.createdAt) - new Date(left.createdAt);
    })
    .map((entry) => decorateAnnouncement(entry, store));
  const communityChatMessages = getChatMessagesForUser(user, store, "community");
  const staffChatMessages = getChatMessagesForUser(user, store, "staff");

  const base = {
    community,
    announcements,
    communityChatMessages,
    staffChatMessages,
    chatMessages: user.role === "member" ? communityChatMessages : staffChatMessages,
    notifications,
    swapRequests: getSwapRequestsForUser(user, store)
  };

  if (user.role === "member") {
    return {
      ...base,
      requests: store.requests
        .filter((entry) => entry.userId === user.id)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map((entry) => decorateRequest(entry, store))
    };
  }

  if (user.role === "moderator") {
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
    settings: store.settings,
    users: store.users
      .slice()
      .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
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

function getChatMessagesForUser(user, store, channel) {
  if (channel === "staff" && user.role === "member") {
    return [];
  }

  return store.chatMessages
    .filter((entry) => entry.channel === channel)
    .slice()
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .map((entry) => decorateChatMessage(entry, store));
}

function decorateChatMessage(entry, store) {
  const relatedShift = store.shifts.find((shift) => shift.id === entry.relatedShiftId);
  return {
    ...entry,
    authorName: findUserName(store.users, entry.authorId),
    relatedShift: relatedShift ? decorateShift(relatedShift, store) : null
  };
}

function validateChatPayload(body, user, store) {
  const content = String(body.content || "").trim();
  const requestedChannel = String(body.channel || "").trim();
  const channel = ["community", "staff"].includes(requestedChannel)
    ? requestedChannel
    : user.role === "member"
      ? "community"
      : "staff";
  const relatedShiftId = String(body.relatedShiftId || "").trim();

  if (!content) {
    const error = new Error("Bitte eine Chat-Nachricht eingeben.");
    error.statusCode = 400;
    throw error;
  }

  if (channel === "staff" && user.role === "member") {
    const error = new Error("Community-Mitglieder koennen nicht in den Staff-Chat posten.");
    error.statusCode = 403;
    throw error;
  }

  if (channel === "community" && relatedShiftId) {
    const error = new Error("Im Community-Chat koennen keine Schichten referenziert werden.");
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
    if (user.role === "moderator" && shift.memberId !== user.id) {
      const error = new Error("Moderatoren duerfen nur ihre eigenen Schichten referenzieren.");
      error.statusCode = 403;
      throw error;
    }
  }

  return { content, relatedShiftId, channel };
}

function buildCommunityPayload(store) {
  const activeUsers = (store.users || []).filter((entry) => !entry.isBlocked);
  const team = activeUsers
    .filter((entry) => entry.role !== "member")
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);

  const creators = activeUsers
    .filter((entry) => entry.creatorVisible && (((entry.creatorLinks || []).length > 0) || entry.creatorBlurb))
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);
  const creatorActivity = getCreatorPresenceUsers(store).map(sanitizeUser);
  const liveCreators = creatorActivity.filter((entry) => normalizeCreatorPresence(entry.creatorPresence) === "live");

  return {
    team,
    creators,
    liveCreators,
    creatorActivity,
    events: (store.events || []).slice().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)),
    rules: COMMUNITY_RULES,
    faq: COMMUNITY_FAQ,
    stats: {
      members: activeUsers.filter((entry) => entry.role === "member").length,
      moderators: activeUsers.filter((entry) => entry.role === "moderator" || entry.role === "moderation_lead").length,
      planners: activeUsers.filter((entry) => entry.role === "planner" || entry.role === "admin").length,
      news: store.announcements.length,
      creators: creators.length,
      liveCreators: liveCreators.length,
      creatorActivity: creatorActivity.length
    }
  };
}

function projectDataForRole(user, store) {
  const community = buildCommunityPayload(store);
  const notifications = buildNotifications(user, store);
  const announcements = store.announcements
    .slice()
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return new Date(right.createdAt) - new Date(left.createdAt);
    })
    .map((entry) => decorateAnnouncement(entry, store));
  const directory = store.users
    .filter((entry) => !entry.isBlocked)
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeUser);
  const communityChatMessages = getChatMessagesForUser(user, store, "community");
  const staffChatMessages = getChatMessagesForUser(user, store, "staff");
  const feedPosts = (store.feedPosts || []).map((entry) => decorateFeedPost(entry, store));
  const managedUsers = store.users
    .slice()
    .sort((left, right) => findUserName(store.users, left.id).localeCompare(findUserName(store.users, right.id), "de"))
    .map(sanitizeManagedUser);

  const base = {
    community,
    announcements,
    systemNotice: decorateSystemNotice(store.systemNotice, store),
    promoVideo: decoratePromoVideo(store.promoVideo, store),
    directory,
    communityChatMessages,
    staffChatMessages,
    chatMessages: user.role === "member" ? communityChatMessages : staffChatMessages,
    directMessages: getDirectMessagesForUser(user, store),
    forumThreads: (store.forumThreads || []).map((entry) => decorateForumThread(entry, store)),
    warnings: getWarningsForUser(user, store),
    managedWarnings: canCoordinateModeration(user) ? getManagedWarnings(store) : [],
    notifications,
    swapRequests: getSwapRequestsForUser(user, store),
    feedPosts
  };

  if (user.role === "member") {
    return {
      ...base,
      requests: store.requests
        .filter((entry) => entry.userId === user.id)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map((entry) => decorateRequest(entry, store))
    };
  }

  if (user.role === "moderator") {
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
    settings: store.settings,
    users: managedUsers,
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
