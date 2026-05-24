const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  ensureSchedulingSchema,
  syncSchedulingDomainToDb
} = require("../scheduling_storage");

const ROOT = path.resolve(__dirname, "..");
const STORE_PATH = path.join(ROOT, "data", "store.json");
const SCHEDULING_SCHEMA_PATH = path.join(ROOT, "db", "scheduling.sql");
const PORTAL_STORE_KEY = "primary";

function parseSourceArg() {
  const explicit = process.argv.find((entry) => entry.startsWith("--source="));
  if (explicit) return explicit.split("=")[1];

  return String(process.env.BACKFILL_SOURCE || "auto").trim().toLowerCase();
}

function readFileStore() {
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf8") || "{}");
}

async function readPortalStore(client) {
  const result = await client.query(
    "SELECT data FROM portal_state_store WHERE store_key = $1",
    [PORTAL_STORE_KEY]
  );

  return result.rows[0]?.data || null;
}

async function resolveSourceStore(client, source) {
  if (source === "file") {
    return readFileStore();
  }

  if (source === "portal") {
    const portalStore = await readPortalStore(client);
    if (!portalStore) {
      throw new Error("Kein portal_state_store-Eintrag mit store_key=primary gefunden.");
    }
    return portalStore;
  }

  const portalStore = await readPortalStore(client);
  if (portalStore) return portalStore;
  return readFileStore();
}

async function main() {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL fehlt. Bitte zuerst die PostgreSQL-Umgebung setzen.");
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined
  });

  const source = parseSourceArg();

  await client.connect();

  try {
    await ensureSchedulingSchema(client, SCHEDULING_SCHEMA_PATH);
    const store = await resolveSourceStore(client, source);
    await syncSchedulingDomainToDb(client, store);
    console.log(`Scheduling-Backfill erfolgreich aus Quelle "${source}" abgeschlossen.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
