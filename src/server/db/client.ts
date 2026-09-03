import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_PATH ?? resolve(process.cwd(), "data/tripplanner.db");

/**
 * Next dev reloads modules on every edit; without this global the process would
 * open a new SQLite handle per reload and eventually exhaust file descriptors.
 */
const globalForDb = globalThis as unknown as { __tripDb?: ReturnType<typeof create> };

function create() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export const db = globalForDb.__tripDb ?? create();
if (process.env.NODE_ENV !== "production") globalForDb.__tripDb = db;

export { schema };
