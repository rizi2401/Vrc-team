const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const ROOT_DIR = __dirname;
const ENV_PATH = path.join(ROOT_DIR, ".env");
const DATA_DIR = path.join(ROOT_DIR, ".data");
const SESSION_PATH = path.join(DATA_DIR, "tiktok-session.json");
const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};
const fileEnv = loadEnv(ENV_PATH);
const env = {
  ...fileEnv,
  ...process.env
};
const HOST = env.HOST || "0.0.0.0";
const PORT = Number(env.PORT || 3000);
const PUBLIC_APP_URL = env.PUBLIC_APP_URL || env.RENDER_EXTERNAL_URL || "";
const TIKTOK_CALLBACK_PATH = "/auth/tiktok/callback/";
const TIKTOK_CLIENT_KEY = env.TIKTOK_CLIENT_KEY || "";
const TIKTOK_CLIENT_SECRET = env.TIKTOK_CLIENT_SECRET || "";
const TIKTOK_REDIRECT_URI = env.TIKTOK_REDIRECT_URI || "";
const TIKTOK_SCOPES = env.TIKTOK_SCOPES || "user.info.basic,video.list";
const pendingStates = new Map();

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const parsed = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    parsed[key] = value;
  }

  return parsed;
}

function isTikTokConfigured() {
  return Boolean(TIKTOK_CLIENT_KEY && TIKTOK_CLIENT_SECRET);
}

function createCodeVerifier(length = 64) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.randomBytes(length);
  let verifier = "";

  for (let index = 0; index < length; index += 1) {
    verifier += alphabet[bytes[index] % alphabet.length];
  }

  return verifier;
}

function createCodeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("hex");
}

function buildBaseUrl(request) {
  return `http://${request.headers.host || `${HOST}:${PORT}`}`;
}

function trimTrailingSlash(value = "") {
  return value.replace(/\/+$/, "");
}

function getPublicBaseUrl(request) {
  if (PUBLIC_APP_URL) {
    return trimTrailingSlash(PUBLIC_APP_URL);
  }

  const forwardedProtoHeader = request?.headers["x-forwarded-proto"];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader?.split(",")[0];
  const protocol = forwardedProto || "http";
  const hostHeader = request?.headers["x-forwarded-host"] || request?.headers.host;

  if (hostHeader) {
    return `${protocol}://${hostHeader}`;
  }

  return `http://127.0.0.1:${PORT}`;
}

function getTikTokRedirectUri(request) {
  if (TIKTOK_REDIRECT_URI) {
    return TIKTOK_REDIRECT_URI;
  }

  return `${getPublicBaseUrl(request)}${TIKTOK_CALLBACK_PATH}`;
}

function shouldUsePkce(redirectUri) {
  return (
    redirectUri.startsWith("http://127.0.0.1") ||
    redirectUri.startsWith("http://localhost") ||
    env.TIKTOK_USE_PKCE === "true"
  );
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function redirect(response, location) {
  response.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store"
  });
  response.end();
}

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

async function readSession() {
  try {
    const raw = await fsp.readFile(SESSION_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeSession(session) {
  await ensureDataDir();
  await fsp.writeFile(SESSION_PATH, `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

async function clearSession() {
  try {
    await fsp.unlink(SESSION_PATH);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function tokenExpiresSoon(session, thresholdMinutes = 10) {
  if (!session?.access_token_expires_at) {
    return true;
  }

  const thresholdMs = thresholdMinutes * 60 * 1000;
  return Date.now() >= session.access_token_expires_at - thresholdMs;
}

function buildStoredSession(tokenResponse) {
  return {
    ...tokenResponse,
    granted_scopes: tokenResponse.scope || TIKTOK_SCOPES,
    created_at: new Date().toISOString(),
    access_token_expires_at: Date.now() + Number(tokenResponse.expires_in || 0) * 1000,
    refresh_token_expires_at: Date.now() + Number(tokenResponse.refresh_expires_in || 0) * 1000
  };
}

function createTikTokConfigPayload(request) {
  return {
    configured: isTikTokConfigured(),
    redirectUri: getTikTokRedirectUri(request),
    scopes: TIKTOK_SCOPES,
    publicAppUrl: PUBLIC_APP_URL || ""
  };
}

async function fetchTikTokJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    const message =
      data.error_description ||
      data.error?.message ||
      data.message ||
      `TikTok request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
}

async function exchangeToken(formData) {
  const body = new URLSearchParams(formData);

  return fetchTikTokJson("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
}

async function revokeTikTokAccess(accessToken) {
  if (!accessToken || !isTikTokConfigured()) {
    return;
  }

  const body = new URLSearchParams({
    client_key: TIKTOK_CLIENT_KEY,
    client_secret: TIKTOK_CLIENT_SECRET,
    token: accessToken
  });

  await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  }).catch(() => undefined);
}

async function ensureFreshSession() {
  const existingSession = await readSession();

  if (!existingSession) {
    return null;
  }

  if (!tokenExpiresSoon(existingSession)) {
    return existingSession;
  }

  if (!existingSession.refresh_token || !isTikTokConfigured()) {
    return existingSession;
  }

  const refreshed = await exchangeToken({
    client_key: TIKTOK_CLIENT_KEY,
    client_secret: TIKTOK_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: existingSession.refresh_token
  });

  const nextSession = buildStoredSession(refreshed);
  await writeSession(nextSession);
  return nextSession;
}

async function fetchTikTokProfile(accessToken) {
  const profileUrl = new URL("https://open.tiktokapis.com/v2/user/info/");
  profileUrl.searchParams.set("fields", "open_id,avatar_url,display_name");

  const payload = await fetchTikTokJson(profileUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return payload.data?.user || null;
}

async function fetchTikTokVideos(accessToken) {
  const videoUrl = new URL("https://open.tiktokapis.com/v2/video/list/");
  videoUrl.searchParams.set(
    "fields",
    "id,title,video_description,duration,cover_image_url,share_url,embed_link"
  );

  const payload = await fetchTikTokJson(videoUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      max_count: 6
    })
  });

  const videos = payload.data?.videos || payload.data?.video_list || [];

  return videos.map((video) => ({
    id: video.id,
    title: video.title || video.video_description || "TikTok Video",
    description: video.video_description || "",
    duration: video.duration || 0,
    coverImageUrl: video.cover_image_url || "",
    shareUrl: video.share_url || "",
    embedLink: video.embed_link || ""
  }));
}

async function buildTikTokStatus(request) {
  if (!isTikTokConfigured()) {
    return {
      ...createTikTokConfigPayload(request),
      connected: false,
      needsSetup: true
    };
  }

  const session = await readSession();

  if (!session) {
    return {
      ...createTikTokConfigPayload(request),
      connected: false,
      needsSetup: false
    };
  }

  try {
    const freshSession = await ensureFreshSession();
    const [profile, videos] = await Promise.all([
      fetchTikTokProfile(freshSession.access_token),
      fetchTikTokVideos(freshSession.access_token)
    ]);

    return {
      ...createTikTokConfigPayload(request),
      connected: true,
      needsSetup: false,
      connectedAt: freshSession.created_at,
      grantedScopes: freshSession.granted_scopes,
      profile,
      videos
    };
  } catch (error) {
    await clearSession();
    return {
      ...createTikTokConfigPayload(request),
      connected: false,
      needsSetup: false,
      error: error.message
    };
  }
}

function cleanupPendingStates() {
  const expirationMs = 10 * 60 * 1000;

  for (const [state, entry] of pendingStates.entries()) {
    if (Date.now() - entry.createdAt > expirationMs) {
      pendingStates.delete(state);
    }
  }
}

function buildAuthUrl(request) {
  cleanupPendingStates();

  const state = crypto.randomUUID();
  const redirectUri = getTikTokRedirectUri(request);
  const usePkce = shouldUsePkce(redirectUri);
  const codeVerifier = usePkce ? createCodeVerifier() : "";
  const codeChallenge = usePkce ? createCodeChallenge(codeVerifier) : "";

  pendingStates.set(state, {
    codeVerifier,
    redirectUri,
    createdAt: Date.now()
  });

  const authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authUrl.searchParams.set("client_key", TIKTOK_CLIENT_KEY);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", TIKTOK_SCOPES);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  if (usePkce) {
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
  }

  return authUrl.toString();
}

async function handleTikTokCallback(requestUrl, response) {
  const error = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");

  if (error) {
    const details = encodeURIComponent(errorDescription || error);
    redirect(response, `/?tiktok=error&message=${details}`);
    return;
  }

  const state = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");
  const pending = state ? pendingStates.get(state) : null;

  if (!pending || !code) {
    redirect(response, "/?tiktok=error&message=ungueltiger-login-status");
    return;
  }

  pendingStates.delete(state);

  try {
    const tokenRequest = {
      client_key: TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: pending.redirectUri
    };

    if (pending.codeVerifier) {
      tokenRequest.code_verifier = pending.codeVerifier;
    }

    const tokenResponse = await exchangeToken(tokenRequest);
    await writeSession(buildStoredSession(tokenResponse));
    redirect(response, "/?tiktok=connected");
  } catch (errorObject) {
    const details = encodeURIComponent(errorObject.message || "oauth-fehler");
    redirect(response, `/?tiktok=error&message=${details}`);
  }
}

async function handleDisconnect(response) {
  const session = await readSession();

  if (session?.access_token) {
    await revokeTikTokAccess(session.access_token);
  }

  await clearSession();
  sendJson(response, 200, {
    ok: true
  });
}

async function serveStaticFile(response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const targetPath = path.join(ROOT_DIR, relativePath);
  const normalizedPath = path.normalize(targetPath);

  if (!normalizedPath.startsWith(ROOT_DIR)) {
    sendJson(response, 403, { error: "forbidden" });
    return;
  }

  try {
    const stat = await fsp.stat(normalizedPath);
    if (!stat.isFile()) {
      sendJson(response, 404, { error: "not_found" });
      return;
    }

    const extension = path.extname(normalizedPath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": STATIC_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });

    fs.createReadStream(normalizedPath).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { error: "not_found" });
      return;
    }

    sendJson(response, 500, { error: "read_failed" });
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, buildBaseUrl(request));
  const pathname = requestUrl.pathname;

  try {
    if (request.method === "GET" && pathname === "/api/tiktok/status") {
      const status = await buildTikTokStatus(request);
      sendJson(response, 200, status);
      return;
    }

    if (request.method === "GET" && pathname === "/api/tiktok/config") {
      sendJson(response, 200, createTikTokConfigPayload(request));
      return;
    }

    if (request.method === "GET" && pathname === "/auth/tiktok/start") {
      if (!isTikTokConfigured()) {
        redirect(response, "/?tiktok=missing-config");
        return;
      }

      redirect(response, buildAuthUrl(request));
      return;
    }

    if (
      request.method === "GET" &&
      (pathname === "/auth/tiktok/callback" || pathname === "/auth/tiktok/callback/")
    ) {
      await handleTikTokCallback(requestUrl, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/tiktok/disconnect") {
      await handleDisconnect(response);
      return;
    }

    if (request.method === "GET") {
      await serveStaticFile(response, pathname);
      return;
    }

    sendJson(response, 405, { error: "method_not_allowed" });
  } catch (error) {
    sendJson(response, 500, {
      error: "server_error",
      message: error.message
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Streamer Helper laeuft auf http://${HOST}:${PORT}`);
  console.log(
    `Oeffentliche App-URL: ${PUBLIC_APP_URL || "wird aus Render-Proxy oder Request-Host abgeleitet"}`
  );
  console.log(
    `TikTok Redirect URI: ${TIKTOK_REDIRECT_URI || "wird aus der oeffentlichen App-URL gebaut"}`
  );
});
