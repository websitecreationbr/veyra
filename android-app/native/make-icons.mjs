// Gera os ícones do app a partir do logotipo da Veyra (rodar só quando o logotipo mudar; os PNGs já estão no repositório).
// Uso: node native/make-icons.mjs   (precisa de Playwright + Chromium)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BRAND = "#0f766e";
const chevron = (t) => `<path d="M19 20l13 26 13-26" transform="${t}" fill="none" stroke="#fff" stroke-width="${6}" stroke-linecap="round" stroke-linejoin="round"/>`;
const svgs = {
  // quadrado com cantos arredondados (ícone legado) — o chevron ocupa ~45% da largura
  legacy: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${BRAND}"/>${chevron("translate(32 33) scale(1.15) translate(-32 -33)")}</svg>`,
  round: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${BRAND}"/>${chevron("translate(32 33) scale(1.05) translate(-32 -33)")}</svg>`,
  // primeiro plano do ícone adaptativo (fundo é a cor): 108dp com zona segura de 66%
  fg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><g transform="translate(54 54) scale(1.2) translate(-32 -33)">${chevron("")}</g></svg>`,
  logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#fff"/><path d="M19 20l13 26 13-26" fill="none" stroke="${BRAND}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const browser = await chromium.launch();
const page = await browser.newPage();
async function png(svg, size, file, transparent = true) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, await page.screenshot({ omitBackground: transparent, type: "png" }));
}
for (const [d, k] of Object.entries(dens)) {
  const dir = join(here, "res", `mipmap-${d}`);
  await png(svgs.legacy, Math.round(48 * k), join(dir, "ic_launcher.png"));
  await png(svgs.round, Math.round(48 * k), join(dir, "ic_launcher_round.png"));
  await png(svgs.fg, Math.round(108 * k), join(dir, "ic_launcher_foreground.png"));
}
await png(svgs.logo, 512, join(here, "res", "drawable", "splash_logo.png"));
await png(svgs.legacy, 512, join(here, "store-icon-512.png"));
await browser.close();
console.log("ícones gerados");
