import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema/index.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function createPGliteDb() {
  const pglite = new PGlite();
  return drizzle(pglite, { schema });
}

export function getDb() {
  if (!_db) {
    _db = createPGliteDb();
  }
  return _db;
}

export type Db = ReturnType<typeof getDb>;
