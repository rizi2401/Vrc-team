let PoolCtor = null;
let pool = null;
let schemaEnsured = false;

function getPool() {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) return null;

  if (!PoolCtor) {
    ({ Pool: PoolCtor } = require("pg"));
  }

  if (!pool) {
    pool = new PoolCtor({
      connectionString,
      ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined
    });
  }

  return pool;
}

async function ensureAnalyticsSchema() {
  const db = getPool();
  if (!db || schemaEnsured) return Boolean(db);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vrchat_sync_runs (
      id BIGSERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS vrchat_group_state (
      group_id TEXT PRIMARY KEY,
      lookup TEXT NOT NULL,
      name TEXT,
      short_code TEXT,
      discriminator TEXT,
      member_count INTEGER,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vrchat_instance_snapshots (
      id BIGSERIAL PRIMARY KEY,
      group_id TEXT NOT NULL,
      world_id TEXT,
      world_name TEXT,
      instance_id TEXT NOT NULL,
      instance_type TEXT,
      player_count INTEGER NOT NULL DEFAULT 0,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS vrchat_instance_snapshots_group_idx
      ON vrchat_instance_snapshots(group_id, observed_at DESC);

    CREATE TABLE IF NOT EXISTS vrchat_audit_events (
      event_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      target_id TEXT,
      target_name TEXT,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE INDEX IF NOT EXISTS vrchat_audit_events_group_idx
      ON vrchat_audit_events(group_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS vrchat_session_store (
      session_key TEXT PRIMARY KEY,
      cookies JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  schemaEnsured = true;
  return true;
}

async function startSyncRun() {
  const db = getPool();
  const result = await db.query(
    `INSERT INTO vrchat_sync_runs (status) VALUES ('running') RETURNING id`
  );
  return result.rows[0].id;
}

async function finishSyncRun(id, status, summary = {}, errorMessage = "") {
  const db = getPool();
  await db.query(
    `
      UPDATE vrchat_sync_runs
      SET finished_at = NOW(),
          status = $2,
          summary = $3::jsonb,
          error_message = NULLIF($4, '')
      WHERE id = $1
    `,
    [id, status, JSON.stringify(summary || {}), String(errorMessage || "")]
  );
}

async function upsertGroupState(group) {
  const db = getPool();
  await db.query(
    `
      INSERT INTO vrchat_group_state (
        group_id, lookup, name, short_code, discriminator, member_count, raw, last_synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
      ON CONFLICT (group_id) DO UPDATE
      SET lookup = EXCLUDED.lookup,
          name = EXCLUDED.name,
          short_code = EXCLUDED.short_code,
          discriminator = EXCLUDED.discriminator,
          member_count = EXCLUDED.member_count,
          raw = EXCLUDED.raw,
          last_synced_at = NOW()
    `,
    [
      group.groupId,
      group.lookup,
      group.name,
      group.shortCode,
      group.discriminator,
      group.memberCount,
      JSON.stringify(group.raw || {})
    ]
  );
}

async function insertInstanceSnapshots(groupId, instances) {
  const db = getPool();
  if (!instances.length) return;

  const values = [];
  const placeholders = instances.map((entry, index) => {
    const offset = index * 7;
    values.push(
      groupId,
      entry.worldId,
      entry.worldName,
      entry.instanceId,
      entry.instanceType,
      entry.playerCount,
      JSON.stringify(entry.raw || {})
    );
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}::jsonb)`;
  });

  await db.query(
    `
      INSERT INTO vrchat_instance_snapshots (
        group_id, world_id, world_name, instance_id, instance_type, player_count, raw
      ) VALUES ${placeholders.join(", ")}
    `,
    values
  );
}

async function insertAuditEvents(groupId, events) {
  const db = getPool();
  for (const event of events) {
    await db.query(
      `
        INSERT INTO vrchat_audit_events (
          event_id, group_id, event_type, actor_id, actor_name, target_id, target_name, description, created_at, raw
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        ON CONFLICT (event_id) DO UPDATE
        SET event_type = EXCLUDED.event_type,
            actor_id = EXCLUDED.actor_id,
            actor_name = EXCLUDED.actor_name,
            target_id = EXCLUDED.target_id,
            target_name = EXCLUDED.target_name,
            description = EXCLUDED.description,
            created_at = EXCLUDED.created_at,
            raw = EXCLUDED.raw
      `,
      [
        event.id,
        groupId,
        event.eventType,
        event.actorId,
        event.actorName,
        event.targetId,
        event.targetName,
        event.description,
        event.createdAt,
        JSON.stringify(event.raw || {})
      ]
    );
  }
}

async function loadVrchatSession(sessionKey = "default") {
  const db = getPool();
  if (!db) return null;

  const result = await db.query(
    `
      SELECT cookies, updated_at
      FROM vrchat_session_store
      WHERE session_key = $1
    `,
    [sessionKey]
  );

  if (!result.rows[0]) return null;

  return {
    cookies: result.rows[0].cookies || {},
    updatedAt: result.rows[0].updated_at
  };
}

async function saveVrchatSession(sessionKey = "default", cookies = {}) {
  const db = getPool();
  if (!db) return;

  await db.query(
    `
      INSERT INTO vrchat_session_store (session_key, cookies, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (session_key) DO UPDATE
      SET cookies = EXCLUDED.cookies,
          updated_at = NOW()
    `,
    [sessionKey, JSON.stringify(cookies || {})]
  );
}

async function getAnalyticsOverview(config = {}) {
  const db = getPool();
  if (!db) {
    return {
      configured: false,
      databaseConnected: false,
      missing: [...new Set(["DATABASE_URL", ...(config.missing || [])])],
      latestInstances: [],
      latestAuditEvents: [],
      topWorlds: []
    };
  }

  await ensureAnalyticsSchema();

  const [lastSyncResult, groupResult, instanceResult, auditResult, worldsResult, sessionResult] = await Promise.all([
    db.query(`SELECT * FROM vrchat_sync_runs ORDER BY started_at DESC LIMIT 1`),
    db.query(`SELECT * FROM vrchat_group_state ORDER BY last_synced_at DESC LIMIT 1`),
    db.query(`
      SELECT DISTINCT ON (instance_id)
        world_id, world_name, instance_id, instance_type, player_count, observed_at
      FROM vrchat_instance_snapshots
      ORDER BY instance_id, observed_at DESC
      LIMIT 10
    `),
    db.query(`
      SELECT event_id, event_type, actor_name, target_name, description, created_at
      FROM vrchat_audit_events
      ORDER BY created_at DESC
      LIMIT 12
    `),
    db.query(`
      SELECT COALESCE(world_name, world_id, 'Unbekannte Welt') AS world_name,
             MAX(player_count) AS peak_players,
             COUNT(*) AS samples
      FROM vrchat_instance_snapshots
      WHERE observed_at >= NOW() - INTERVAL '7 days'
      GROUP BY 1
      ORDER BY peak_players DESC, samples DESC
      LIMIT 5
    `),
    db.query(
      `
        SELECT updated_at
        FROM vrchat_session_store
        WHERE session_key = $1
      `,
      [config.sessionKey || "default"]
    )
  ]);

  return {
    configured: !(config.missing || []).length,
    databaseConnected: true,
    missing: config.missing || [],
    groupLookup: config.groupLookup || "",
    group: groupResult.rows[0]
      ? {
          id: groupResult.rows[0].group_id,
          name: groupResult.rows[0].name,
          shortCode: groupResult.rows[0].short_code,
          discriminator: groupResult.rows[0].discriminator,
          memberCount: groupResult.rows[0].member_count,
          lastSyncedAt: groupResult.rows[0].last_synced_at
        }
      : null,
    lastSync: lastSyncResult.rows[0]
      ? {
          status: lastSyncResult.rows[0].status,
          startedAt: lastSyncResult.rows[0].started_at,
          finishedAt: lastSyncResult.rows[0].finished_at,
          summary: lastSyncResult.rows[0].summary || {},
          errorMessage: lastSyncResult.rows[0].error_message || ""
        }
      : null,
    latestInstances: instanceResult.rows.map((row) => ({
      worldId: row.world_id,
      worldName: row.world_name,
      instanceId: row.instance_id,
      instanceType: row.instance_type,
      playerCount: row.player_count,
      observedAt: row.observed_at
    })),
    latestAuditEvents: auditResult.rows.map((row) => ({
      id: row.event_id,
      eventType: row.event_type,
      actorName: row.actor_name,
      targetName: row.target_name,
      description: row.description,
      createdAt: row.created_at
    })),
    topWorlds: worldsResult.rows.map((row) => ({
      worldName: row.world_name,
      peakPlayers: Number(row.peak_players || 0),
      samples: Number(row.samples || 0)
    })),
    sessionSavedAt: sessionResult.rows[0]?.updated_at || null
  };
}

module.exports = {
  ensureAnalyticsSchema,
  startSyncRun,
  finishSyncRun,
  upsertGroupState,
  insertInstanceSnapshots,
  insertAuditEvents,
  loadVrchatSession,
  saveVrchatSession,
  getAnalyticsOverview
};
