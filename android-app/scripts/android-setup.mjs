// Integra o código nativo da Veyra ao projeto Android gerado pelo Capacitor (`npx cap add android`).
// É IDEMPOTENTE: pode rodar de novo depois de cada `cap sync` sem duplicar nada.
// Uso: node scripts/android-setup.mjs [pasta-do-projeto-android]   (padrão: ./android)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const android = resolve(process.argv[2] ?? join(root, "android"));
const main = join(android, "app", "src", "main");
const native = join(root, "native");
const APP_ID = "com.veyra.ai";

if (!existsSync(main)) {
  console.error(`Projeto Android não encontrado em ${android}. Rode antes:  npx cap add android`);
  process.exit(1);
}

const log = (m) => console.log(`✓ ${m}`);

// 1) Plugin nativo + MainActivity que o registra
const javaDir = join(main, "java", ...APP_ID.split("."));
mkdirSync(javaDir, { recursive: true });
cpSync(join(native, "java", "VeyraNativePlugin.java"), join(javaDir, "VeyraNativePlugin.java"));
writeFileSync(join(javaDir, "MainActivity.java"), `package ${APP_ID};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Os plugins próprios precisam ser registrados ANTES do super.onCreate.
        registerPlugin(VeyraNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);
log("Plugin VeyraNative e MainActivity instalados");

// 2) Manifesto: permissões e consultas (apps de voz/TTS/alarme visíveis no Android 11+)
const manifestPath = join(main, "AndroidManifest.xml");
let manifest = readFileSync(manifestPath, "utf8");
const perms = [
  "android.permission.INTERNET",
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_CALENDAR",
  "android.permission.WRITE_CALENDAR",
  "com.android.alarm.permission.SET_ALARM",
];
const add = [];
for (const p of perms) if (!manifest.includes(`android:name="${p}"`)) add.push(`    <uses-permission android:name="${p}" />`);
if (add.length) manifest = manifest.replace(/<\/manifest>/, `${add.join("\n")}\n</manifest>`);
if (!manifest.includes("<queries>")) {
  manifest = manifest.replace(/<\/manifest>/, `    <queries>
        <intent><action android:name="android.speech.RecognitionService" /></intent>
        <intent><action android:name="android.intent.action.TTS_SERVICE" /></intent>
        <intent><action android:name="android.intent.action.SET_ALARM" /></intent>
    </queries>
</manifest>`);
}
// o app não precisa de microfone/calendário para ser instalado (funciona sem eles)
for (const f of ["android.hardware.microphone"]) {
  if (!manifest.includes(f)) manifest = manifest.replace(/<\/manifest>/, `    <uses-feature android:name="${f}" android:required="false" />\n</manifest>`);
}
writeFileSync(manifestPath, manifest);
log("AndroidManifest.xml: permissões e consultas");

// 3) Ícones e abertura (identidade visual própria)
const res = join(main, "res");
for (const d of readdirSync(join(native, "res"))) {
  if (d.startsWith("mipmap-")) {
    cpSync(join(native, "res", d), join(res, d), { recursive: true });
    // ícones antigos em webp do template atrapalham os novos png de mesmo nome
    for (const w of ["ic_launcher.webp", "ic_launcher_round.webp", "ic_launcher_foreground.webp"]) rmSync(join(res, d, w), { force: true });
  }
}
mkdirSync(join(res, "drawable"), { recursive: true });
cpSync(join(native, "res", "drawable", "splash_logo.png"), join(res, "drawable", "splash_logo.png"));
for (const d of readdirSync(res)) if (d.startsWith("drawable")) rmSync(join(res, d, "splash.png"), { force: true });
writeFileSync(join(res, "drawable", "splash.xml"), `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/veyra_brand" />
    <item android:gravity="center" android:width="144dp" android:height="144dp" android:drawable="@drawable/splash_logo" />
</layer-list>
`);
// o template aponta para @drawable/splash; mantemos o nome e trocamos o conteúdo
mkdirSync(join(res, "values"), { recursive: true });
writeFileSync(join(res, "values", "veyra_colors.xml"), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="veyra_brand">#0F766E</color>
</resources>
`);
writeFileSync(join(res, "values", "ic_launcher_background.xml"), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0F766E</color>
</resources>
`);
// ícone adaptativo (Android 8+): fundo = cor da Veyra, primeiro plano = o "V"
mkdirSync(join(res, "mipmap-anydpi-v26"), { recursive: true });
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
writeFileSync(join(res, "mipmap-anydpi-v26", "ic_launcher.xml"), adaptive);
writeFileSync(join(res, "mipmap-anydpi-v26", "ic_launcher_round.xml"), adaptive);
log("Ícones, tela de abertura e cores da Veyra");

// 4) Nome do app
const strings = join(res, "values", "strings.xml");
if (existsSync(strings)) {
  let s = readFileSync(strings, "utf8");
  s = s.replace(/(<string name="app_name">)[^<]*(<\/string>)/, "$1VEYRA AI$2").replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, "$1VEYRA AI$2");
  writeFileSync(strings, s);
}
log("Nome do app: VEYRA AI");
