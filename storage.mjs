import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export function getClientDataFile() {
  return resolve(process.env.CLIENT_DATA_FILE || resolve(root, "data/clients.json"));
}

async function readJsonClients(filePath) {
  try {
    const contents = await readFile(filePath, "utf8");
    const parsed = JSON.parse(contents);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function withDatabase(callback) {
  if (!process.env.DATABASE_URL) return null;

  const pgModule = await import("pg").catch(() => null);
  const PgClient = pgModule?.default ?? pgModule?.Client ?? null;
  if (!PgClient) {
    throw new Error("DATABASE_URL is set, but the pg package is not installed. Run: npm install pg");
  }

  const client = new PgClient({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        phone_digits TEXT UNIQUE,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    return await callback(client);
  } finally {
    await client.end();
  }
}

export async function ensureStorage() {
  const dataFile = getClientDataFile();
  await mkdir(dirname(dataFile), { recursive: true });

  if (!process.env.DATABASE_URL) {
    try {
      await readFile(dataFile, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        await writeFile(dataFile, "[]\n", "utf8");
      } else {
        throw error;
      }
    }
    return;
  }

  await withDatabase(async (database) => {
    const existing = await database.query("SELECT COUNT(*)::int AS total FROM clients");
    if (existing.rows[0].total > 0) return;

    try {
      const clients = await readJsonClients(dataFile);
      if (!clients.length) return;
      for (const client of clients) {
        await database.query(
          "INSERT INTO clients (phone_digits, data) VALUES ($1, $2)",
          [client.phoneDigits || "", client],
        );
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  });
}

export async function readClients() {
  if (process.env.DATABASE_URL) {
    return await withDatabase(async (database) => {
      const result = await database.query("SELECT data FROM clients ORDER BY updated_at ASC");
      return result.rows.map((row) => row.data);
    }) ?? [];
  }

  return await readJsonClients(getClientDataFile());
}

export async function writeClients(clients) {
  if (process.env.DATABASE_URL) {
    await withDatabase(async (database) => {
      await database.query("BEGIN");
      await database.query("DELETE FROM clients");

      if (clients.length) {
        const values = clients.map((client) => [client.phoneDigits || "", client]);
        for (const [phoneDigits, data] of values) {
          await database.query(
            "INSERT INTO clients (phone_digits, data) VALUES ($1, $2)",
            [phoneDigits, data],
          );
        }
      }

      await database.query("COMMIT");
    });
    return;
  }

  const dataFile = getClientDataFile();
  await mkdir(dirname(dataFile), { recursive: true });
  await writeFile(dataFile, `${JSON.stringify(clients, null, 2)}\n`, "utf8");
}
