// Carrega a função gerada (api/[...path].js) exatamente como a Vercel faz: require() + (req, res).
const http = require("node:http");
const path = require("node:path");
const fn = require(path.resolve(__dirname, "../../../api/[...path].js"));
if (typeof fn !== "function") { console.error("o módulo não exporta uma função"); process.exit(2); }
const srv = http.createServer((req, res) => { Promise.resolve(fn(req, res)).catch((e) => { console.error("função lançou:", e); res.statusCode = 500; res.end(); }); });
srv.listen(0, "127.0.0.1", () => console.log("PORT " + srv.address().port));
