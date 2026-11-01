// Confere, com a internet REAL, as fontes de mercado e (se houver chave) a IA em nuvem.
// Uso: npm run check:live -w server        (no seu computador; este ambiente de desenvolvimento não tem acesso a essas APIs)
import { createMarketService, describeMarket, type Asset } from "../services/market.js";
import { resolveAi } from "../ai/provider.js";

const clock = { now: () => new Date() };
const market = createMarketService({ clock, brapiToken: process.env.BRAPI_TOKEN, awesomeToken: process.env.AWESOMEAPI_TOKEN });
let bad = 0;
for (const a of ["dolar", "ibovespa"] as Asset[]) {
  try {
    const s = await market.get(a);
    console.log(`✅ ${a}\n${describeMarket(s, "variacao")}\n`);
  } catch (e) {
    bad++;
    console.log(`❌ ${a}: ${e instanceof Error ? e.message : e}\n`);
  }
}
const ai = resolveAi(process.env);
if (!ai) console.log("ℹ️  IA em nuvem: nenhuma chave configurada (GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY ou ANTHROPIC_API_KEY).");
else {
  try {
    const r = await ai.llm({ system: "Responda em uma frase curta, em português.", messages: [{ role: "user", content: "Diga olá." }], tools: [] });
    const t = r.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    console.log(`✅ IA (${ai.name}/${ai.model}): ${t}`);
  } catch (e) {
    bad++;
    console.log(`❌ IA (${ai.name}): ${e instanceof Error ? e.message : e}`);
  }
}
process.exit(bad ? 1 : 0);
