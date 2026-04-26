async function sendDiscordMessage(content) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!token || !channelId) {
    console.warn("[Discord] DISCORD_BOT_TOKEN oder DISCORD_CHANNEL_ID fehlt.");
    return;
  }

  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Discord] Nachricht konnte nicht gesendet werden:", response.status, errorText);
    }
  } catch (error) {
    console.error("[Discord] Fehler beim Senden:", error);
  }
}

async function sendShiftNotification(type, shift) {
  let title = "📅 Schichtplan aktualisiert";

  if (type === "created") title = "✅ Neue Schicht eingetragen";
  if (type === "updated") title = "✏️ Schicht geändert";
  if (type === "deleted") title = "🗑️ Schicht gelöscht";

  const content = [
    title,
    "",
  `👤 **Person:** ${shift.userName || shift.name || shift.memberId || "Unbekannt"}`, 
`🎭 **Rolle/Bereich:** ${shift.role || shift.area || shift.title || shift.shiftType || "Nicht angegeben"}`,
    `📅 **Datum:** ${shift.date || shift.day || "Nicht angegeben"}`,
    `🕒 **Zeit:** ${shift.startTime || shift.start_time || "?"} – ${shift.endTime || shift.end_time || "?"}`,
    `📝 **Aufgabe:** ${shift.task || shift.notes || "Keine Angabe"}`
  ].join("\n");

  await sendDiscordMessage(content);
}

module.exports = {
  sendDiscordMessage,
  sendShiftNotification
};
