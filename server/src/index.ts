import { resolve } from "node:path";
import { config } from "./config.js";
import { openDb } from "./db/index.js";
import { createApp } from "./http/app.js";
import "./routes/index.js";
import { anthropicLlm } from "./ai/claude.js";
import { systemClock } from "./util/time.js";

const db = openDb(resolve(config.dataDir, "veyra.db"));
const llm = config.anthropicKey ? anthropicLlm(config.anthropicKey, config.anthropicModel) : undefined;

const { server } = createApp({
  db,
  clock: systemClock,
  llm,
  isProd: config.httpsMode,
  allowedOrigins: config.allowedOrigins,
  trustProxy: config.trustProxy,
  sessionDays: config.sessionDays,
  webDist: config.webDist,
});

server.listen(config.port, () => {
  console.log(`\n  VEYRA rodando em http://localhost:${config.port}`);
  console.log(`  IA: ${llm ? `Claude (${config.anthropicModel})` : "interpretador local (defina ANTHROPIC_API_KEY para a IA em nuvem)"}`);
  console.log(`  Banco: ${resolve(config.dataDir, "veyra.db")}\n`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
