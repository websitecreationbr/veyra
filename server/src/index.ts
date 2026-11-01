import { resolve } from "node:path";
import { config } from "./config.js";
import { openDb } from "./db/index.js";
import { createApp } from "./http/app.js";
import "./routes/index.js";
import { DEFAULT_APP_ORIGINS } from "./http/app.js";
import { createMarketService } from "./services/market.js";
import { systemClock } from "./util/time.js";

const sqliteFile = resolve(config.dataDir, "veyra.db");
const db = await openDb({ databaseUrl: config.databaseUrl, ssl: config.databaseSsl, poolMax: config.pgPoolMax, sqliteFile });
const llm = config.ai?.llm;
const market = createMarketService({ clock: systemClock, brapiToken: config.brapiToken, awesomeToken: config.awesomeToken });

const { server } = createApp({
  db,
  clock: systemClock,
  llm,
  market,
  appOrigins: [...DEFAULT_APP_ORIGINS, ...config.appOrigins],
  isProd: config.httpsMode,
  allowedOrigins: config.allowedOrigins,
  trustProxy: config.trustProxy,
  sessionDays: config.sessionDays,
  webDist: config.webDist,
});

server.listen(config.port, () => {
  console.log(`\n  VEYRA rodando em http://localhost:${config.port}`);
  console.log(`  IA: ${config.ai ? `${config.ai.name} (${config.ai.model})` : "interpretador local (defina GEMINI_API_KEY para a IA em nuvem gratuita)"}`);
  console.log(`  Banco: ${db.dialect === "postgres" ? "PostgreSQL (DATABASE_URL)" : sqliteFile}\n`);
});

const shutdown = () => {
  server.close(() => {
    void db.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
