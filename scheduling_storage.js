const fs = require("node:fs");
const { sendShiftNotification } = require("./discord_notify");

const DAY_IDS = ["mo", "di", "mi", "do", "fr", "sa", "so"];

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseNumeric(value) {
  const numeric = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeText(value) {
  return String(value || "");
}

function normalizeIsoValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeJsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function readSchedulingSchema(schemaPath) {
  return fs.readFileSync(schemaPath, "utf8");
}

async function ensureSchedulingSchema(db, schemaPath) {
  const schemaSql = readSchedulingSchema(schemaPath);
  await db.query(schemaSql);
}

async function schedulingTablesHaveData(db) {
  const result = await db.query(`
    SELECT
      EXISTS (SELECT 1 FROM users LIMIT 1) AS has_users,
      EXISTS (SELECT 1 FROM shifts LIMIT 1) AS has_shifts,
      EXISTS (SELECT 1 FROM time_entries LIMIT 1) AS has_time_entries
  `);

  const row = result.rows[0] || {};
  return Boolean(row.has_users || row.has_shifts || row.has_time_entries);
}

function mapUserToRow(user, index) {
  return {
    id: normalizeText(user.id),
    sortIndex: index,
    username: normalizeText(user.username),
    displayName: normalizeText(user.displayName),
    role: normalizeText(user.role),
    vrchatName: normalizeText(user.vrchatName),
    discordName: normalizeText(user.discordName),
    avatarUrl: normalizeText(user.avatarUrl),
    bio: normalizeText(user.bio),
    contactNote: normalizeText(user.contactNote),
    creatorBlurb: normalizeText(user.creatorBlurb),
    creatorLinks: safeArray(user.creatorLinks),
    creatorVisible: Boolean(user.creatorVisible),
    creatorSlug: normalizeText(user.creatorSlug),
    creatorApplicationStatus: normalizeText(user.creatorApplicationStatus),
    creatorFollowerCount: Math.round(parseNumeric(user.creatorFollowerCount)),
    creatorPrimaryPlatform: normalizeText(user.creatorPrimaryPlatform),
    creatorProofUrl: normalizeText(user.creatorProofUrl),
    creatorApplicationNote: normalizeText(user.creatorApplicationNote),
    creatorReviewNote: normalizeText(user.creatorReviewNote),
    creatorReviewedAt: normalizeIsoValue(user.creatorReviewedAt),
    creatorReviewedBy: normalizeText(user.creatorReviewedBy),
    creatorCommunityName: normalizeText(user.creatorCommunityName),
    creatorCommunitySummary: normalizeText(user.creatorCommunitySummary),
    creatorCommunityInviteUrl: normalizeText(user.creatorCommunityInviteUrl),
    creatorPresence: normalizeText(user.creatorPresence),
    creatorPresenceText: normalizeText(user.creatorPresenceText),
    creatorPresenceUrl: normalizeText(user.creatorPresenceUrl),
    creatorPresenceUpdatedAt: normalizeIsoValue(user.creatorPresenceUpdatedAt),
    creatorWebhookToken: normalizeText(user.creatorWebhookToken),
    creatorAutomationLastAt: normalizeIsoValue(user.creatorAutomationLastAt),
    creatorAutomationLastSource: normalizeText(user.creatorAutomationLastSource),
    vrchatLinkedAt: normalizeIsoValue(user.vrchatLinkedAt),
    vrchatLinkSource: normalizeText(user.vrchatLinkSource),
    weeklyHoursCapacity: parseNumeric(user.weeklyHoursCapacity),
    weeklyDaysCapacity: Math.round(parseNumeric(user.weeklyDaysCapacity)),
    availabilitySchedule: normalizeText(user.availabilitySchedule),
    availabilityUpdatedAt: normalizeIsoValue(user.availabilityUpdatedAt),
    lastLoginAt: normalizeIsoValue(user.lastLoginAt),
    lastSeenAt: normalizeIsoValue(user.lastSeenAt),
    isBlocked: Boolean(user.isBlocked),
    blockReason: normalizeText(user.blockReason),
    blockedAt: normalizeIsoValue(user.blockedAt),
    blockedBy: normalizeText(user.blockedBy),
    passwordHash: normalizeText(user.passwordHash)
  };
}

function mapShiftToRow(shift, index) {
  return {
    id: normalizeText(shift.id),
    sortIndex: index,
    date: normalizeText(shift.date),
    startTime: normalizeText(shift.startTime),
    endTime: normalizeText(shift.endTime),
    shiftType: normalizeText(shift.shiftType),
    world: normalizeText(shift.world),
    task: normalizeText(shift.task),
    memberId: normalizeText(shift.memberId),
    notes: normalizeText(shift.notes),
    isLead: Boolean(shift.isLead)
  };
}

function mapTimeEntryToRow(entry, index) {
  return {
    id: normalizeText(entry.id),
    sortIndex: index,
    userId: normalizeText(entry.userId),
    shiftId: normalizeText(entry.shiftId) || null,
    checkInAt: normalizeIsoValue(entry.checkInAt),
    checkOutAt: normalizeIsoValue(entry.checkOutAt),
    shiftSnapshot: entry.shiftSnapshot ?? null
  };
}

async function syncSchedulingDomainToDb(db, store) {
  const users = safeArray(store?.users);
  const shifts = safeArray(store?.shifts);
  const timeEntries = safeArray(store?.timeEntries);

  await db.query("BEGIN");

  try {
    await db.query("DELETE FROM time_entries");
    await db.query("DELETE FROM shifts");
    await db.query("DELETE FROM availability_slots");
    await db.query("DELETE FROM overtime_adjustments");
    await db.query("DELETE FROM users");

    for (const [index, user] of users.entries()) {
      const row = mapUserToRow(user, index);
      await db.query(
        `
          INSERT INTO users (
            id, sort_index, username, display_name, role, vrchat_name, discord_name, avatar_url, bio, contact_note,
            creator_blurb, creator_links, creator_visible, creator_slug, creator_application_status, creator_follower_count,
            creator_primary_platform, creator_proof_url, creator_application_note, creator_review_note, creator_reviewed_at,
            creator_reviewed_by, creator_community_name, creator_community_summary, creator_community_invite_url,
            creator_presence, creator_presence_text, creator_presence_url, creator_presence_updated_at, creator_webhook_token,
            creator_automation_last_at, creator_automation_last_source, vrchat_linked_at, vrchat_link_source,
            weekly_hours_capacity, weekly_days_capacity, availability_schedule, availability_updated_at,
            last_login_at, last_seen_at, is_blocked, block_reason, blocked_at, blocked_by, password_hash
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12::jsonb, $13, $14, $15, $16,
            $17, $18, $19, $20, $21,
            $22, $23, $24, $25,
            $26, $27, $28, $29, $30,
            $31, $32, $33, $34,
            $35, $36, $37, $38,
            $39, $40, $41, $42, $43, $44, $45
          )
        `,
        [
          row.id,
          row.sortIndex,
          row.username,
          row.displayName,
          row.role,
          row.vrchatName,
          row.discordName,
          row.avatarUrl,
          row.bio,
          row.contactNote,
          row.creatorBlurb,
          JSON.stringify(row.creatorLinks),
          row.creatorVisible,
          row.creatorSlug,
          row.creatorApplicationStatus,
          row.creatorFollowerCount,
          row.creatorPrimaryPlatform,
          row.creatorProofUrl,
          row.creatorApplicationNote,
          row.creatorReviewNote,
          row.creatorReviewedAt,
          row.creatorReviewedBy,
          row.creatorCommunityName,
          row.creatorCommunitySummary,
          row.creatorCommunityInviteUrl,
          row.creatorPresence,
          row.creatorPresenceText,
          row.creatorPresenceUrl,
          row.creatorPresenceUpdatedAt,
          row.creatorWebhookToken,
          row.creatorAutomationLastAt,
          row.creatorAutomationLastSource,
          row.vrchatLinkedAt,
          row.vrchatLinkSource,
          row.weeklyHoursCapacity,
          row.weeklyDaysCapacity,
          row.availabilitySchedule,
          row.availabilityUpdatedAt,
          row.lastLoginAt,
          row.lastSeenAt,
          row.isBlocked,
          row.blockReason,
          row.blockedAt,
          row.blockedBy,
          row.passwordHash
        ]
      );

      for (const [slotIndex, slot] of safeArray(user.availabilitySlots).entries()) {
        await db.query(
          `
            INSERT INTO availability_slots (
              user_id, day_id, enabled, start_time, end_time, note, sort_index
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            row.id,
            normalizeText(slot.day),
            Boolean(slot.enabled),
            normalizeText(slot.startTime),
            normalizeText(slot.endTime),
            normalizeText(slot.note),
            slotIndex
          ]
        );
      }

      for (const [adjustmentIndex, adjustment] of safeArray(user.overtimeAdjustments).entries()) {
        await db.query(
          `
            INSERT INTO overtime_adjustments (
              id, user_id, hours, note, created_at, created_by, sort_index
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            normalizeText(adjustment.id),
            row.id,
            parseNumeric(adjustment.hours),
            normalizeText(adjustment.note),
            normalizeIsoValue(adjustment.createdAt) || new Date().toISOString(),
            normalizeText(adjustment.createdBy),
            adjustmentIndex
          ]
        );
      }
    }

    for (const [index, shift] of shifts.entries()) {
      const row = mapShiftToRow(shift, index);
      await db.query(
        `
          INSERT INTO shifts (
            id, sort_index, date_key, start_time, end_time, shift_type, world, task, member_id, notes, is_lead
          )
          VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          row.id,
          row.sortIndex,
          row.date,
          row.startTime,
          row.endTime,
          row.shiftType,
          row.world,
          row.task,
          row.memberId,
          row.notes,
          row.isLead
        ]
      );
    }

    for (const [index, entry] of timeEntries.entries()) {
      const row = mapTimeEntryToRow(entry, index);
      await db.query(
        `
          INSERT INTO time_entries (
            id, sort_index, user_id, shift_id, check_in_at, check_out_at, shift_snapshot
          )
          VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::jsonb)
        `,
        [
          row.id,
          row.sortIndex,
          row.userId,
          row.shiftId,
          row.checkInAt,
          row.checkOutAt,
          JSON.stringify(row.shiftSnapshot)
        ]
      );
    }

    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

async function loadSchedulingDomainFromDb(db, store) {
  const userResult = await db.query("SELECT * FROM users ORDER BY sort_index ASC, username ASC");
  if (!userResult.rows.length) return null;

  const availabilityResult = await db.query(
    "SELECT * FROM availability_slots ORDER BY user_id ASC, sort_index ASC, day_id ASC"
  );
  const overtimeResult = await db.query(
    "SELECT * FROM overtime_adjustments ORDER BY user_id ASC, sort_index ASC, created_at DESC"
  );
  const shiftResult = await db.query("SELECT * FROM shifts ORDER BY sort_index ASC, date_key DESC, start_time DESC");
  const timeEntryResult = await db.query(
    "SELECT * FROM time_entries ORDER BY sort_index ASC, check_in_at DESC, id ASC"
  );

  const availabilityByUser = new Map();

  for (const row of availabilityResult.rows) {
    const bucket = availabilityByUser.get(row.user_id) || [];
    bucket.push({
      day: normalizeText(row.day_id),
      enabled: Boolean(row.enabled),
      startTime: normalizeText(row.start_time),
      endTime: normalizeText(row.end_time),
      note: normalizeText(row.note)
    });
    availabilityByUser.set(row.user_id, bucket);
  }

  const overtimeByUser = new Map();
  for (const row of overtimeResult.rows) {
    const bucket = overtimeByUser.get(row.user_id) || [];
    bucket.push({
      id: normalizeText(row.id),
      hours: parseNumeric(row.hours),
      note: normalizeText(row.note),
      createdAt: normalizeIsoValue(row.created_at) || new Date().toISOString(),
      createdBy: normalizeText(row.created_by)
    });
    overtimeByUser.set(row.user_id, bucket);
  }

  const users = userResult.rows.map((row) => ({
    id: normalizeText(row.id),
    username: normalizeText(row.username),
    displayName: normalizeText(row.display_name),
    role: normalizeText(row.role),
    vrchatName: normalizeText(row.vrchat_name),
    discordName: normalizeText(row.discord_name),
    avatarUrl: normalizeText(row.avatar_url),
    bio: normalizeText(row.bio),
    contactNote: normalizeText(row.contact_note),
    creatorBlurb: normalizeText(row.creator_blurb),
    creatorLinks: safeArray(normalizeJsonValue(row.creator_links, [])),
    creatorVisible: Boolean(row.creator_visible),
    creatorSlug: normalizeText(row.creator_slug),
    creatorApplicationStatus: normalizeText(row.creator_application_status),
    creatorFollowerCount: Math.round(parseNumeric(row.creator_follower_count)),
    creatorPrimaryPlatform: normalizeText(row.creator_primary_platform),
    creatorProofUrl: normalizeText(row.creator_proof_url),
    creatorApplicationNote: normalizeText(row.creator_application_note),
    creatorReviewNote: normalizeText(row.creator_review_note),
    creatorReviewedAt: normalizeIsoValue(row.creator_reviewed_at) || "",
    creatorReviewedBy: normalizeText(row.creator_reviewed_by),
    creatorCommunityName: normalizeText(row.creator_community_name),
    creatorCommunitySummary: normalizeText(row.creator_community_summary),
    creatorCommunityInviteUrl: normalizeText(row.creator_community_invite_url),
    creatorPresence: normalizeText(row.creator_presence),
    creatorPresenceText: normalizeText(row.creator_presence_text),
    creatorPresenceUrl: normalizeText(row.creator_presence_url),
    creatorPresenceUpdatedAt: normalizeIsoValue(row.creator_presence_updated_at) || "",
    creatorWebhookToken: normalizeText(row.creator_webhook_token),
    creatorAutomationLastAt: normalizeIsoValue(row.creator_automation_last_at) || "",
    creatorAutomationLastSource: normalizeText(row.creator_automation_last_source),
    vrchatLinkedAt: normalizeIsoValue(row.vrchat_linked_at) || "",
    vrchatLinkSource: normalizeText(row.vrchat_link_source),
    weeklyHoursCapacity: parseNumeric(row.weekly_hours_capacity),
    weeklyDaysCapacity: Math.round(parseNumeric(row.weekly_days_capacity)),
    overtimeAdjustments: overtimeByUser.get(row.id) || [],
    availabilitySchedule: normalizeText(row.availability_schedule),
    availabilitySlots: (availabilityByUser.get(row.id) || []).sort(
      (left, right) => DAY_IDS.indexOf(left.day) - DAY_IDS.indexOf(right.day)
    ),
    availabilityUpdatedAt: normalizeIsoValue(row.availability_updated_at) || "",
    lastLoginAt: normalizeIsoValue(row.last_login_at) || "",
    lastSeenAt: normalizeIsoValue(row.last_seen_at) || "",
    isBlocked: Boolean(row.is_blocked),
    blockReason: normalizeText(row.block_reason),
    blockedAt: normalizeIsoValue(row.blocked_at) || "",
    blockedBy: normalizeText(row.blocked_by),
    passwordHash: normalizeText(row.password_hash)
  }));

  const shifts = shiftResult.rows.map((row) => ({
    id: normalizeText(row.id),
    date: normalizeText(row.date_key),
    startTime: normalizeText(row.start_time),
    endTime: normalizeText(row.end_time),
    shiftType: normalizeText(row.shift_type),
    world: normalizeText(row.world),
    task: normalizeText(row.task),
    memberId: normalizeText(row.member_id),
    notes: normalizeText(row.notes),
    isLead: Boolean(row.is_lead)
  }));

  const timeEntries = timeEntryResult.rows.map((row) => ({
    id: normalizeText(row.id),
    userId: normalizeText(row.user_id),
    shiftId: normalizeText(row.shift_id),
    checkInAt: normalizeIsoValue(row.check_in_at) || "",
    checkOutAt: normalizeIsoValue(row.check_out_at) || "",
    shiftSnapshot: normalizeJsonValue(row.shift_snapshot, null)
  }));

  return {
    ...store,
    users,
    shifts,
    timeEntries
  };
}

module.exports = {
  ensureSchedulingSchema,
  schedulingTablesHaveData,
  syncSchedulingDomainToDb,
  loadSchedulingDomainFromDb
};
