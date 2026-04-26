async function discordApiRequest(path, options = {}) {
  const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!token) {
    return { ok: false, skipped: true, reason: "missing_token" };
  }

  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method: options.method || "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let json = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    json
  };
}

function normalizeDiscordPayload(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const normalized = { ...payload };
    if (typeof normalized.content === "string") {
      normalized.content = normalized.content.trim();
    }
    if (!normalized.content && !Array.isArray(normalized.embeds)) {
      return null;
    }
    return normalized;
  }

  const content = String(payload || "").trim();
  if (!content) return null;
  return { content };
}

async function sendDiscordMessage(payload) {
  const channelId = String(process.env.DISCORD_CHANNEL_ID || "").trim();
  if (!channelId) {
    return { ok: false, skipped: true, reason: "missing_channel_id" };
  }

  const body = normalizeDiscordPayload(payload);
  if (!body) {
    return { ok: false, skipped: true, reason: "empty_payload" };
  }

  return discordApiRequest(`/channels/${channelId}/messages`, {
    body
  });
}

async function openDirectMessageChannel(discordUserId) {
  const normalizedUserId = String(discordUserId || "").trim();
  if (!normalizedUserId) {
    return { ok: false, skipped: true, reason: "missing_discord_user_id" };
  }

  return discordApiRequest("/users/@me/channels", {
    body: {
      recipient_id: normalizedUserId
    }
  });
}

async function sendDiscordDirectMessage(discordUserId, payload) {
  const dmChannel = await openDirectMessageChannel(discordUserId);
  if (!dmChannel.ok) {
    return dmChannel;
  }

  const channelId = dmChannel.json?.id;
  if (!channelId) {
    return { ok: false, skipped: true, reason: "missing_dm_channel_id", status: dmChannel.status, text: dmChannel.text };
  }

  const body = normalizeDiscordPayload(payload);
  if (!body) {
    return { ok: false, skipped: true, reason: "empty_payload" };
  }

  return discordApiRequest(`/channels/${channelId}/messages`, {
    body
  });
}

function buildShiftNotificationContent(type, shift) {
  let title = "📅 Schichtplan aktualisiert";

  if (type === "created") title = "✅ Neue Schicht eingetragen";
  if (type === "updated") title = "✏️ Schicht geändert";
  if (type === "deleted") title = "🗑️ Schicht gelöscht";

  return [
    title,
    "",
    `👤 **Person:** ${shift.userName || shift.name || shift.memberId || "Unbekannt"}`,
    `🎭 **Rolle/Bereich:** ${shift.role || shift.area || shift.title || shift.shiftType || "Nicht angegeben"}`,
    `📅 **Datum:** ${shift.date || shift.day || "Nicht angegeben"}`,
    `🕒 **Zeit:** ${shift.startTime || shift.start_time || "?"} – ${shift.endTime || shift.end_time || "?"}`,
    `📝 **Aufgabe:** ${shift.task || shift.notes || "Keine Angabe"}`
  ].join("\n");
}

async function sendShiftNotification(type, shift) {
  return sendDiscordMessage(buildShiftNotificationContent(type, shift));
}

module.exports = {
  sendDiscordMessage,
  sendDiscordDirectMessage,
  sendShiftNotification
};
