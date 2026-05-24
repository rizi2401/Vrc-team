const {
  ensureAnalyticsSchema,
  startSyncRun,
  finishSyncRun,
  upsertGroupState,
  insertInstanceSnapshots,
  insertAuditEvents,
  loadVrchatSession,
  saveVrchatSession,
  getAnalyticsOverview
} = require("./analytics_store");
const packageInfo = require("./package.json");

const VRCHAT_API_BASE = "https://api.vrchat.cloud/api/1";

async function syncVrchatAnalytics() {
  const config = getVrchatConfig();
  if (config.missing.length) {
    return {
      ok: false,
      message: "VRChat-Konfiguration ist unvollstaendig.",
      overview: await getAnalyticsOverview(config)
    };
  }

  await ensureAnalyticsSchema();
  const runId = await startSyncRun();

  try {
    const existingSession = await loadVrchatSession(config.sessionKey);
    const client = new VrchatClient(config.username, config.password, existingSession?.cookies);
    await client.ensureAuthenticated();
    await saveVrchatSession(config.sessionKey, client.exportCookies(), {});

    const group = await client.resolveGroup(config.groupLookup);
    const groupDetails = await client.getGroup(group.id);
    const instances = await client.getGroupInstances(group.id);
    const worldNames = await client.getWorldNames(instances.map((entry) => entry.worldId).filter(Boolean));
    const auditLogResponse = await client.getGroupAuditLogs(group.id);

    const normalizedGroup = {
      groupId: groupDetails.id || group.id,
      lookup: config.groupLookup,
      name: groupDetails.name || group.name || config.groupLookup,
      shortCode: groupDetails.shortCode || group.shortCode || "",
      discriminator: groupDetails.discriminator || group.discriminator || "",
      memberCount: Number(groupDetails.memberCount || group.memberCount || 0),
      raw: groupDetails
    };

    const normalizedInstances = instances.map((entry) => ({
      worldId: entry.worldId,
      worldName: worldNames.get(entry.worldId) || entry.worldName || entry.worldId || "Unbekannte Welt",
      instanceId: entry.instanceId,
      instanceType: entry.instanceType,
      playerCount: entry.playerCount,
      raw: entry.raw
    }));

    const normalizedAuditEvents = (auditLogResponse.results || []).map((entry) => ({
      id: entry.id,
      eventType: entry.eventType,
      actorId: entry.actorId || "",
      actorName: entry.actorDisplayName || "",
      targetId: entry.targetId || "",
      targetName: entry.targetDisplayName || "",
      description: entry.description || "",
      createdAt: entry.created_at || new Date().toISOString(),
      raw: entry
    }));

    await upsertGroupState(normalizedGroup);
    await insertInstanceSnapshots(normalizedGroup.groupId, normalizedInstances);
    await insertAuditEvents(normalizedGroup.groupId, normalizedAuditEvents);
    await saveVrchatSession(config.sessionKey, client.exportCookies(), {});

    const summary = {
      groupId: normalizedGroup.groupId,
      instances: normalizedInstances.length,
      auditEvents: normalizedAuditEvents.length,
      syncedAt: new Date().toISOString()
    };

    await finishSyncRun(runId, "success", summary);

    return {
      ok: true,
      message: "VRChat-Daten wurden synchronisiert.",
      overview: await getAnalyticsOverview(config)
    };
  } catch (error) {
    if (isPendingVrchatAuthError(error)) {
      await saveVrchatSession(config.sessionKey, error.cookies || {}, error.pendingAuth || {});
    }
    await finishSyncRun(runId, "failed", {}, error.message);
    return {
      ok: false,
      message: error.message,
      overview: await getAnalyticsOverview(config)
    };
  }
}

async function fetchVrchatOverview() {
  return getAnalyticsOverview(getVrchatConfig());
}

async function verifyVrchatSecurityCode(code) {
  const config = getVrchatConfig();
  if (config.missing.length) {
    return {
      ok: false,
      message: "VRChat-Konfiguration ist unvollstaendig.",
      overview: await getAnalyticsOverview(config)
    };
  }

  await ensureAnalyticsSchema();
  const existingSession = await loadVrchatSession(config.sessionKey);
  const pendingAuth = existingSession?.authState || {};
  const normalizedCode = String(code || "").trim();

  if (!normalizedCode) {
    return {
      ok: false,
      message: "Bitte einen VRChat-Sicherheitscode eingeben.",
      overview: await getAnalyticsOverview(config)
    };
  }

  if (pendingAuth?.type !== "emailOtp") {
    return {
      ok: false,
      message: "Aktuell wartet kein E-Mail-Sicherheitscode auf Bestätigung.",
      overview: await getAnalyticsOverview(config)
    };
  }

  try {
    const client = new VrchatClient(config.username, config.password, existingSession?.cookies);
    await client.verifyEmailOtp(normalizedCode);
    await client.getCurrentUser();
    await saveVrchatSession(config.sessionKey, client.exportCookies(), {});

    return {
      ok: true,
      message: "VRChat-Sicherheitscode wurde bestätigt.",
      overview: await getAnalyticsOverview(config)
    };
  } catch (error) {
    if (isPendingVrchatAuthError(error)) {
      await saveVrchatSession(config.sessionKey, error.cookies || existingSession?.cookies || {}, error.pendingAuth || pendingAuth);
    }
    return {
      ok: false,
      message: error.message,
      overview: await getAnalyticsOverview(config)
    };
  }
}

function getVrchatConfig() {
  const username = String(process.env.VRCHAT_USERNAME || "").trim();
  const password = String(process.env.VRCHAT_PASSWORD || "").trim();
  const groupLookup = String(process.env.VRCHAT_GROUP_LOOKUP || "").trim();
  const appContact = String(process.env.VRCHAT_APP_CONTACT || "").trim();
  const missing = [];

  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!username) missing.push("VRCHAT_USERNAME");
  if (!password) missing.push("VRCHAT_PASSWORD");
  if (!groupLookup) missing.push("VRCHAT_GROUP_LOOKUP");
  if (!appContact) missing.push("VRCHAT_APP_CONTACT");

  return {
    username,
    password,
    groupLookup,
    appContact,
    sessionKey: `vrchat:${username || "default"}`,
    missing
  };
}

class VrchatClient {
  constructor(username, password, initialCookies = {}) {
    this.username = username;
    this.password = password;
    this.cookies = new Map(
      Object.entries(initialCookies || {}).filter(([, value]) => value !== undefined && value !== null && value !== "")
    );
  }

  async ensureAuthenticated() {
    if (this.cookies.size) {
      try {
        const currentUser = await this.getCurrentUser();
        this.ensureFullyVerified(currentUser);
        return;
      } catch (error) {
        if (!isAuthenticationError(error)) {
          throw error;
        }
        this.cookies.clear();
      }
    }

    await this.login();
    const currentUser = await this.getCurrentUser();
    this.ensureFullyVerified(currentUser);
  }

  async login() {
    const result = await this.request("/auth/user", {
      headers: {
        Authorization: `Basic ${encodeCredentials(this.username, this.password)}`
      }
    });
    this.ensureFullyVerified(result);
    return result;
  }

  async getCurrentUser() {
    return this.request("/auth/user");
  }

  async verifyEmailOtp(code) {
    return this.request("/auth/twofactorauth/emailotp/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ code: String(code || "").trim() })
    });
  }

  async resolveGroup(groupLookup) {
    if (groupLookup.startsWith("grp_")) {
      return this.getGroup(groupLookup);
    }

    const [shortCode, discriminator = ""] = groupLookup.split(".");
    const result = await this.request(`/groups?query=${encodeURIComponent(shortCode)}&n=20`);
    const match = (Array.isArray(result) ? result : []).find((entry) => {
      return (
        String(entry.shortCode || "").toUpperCase() === shortCode.toUpperCase() &&
        (!discriminator || String(entry.discriminator || "") === discriminator)
      );
    });

    if (!match) {
      throw new Error("VRChat-Gruppe konnte ueber den Lookup nicht gefunden werden.");
    }

    return match;
  }

  async getGroup(groupId) {
    return this.request(`/groups/${encodeURIComponent(groupId)}`);
  }

  async getGroupInstances(groupId) {
    const response = await this.request(`/groups/${encodeURIComponent(groupId)}/instances`);
    const list = Array.isArray(response) ? response : [];
    return list.map((entry) => normalizeInstance(entry));
  }

  async getGroupAuditLogs(groupId) {
    return this.request(`/groups/${encodeURIComponent(groupId)}/auditLogs?n=100&offset=0`);
  }

  async getWorldNames(worldIds) {
    const uniqueIds = [...new Set(worldIds)];
    const names = new Map();
    for (const worldId of uniqueIds) {
      try {
        const world = await this.request(`/worlds/${encodeURIComponent(worldId)}`);
        names.set(worldId, world.name || worldId);
      } catch {
        names.set(worldId, worldId);
      }
    }
    return names;
  }

  async request(path, options = {}) {
    const response = await fetch(`${VRCHAT_API_BASE}${path}`, {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": buildVrchatUserAgent(),
        ...(this.cookies.size ? { Cookie: this.serializeCookies() } : {}),
        ...(options.headers || {})
      },
      body: options.body
    });

    this.captureCookies(response);
    const rawBody = await response.text();
    const payload = rawBody ? safeJsonParse(rawBody) : {};
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `VRChat request failed: ${response.status}`;
      const error = new Error(message);
      error.statusCode = response.status;
      error.responseBody = payload;
      error.cookies = this.exportCookies();
      const pendingAuth = detectPendingAuthFromPayload(payload, message);
      if (pendingAuth) {
        error.pendingAuth = pendingAuth;
      }
      throw error;
    }
    const pendingAuth = detectPendingAuthFromPayload(payload, "");
    if (pendingAuth) {
      const error = new Error(pendingAuth.message);
      error.statusCode = 401;
      error.responseBody = payload;
      error.cookies = this.exportCookies();
      error.pendingAuth = pendingAuth;
      throw error;
    }
    return payload;
  }

  captureCookies(response) {
    const setCookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];

    for (const rawCookie of setCookies) {
      const [pair] = rawCookie.split(";");
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      this.cookies.set(name, value);
    }
  }

  serializeCookies() {
    return [...this.cookies.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  exportCookies() {
    return Object.fromEntries(this.cookies.entries());
  }

  ensureFullyVerified(payload) {
    const pendingAuth = detectPendingAuthFromPayload(payload, "");
    if (!pendingAuth) return;

    const error = new Error(pendingAuth.message);
    error.statusCode = 401;
    error.responseBody = payload;
    error.cookies = this.exportCookies();
    error.pendingAuth = pendingAuth;
    throw error;
  }
}

function buildVrchatUserAgent() {
  const appName = String(process.env.VRCHAT_APP_NAME || packageInfo.name || "vrc-team-portal").trim();
  const appVersion = String(process.env.VRCHAT_APP_VERSION || packageInfo.version || "1.0.0").trim();
  const appContact = String(process.env.VRCHAT_APP_CONTACT || "").trim();
  return `${appName}/${appVersion} (${appContact})`;
}

function encodeCredentials(username, password) {
  return Buffer.from(`${username}:${password}`, "utf8").toString("base64");
}

function normalizeInstance(entry) {
  const location = String(entry.location || "");
  const [worldId = "", instanceIdFromLocation = ""] = location.split(":");
  const instanceId = String(entry.instanceId || instanceIdFromLocation || "").trim();

  return {
    worldId,
    worldName: entry.worldName || "",
    instanceId,
    instanceType: String(entry.groupAccessType || entry.type || inferInstanceType(instanceId)).trim() || "group",
    playerCount: Number(
      entry.n_users ??
      entry.userCount ??
      entry.usercount ??
      entry.playerCount ??
      entry.memberCount ??
      0
    ),
    raw: entry
  };
}

function inferInstanceType(instanceId) {
  if (!instanceId) return "";
  const lower = instanceId.toLowerCase();
  if (lower.includes("groupaccess")) return "group";
  if (lower.includes("group(")) return "group";
  if (lower.includes("private")) return "private";
  return "group";
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return { message: String(value || "").trim() };
  }
}

function isAuthenticationError(error) {
  if (!error) return false;
  const statusCode = Number(error.statusCode || 0);
  if (statusCode === 401 || statusCode === 403) return true;

  const message = String(error.message || "").toLowerCase();
  return (
    message.includes("missing credentials") ||
    message.includes("unauthorized") ||
    message.includes("login") ||
      message.includes("auth")
  );
}

function detectPendingAuthFromPayload(payload, fallbackMessage = "") {
  const required = Array.isArray(payload?.requiresTwoFactorAuth) ? payload.requiresTwoFactorAuth.map((entry) => String(entry || "").toLowerCase()) : [];
  if (required.includes("emailotp")) {
    return {
      type: "emailOtp",
      message: "VRChat hat einen Sicherheitscode per E-Mail geschickt. Bitte gib ihn im Portal ein.",
      source: "requiresTwoFactorAuth"
    };
  }

  const message = String(fallbackMessage || payload?.error?.message || payload?.message || "").toLowerCase();
  if (message.includes("too many places") || message.includes("verification link") || message.includes("verify login place")) {
    return {
      type: "loginPlace",
      message: "VRChat verlangt zuerst die Bestätigung des Login-Orts per E-Mail-Link.",
      source: "loginPlace"
    };
  }

  return null;
}

function isPendingVrchatAuthError(error) {
  return Boolean(error?.pendingAuth);
}

module.exports = {
  syncVrchatAnalytics,
  fetchVrchatOverview,
  verifyVrchatSecurityCode,
  getVrchatConfig
};
