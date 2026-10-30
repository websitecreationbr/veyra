// Uso: npm run migrate   — aplica as migrações no banco configurado (DATABASE_URL ou SQLite local).
// (O servidor já migra sozinho ao iniciar; este comando serve para preparar/verificar o banco antes.)
import { resolve } from "node:path";
import { config } from "../config.js";
import { openDb } from "./index.js";

const db = await openDb({ databaseUrl: config.databaseUrl, ssl: config.databaseSsl, poolMax: 1, sqliteFile: resolve(config.dataDir, "veyra.db") });
console.log(`Migrações aplicadas (${db.dialect}).`);
await db.close();
