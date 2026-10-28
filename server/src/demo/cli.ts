// Uso: npm run seed -- email@exemplo.com          (carrega dados de demonstração)
//      npm run seed -- email@exemplo.com --remove  (remove só os dados de demonstração)
import { resolve } from "node:path";
import { config } from "../config.js";
import { openDb, get } from "../db/index.js";
import { makeCtx } from "../services/context.js";
import { systemClock } from "../util/time.js";
import { loadDemo, removeDemo } from "./seed.js";

const [email, flag] = process.argv.slice(2);
if (!email) {
  console.error("Informe o e-mail de uma conta existente: npm run seed -- voce@email.com [--remove]");
  process.exit(1);
}
const db = openDb(resolve(config.dataDir, "veyra.db"));
const u = get<{ id: string }>(db, "SELECT id FROM users WHERE email = ?", email.toLowerCase());
if (!u) {
  console.error("Conta não encontrada. Cadastre-se primeiro no app.");
  process.exit(1);
}
const ctx = makeCtx(db, u.id, systemClock);
if (flag === "--remove") {
  removeDemo(ctx);
  console.log("Dados de demonstração removidos.");
} else {
  loadDemo(ctx);
  console.log("Dados de demonstração carregados (marcados como 'demo').");
}
