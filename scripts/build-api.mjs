// Gera a função serverless da Vercel: api/[...path].js  (a API inteira da Veyra num único arquivo).
//   npm run build:api          → gera o arquivo
//   npm run build:api -- --check → só confere se o arquivo versionado está em dia (sai com erro se não estiver)
// O arquivo gerado É versionado no repositório de propósito: a Vercel detecta funções em /api pelos arquivos
// enviados, então ele precisa existir antes do deploy. Rode de novo sempre que mudar algo em server/src.
import { build } from "esbuild";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "api/[...path].js");
const check = process.argv.includes("--check");

const result = await build({
  entryPoints: [resolve(root, "server/src/vercel.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  write: false,
  outfile,
  // "pg" fica de fora do arquivo: a Vercel o instala (dependência) e o inclui na função automaticamente.
  external: ["pg", "pg-native"],
  // import.meta.url não existe em CJS; fornecemos o equivalente.
  define: { "import.meta.url": "__importMetaUrl" },
  banner: { js: '/* GERADO por scripts/build-api.mjs — não edite à mão. */\nconst __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  // A Vercel espera que o módulo exporte a função (req, res).
  footer: { js: "module.exports = module.exports.default;" },
  // import("pg") vira require("pg") (a Vercel rastreia require com certeza e inclui o pacote na função).
  supported: { "dynamic-import": false },
  legalComments: "none",
  logLevel: "warning",
});
const code = result.outputFiles[0].text;

if (check) {
  const current = existsSync(outfile) ? readFileSync(outfile, "utf8") : "";
  if (current !== code) {
    console.error("api/[...path].js está desatualizado. Rode: npm run build:api");
    process.exit(1);
  }
  console.log("api/[...path].js está em dia.");
} else {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outfile, code);
  console.log(`Gerado ${outfile} (${(code.length / 1024).toFixed(0)} KB)`);
}
