# VEYRA AI 2.0 — App Android

O app é o **mesmo front-end do site** empacotado com **Capacitor** (gratuito, código aberto), falando com a **mesma API** (Vercel) e o **mesmo banco** (Neon). Contas, finanças, agenda, hábitos e histórico são os que você já usa.

> **Honestidade primeiro.** O ambiente onde isto foi desenvolvido **não tem Android SDK, não alcança o npm nem as APIs externas e não tem celular.** Por isso: **o APK não foi compilado aqui e nenhum recurso nativo foi testado em aparelho real.** A seção [O que foi testado](#o-que-foi-testado-e-o-que-não-foi) diz exatamente o quê.

## 1. Como conseguir o APK (de graça)

### Caminho A — GitHub Actions (não precisa instalar nada no PC) ✅ recomendado
1. Envie o projeto para o seu repositório no GitHub (o mesmo da Vercel).
2. No GitHub: aba **Actions** → **Gerar APK Android** → **Run workflow**.
3. No campo **api_url** coloque o endereço do seu site na Vercel (ex.: `https://veyra.vercel.app`). Se deixar vazio, o app pede o endereço na tela de entrada.
4. Espere ~10 min. Ao terminar, abra a execução → **Artifacts** → baixe **veyra-ai-apk** (zip com `app-debug.apk`).

### Caminho B — Android Studio no Windows
1. Instale **Node 22+**, **Android Studio (Otter 2025.2.1 ou mais novo)** e **JDK 21** (vem com o Android Studio).
2. No terminal, dentro da pasta do projeto:
   ```
   cd web
   npm install
   set VITE_API_BASE=https://SEU-SITE.vercel.app
   npm run build
   cd ..\android-app
   npm install
   npx cap add android
   node scripts/android-setup.mjs
   npx cap sync android
   node scripts/android-setup.mjs
   npx cap open android
   ```
3. No Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**. O arquivo fica em `android-app/android/app/build/outputs/apk/debug/app-debug.apk`.

(Nunca rode `cap sync` sem rodar `android-setup.mjs` depois: é ele que reinstala o código nativo da Veyra, o ícone e as permissões. É seguro rodar várias vezes.)

## 2. Instalar no Galaxy A16 (e em outros)
1. Copie o `app-debug.apk` para o celular (cabo USB, Google Drive, WhatsApp para você mesmo…).
2. Abra o arquivo no celular. O Android pedirá para **permitir instalar apps desta fonte** (Meus Arquivos/Chrome) — permita.
3. Toque em **Instalar** → **Abrir**. Se o Play Protect avisar que o app é desconhecido, escolha **Instalar mesmo assim** (é um APK de teste assinado com chave de debug, não da Play Store).
4. Na tela de entrada, confirme o **endereço do servidor** e **entre com sua conta existente** (ou crie uma).
5. Ao tocar no microfone, o Android pede a permissão de microfone. Na primeira vez que pedir alarme/calendário, pede as outras.

Para testar em outros celulares (A17, A23, A12, A11, A10, A01): instale o mesmo APK e rode o **roteiro de testes** da seção 8.

## 3. Compatibilidade
- **Android mínimo: 7.0 (API 24)** — exigência do Capacitor 8. Todos os aparelhos citados (Android 9+) atendem. Alvo: Android 16 (API 36).
- Sem nada exclusivo da Samsung; usa só APIs oficiais do Android (SpeechRecognizer, TextToSpeech, AlarmClock, CalendarContract).
- Limitações esperadas: **A01/A10/A11** têm pouca memória e WebView antigo (pode ser mais lento; atualize o “Android System WebView” e o Chrome na Play Store); o **reconhecimento de voz** depende do serviço de voz do aparelho (app Google) e, sem o pacote offline em português, **precisa de internet**.

## 4. Variáveis de ambiente (Vercel → Settings → Environment Variables)
| Variável | Para quê | Obrigatória? |
|---|---|---|
| `DATABASE_URL` | Banco Neon (já configurada) | Sim (já está) |
| `GEMINI_API_KEY` | IA conversacional gratuita (Google AI Studio) | Para a conversa livre |
| `GROQ_API_KEY` / `OPENROUTER_API_KEY` | Alternativas gratuitas | Não |
| `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY` | Escolher/trocar provedor (inclui qualquer API compatível com OpenAI) | Não |
| `ANTHROPIC_API_KEY` | Claude (pago) | Não — não é necessário |
| `BRAPI_TOKEN`, `AWESOMEAPI_TOKEN` | Cotações, se o acesso sem token bater limite | Não |
| `APP_ORIGINS` | Origens extras do app (o padrão já cobre o app) | Não |

**Nada disto vai para o app.** As chaves ficam só no servidor. Sem chave de IA o app funciona no “modo local” (comandos simples, alarme, cotações), e diz isso com clareza.
Depois de mudar variáveis na Vercel, faça um **Redeploy**.

### Limites do plano gratuito de IA (aprox., podem mudar — confira no provedor)
- **Gemini (Google AI Studio):** dezenas de pedidos por minuto e cerca de 1.000+ por dia no modelo “flash”. No plano gratuito o Google **pode usar os textos enviados para melhorar produtos**. Para uso pessoal é aceitável; evite dados muito sensíveis, ou use um plano pago/outro provedor.
- **Groq / OpenRouter (`:free`):** limites por minuto/dia menores; o modelo pode mudar. Quando o limite estoura, a Veyra cai sozinha no modo local e avisa.
- Custo total do projeto: **R$ 0**.

## 5. Permissões do Android
| Permissão | Para quê | Quando pede |
|---|---|---|
| Internet | falar com a API da Veyra | instalação |
| Microfone (`RECORD_AUDIO`) | comandos por voz | ao tocar no microfone |
| Calendário (`READ_CALENDAR`, `WRITE_CALENDAR`) | consultar/criar/alterar/excluir eventos do **calendário do celular** | no primeiro uso de calendário |
| Definir alarme (`SET_ALARM`) | pedir alarme ao app Relógio | instalação (permissão normal) |

Se você negar, a Veyra diz que o Android negou e como liberar (Configurações → Apps → Veyra AI → Permissões). Conta Google **não** é obrigatória: o calendário usado é o que existir no aparelho (local ou de qualquer conta).

## 6. Como cada recurso funciona (e seus limites reais)
- **Conversa:** IA em nuvem com a personalidade da Veyra, contexto das últimas mensagens e **ferramentas** (finanças, agenda, hábitos, mercado, alarme, calendário). A IA só chama funções de uma **lista fechada**; o servidor valida tudo; dados de um usuário nunca aparecem para outro.
- **Voz (entrada):** reconhecimento de voz do Android → texto → mesmo caminho do chat. Mostra “Ouvindo…”, pode ser cancelado, erros em português.
- **Voz (saída):** *Mais → Voz → Ler as respostas em voz alta* (desligado por padrão). Usa o TTS do aparelho (gratuito).
- **Alarmes:** usa a intent oficial `ACTION_SET_ALARM` (app Relógio). **O Android não informa se o alarme foi salvo e não deixa ler/alterar/cancelar alarmes.** Por isso a Veyra diz “pedi ao Relógio” (nunca “alarme criado”), o Relógio mostra o alarme para você confirmar, e ela recusa listar/cancelar. “Às 4” é ambíguo → ela pergunta manhã ou tarde.
- **Calendário do celular:** consultar, criar (verifica conflito antes e pergunta), alterar e excluir (**sempre com confirmação na tela**). Eventos **recorrentes** e de dia inteiro: consulta sim; alterar/excluir não (a Veyra avisa). Usa o fuso do aparelho. Alterar/excluir exige a IA em nuvem (precisa do identificador do evento).
  - Com o calendário do celular ativo, eventos criados pela Veyra podem aparecer **duplicados** (agenda da Veyra + calendário do celular).
- **Mercado:** dólar comercial (AwesomeAPI; reserva: PTAX do Banco Central, que **não é tempo real** e a Veyra avisa) e Ibovespa (brapi; reserva: Yahoo). Sempre informa valor, variação, data/hora, fonte e atraso; fora do pregão mostra “último valor disponível”. Se nenhuma fonte responde, diz que não conseguiu — **nunca inventa nem apresenta cotação velha como atual.** “E ontem?” usa o assunto anterior. Outros ativos: ainda não.

## 7. Online × offline
| Situação | O que acontece |
|---|---|
| Online | Tudo funciona. |
| Sem internet | O app abre, mas **conversa, login, finanças e agenda precisam do servidor** — mostra erro claro e permite reenviar. Não há banco local nem sincronização offline nesta versão (é uma limitação, não uma simulação). |
| Voz sem internet | Só se o aparelho tiver o pacote de voz offline em português; senão a Veyra avisa para digitar. |
| TTS sem internet | Funciona se houver voz em português instalada no aparelho. |

## 8. Roteiro de testes no aparelho (faça no Galaxy A16 e nos outros)
1. Criar conta nova e entrar de novo com ela; entrar com uma conta **existente** do site; ver os mesmos dados do site.
2. “Gastei 35 no mercado” → aparece em Finanças (e no site).
3. Microfone: permitir → falar “quanto está o dólar?” → resposta com fonte/horário. Negar a permissão → mensagem de permissão. Tocar no mic durante a gravação → cancela.
4. Ligar “Ler respostas em voz alta” e conversar.
5. “Coloca um alarme para as 4” (deve perguntar), “…da tarde” → abre o Relógio. Confirme lá. Confira o texto: “pedi ao Relógio”.
6. “O que tenho amanhã?”, “Marca dentista quinta às 15” (com e sem conflito), “Exclui o dentista” (deve pedir confirmação).
7. Modo avião: erro claro no envio, sem travar.
8. “Ibovespa” e “E ontem?”.

## 9. O que foi testado e o que NÃO foi
**Testado aqui (automático, SQLite + PostgreSQL 16 real): 74 testes do servidor + 5 da lógica do app**
- cadastro/login/logout com token (app) e cookie (site, inalterado), CORS só para origens do app, cookie cross-origin ignorado;
- migração nova (004) em SQLite e PostgreSQL; isolamento entre contas; continuação de conversa de uso único, com validade e só do dono;
- mercado com respostas simuladas das APIs (formatos conforme a documentação pública): variação, atraso, reserva, falha honesta, cache;
- adaptador de IA (tradução de mensagens/ferramentas), escolha de provedor, ferramentas do aparelho validadas no servidor, recusa de ferramentas fora da lista;
- interpretador local (alarme, ambiguidade, mercado, acompanhamento, conversa social);
- lógica do app (execução das ações do aparelho, confirmação de exclusão, endereço do servidor, mensagens de erro de voz).

**NÃO testado (precisa de você / de rede real):**
- ❌ **Compilação do APK** (sem Android SDK/npm aqui). O workflow e o script de montagem foram escritos e validados só em estrutura. O código Java foi checado por compilação contra *stubs* das APIs, **não** contra o Android real.
- ❌ **Qualquer recurso nativo em aparelho real**: microfone, TTS, alarme, calendário, permissões, ícone/abertura, teclado/barra de status.
- ❌ **APIs externas reais** (AwesomeAPI, BCB, brapi, Yahoo, Gemini/Groq): os formatos vêm da documentação. Rode `npm run check:live -w server` no seu PC (com internet) para conferir; se algo mudou, me mande a saída.
- ❌ Telas TSX com o compilador do TypeScript/Vite (sem `@types/react` aqui): foram empacotadas com esbuild e a lógica testada, mas rode `npm run build` na sua máquina/Actions.
