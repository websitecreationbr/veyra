# VEYRA — seu assistente pessoal inteligente

> **Você fala. A Veyra entende. A Veyra faz.**

Assistente pessoal conversacional: você escreve “gastei 47 no mercado” ou “amanhã às 10 me lembra de ligar para o contador” e a Veyra **executa de verdade** — grava no banco, atualiza saldo, agenda e hábitos. Esta é a **Fase 1 (fundação)** do roadmap, com Finanças e Agenda em versão inicial.

## Instalação rápida

Requisitos: **Node.js 22.13 ou superior** (localmente o banco é o SQLite nativo do Node — não há nada para compilar) e npm. **Em produção (Vercel) o banco é PostgreSQL** — veja “Publicar na Vercel” abaixo.

```bash
npm install
npm run dev          # API em :8787 + app em http://localhost:5173
```

Abra **http://localhost:5173**, crie uma conta e fale com a Veyra. Os dados ficam em `server/.data/veyra.db` e **sobrevivem a reiniciar o servidor**.

### Produção / uso local "de verdade"

```bash
npm run build        # compila o app (web/dist) e a API (server/dist)
npm start            # tudo em http://localhost:8787
```
Em produção os cookies são `Secure` (exigem HTTPS). Para testar `npm start` em `http://localhost`, use `COOKIE_SECURE=0`. Atrás de um proxy reverso, defina `TRUST_PROXY=1`.

### Configuração (`server/.env`)

Copie `server/.env.example` para `server/.env`. **Localmente tudo é opcional** — sem nenhuma variável o app funciona com SQLite e o interpretador local. Na Vercel, `DATABASE_URL` é **obrigatória**.

| Variável | Para quê |
|---|---|
| `ANTHROPIC_API_KEY` | Liga a IA em nuvem (Claude). Fica **só no servidor**, nunca vai ao navegador. |
| `ANTHROPIC_MODEL` | Modelo usado (padrão `claude-sonnet-5-5`). |
| `DATABASE_URL` | Endereço do PostgreSQL (`postgres://usuario:senha@host:5432/banco`). **Se definida, o app usa PostgreSQL**; se não, usa SQLite local. Obrigatória na Vercel. |
| `DATABASE_SSL` | Opcional: `disable` ou `no-verify`. O padrão (verificar o certificado) é o correto para Neon, Supabase, Vercel Postgres etc. |
| `PG_POOL_MAX` | Opcional: conexões por instância (padrão 3). |
| `PORT`, `VEYRA_DATA_DIR` | Porta e pasta do banco SQLite local. |
| `ALLOWED_ORIGINS`, `TRUST_PROXY`, `COOKIE_SECURE` | Ajustes de deploy (ver `.env.example`). |

### Banco de dados: SQLite (local) × PostgreSQL (produção)

- **Por que não SQLite em produção?** Na Vercel não há processo contínuo nem disco permanente: um arquivo `.db` seria apagado a cada nova instância da função. Por isso a produção usa **PostgreSQL hospedado**.
- O mesmo código roda nos dois (`server/src/db/`): `DATABASE_URL` definida → PostgreSQL; senão → SQLite em `server/.data/veyra.db`. O SQL é escrito de forma portável (parâmetros `?`, `ON CONFLICT`, sem `rowid`).
- **Migrações** rodam sozinhas ao iniciar (e com `npm run migrate`). SQLite: `db/migrations.ts` (controle por `PRAGMA user_version`); PostgreSQL: `db/migrations.pg.ts` (tabela `schema_migrations`, com trava para duas instâncias não migrarem juntas). **Ao criar uma migração, adicione-a nos dois arquivos, com o mesmo número.**
- Bancos SQLite já existentes são atualizados sem perder dados (testado).
- Migrar dados antigos do SQLite local para o PostgreSQL **não é automático**: contas criadas só no seu computador não aparecem no site publicado (o banco da produção começa vazio — é só se cadastrar de novo).

### Testes

```bash
npm test                                   # SQLite: interpretador, API ponta a ponta, isolamento, persistência, segurança, fluxo principal
TEST_DATABASE_URL=postgres://usuario@localhost:5432/banco_de_teste npm test   # os mesmos testes em PostgreSQL real
npm run typecheck
npm run check:api                          # confere se a função da Vercel (api/) está em dia com o código
```
Com `TEST_DATABASE_URL`, cada teste cria um *schema* próprio e o apaga no fim (use um banco **de teste**, nunca o de produção).

---

## Publicar na Vercel (passo a passo)

O repositório já vem pronto: `vercel.json` (site estático de `web/dist` + rotas), `api/[...path].js` (a API inteira como função da Vercel) e `scripts/build-api.mjs` (que gera essa função).

**1. Crie um banco PostgreSQL** (grátis serve). Opções: *Vercel → Storage → Create Database → Neon (Postgres)*, ou Neon/Supabase direto. Copie a **connection string** (`postgres://…`). Use a versão *pooled*/“pooler” se houver as duas.

**2. Configure as variáveis na Vercel**: *Projeto → Settings → Environment Variables* e adicione, para **Production** (e Preview, se usar):

| Nome | Valor | Obrigatória |
|---|---|---|
| `DATABASE_URL` | a connection string do passo 1 | **sim** |
| `ANTHROPIC_API_KEY` | sua chave da Anthropic (liga a IA em nuvem) | não |

Se você criou o banco pela aba *Storage* da própria Vercel, ela já cria `POSTGRES_URL`, que o app também aceita.

**3. Confira as configurações do projeto** (*Settings → General*): **Root Directory** vazio (a raiz do repositório, **não** `web`); **Framework Preset: Other**; Build/Output/Install vêm do `vercel.json`. Node.js 22.x ou 24.x.

**4. Envie esta versão** para o mesmo projeto: substitua os arquivos do repositório ligado à Vercel por este pacote (ou rode `npx vercel --prod` na pasta). Faça um novo deploy (*Deployments → Redeploy*, **sem** usar o cache de build).

**5. Verifique** (troque pelo seu endereço):
1. Abra `https://SEU-SITE.vercel.app/api/health` → deve mostrar `{"ok":true,"db":"postgres"}`.
   - `503 banco_nao_configurado` → faltou `DATABASE_URL` (passo 2; depois faça Redeploy).
   - `503 banco_indisponivel` → a connection string está errada ou o banco está fora do ar; veja os logs (abaixo).
   - Página/erro HTML ou 404 → a pasta `api/` não foi publicada ou o Root Directory está errado (passo 3).
2. Abra o site, **crie uma conta**, registre “Gastei 47 no mercado”, pergunte “qual é o meu saldo?”, **saia**, **entre de novo** e confira que os dados continuam.

**Onde ver os erros reais:** *Vercel → seu projeto → Logs* (filtre por “Function”/`/api`). Os erros da API aparecem como `[veyra] …`. No navegador: F12 → aba *Network* → clique na chamada `register` e veja *Status* e *Response*.

**Depois de mudar o código em `server/src`**: rode `npm run build:api` e envie também o arquivo `api/[...path].js` atualizado (a Vercel só detecta funções pelos arquivos enviados).

---

## O que funciona hoje (real, testado)

| Área | Estado |
|---|---|
| Cadastro, login, logout, sessão por cookie HttpOnly | ✅ |
| **Flow** (conversa): registrar gasto/receita, várias ações numa frase, perguntas de acompanhamento, **Desfazer** | ✅ |
| Consultas com dados reais: saldo, gastos por período/categoria, maior gasto, comparação com mês passado, receitas/economia | ✅ |
| Projeção (“quanto tempo meu saldo dura”, “quanto posso gastar por semana”) — sempre como **estimativa** | ✅ |
| Tarefas, lembretes (únicos e recorrentes), eventos, recorrência (todo dia, seg–sex, dias da semana, mensal) | ✅ |
| Agenda: Hoje / Semana / Mês, atrasadas, tarefas sem data, concluir | ✅ |
| Hábitos: registrar por conversa, sequência atual/melhor, frequência | ✅ (visível em Início e Mais) |
| Finanças: saldo, entradas, saídas, resultado, categorias, histórico, remover | ✅ |
| Layout responsivo (celular → barra inferior; desktop → menu lateral), estados de carregando/vazio/erro | ✅ |
| Persistência em SQLite com migrações versionadas | ✅ |

## Dados de demonstração

Existem, mas **nunca aparecem sozinhos**. Em **Mais → Carregar dados de demonstração** (ou `npm run seed -- seu@email.com`) são criados exemplos marcados `source = 'demo'`; um aviso fica visível no Início e **um toque remove tudo** sem tocar nos seus dados reais. Código isolado em `server/src/demo/`.

## O que ainda NÃO existe (e a Veyra diz isso, sem simular)

Aparece na tela **Mais → Ainda não disponível** e na resposta da Veyra quando você pede:

| Recurso | Fase | Depende de |
|---|---|---|
| Ações individuais, euro, bitcoin, watchlist | 5 | Dólar e Ibovespa **já existem** (2.0). O resto precisa de mais fontes de cotação |
| Alertas de mercado | 5 | A API acima + monitor em segundo plano |
| Treinos (carga/séries/evolução) | 4 | Ferramentas de IA (as tabelas já existem). Hoje “treinei” marca o **hábito** Treino. |
| WhatsApp | 6 | WhatsApp Business Cloud API + webhook público |
| Voz | — | **Já existe no app Android e no Chrome** (microfone + resposta falada) — veja `docs/ANDROID.md` |
| Notificações push | 6 | PWA com Web Push (VAPID) + agendador. **Lembretes ficam salvos e aparecem na Agenda, mas ainda não “tocam” no horário.** |
| Calendário Google/Apple direto (nuvem) | 6 | OAuth. O calendário **do celular** já funciona no app Android |
| Resumos automáticos manhã/noite | 6 | Agendador. (Por enquanto: “resumo do dia” responde na hora.) |

## VEYRA AI 2.0 — app Android

O mesmo site e a mesma API viram um app instalável (Capacitor), com a **mesma conta e o mesmo banco (Neon)**.
Conversa com IA real (provedores gratuitos), microfone, resposta falada, alarmes, calendário do celular e cotações reais de dólar/Ibovespa.
**Guia completo (compilar o APK, instalar no Galaxy A16, permissões, limites, o que foi e o que NÃO foi testado): [`docs/ANDROID.md`](docs/ANDROID.md).**

## Dois "cérebros", mesma execução

```
mensagem ─► handleChat ─┬─ Claude (tool-use)   ← com ANTHROPIC_API_KEY
                        └─ interpretador local ← sem chave / se a nuvem falhar
                                   │
                         chamadas de ferramenta (JSON)
                                   ▼
                    executeTool → valida → serviço → SQLite
```

- **Interpretador local** (`server/src/ai/local.ts`): entende os comandos comuns em português. Não conversa livremente — frases muito soltas retornam um “não entendi” com exemplos. Números por extenso (“dois mil”) ainda não.
- **Claude** (`server/src/ai/claude.ts`): entende frases livres. O modelo só **escolhe** as funções; quem executa é o nosso código, com validação e isolamento por usuário. Se a nuvem falhar, o modo local assume sem repetir ações já executadas.
- ⚠️ O caminho Claude foi testado com um cliente simulado (sem rede/chave neste ambiente). Teste com a sua chave antes de depender dele.

## Estrutura

```
server/src/
  ai/         tools.ts (as funções da IA) · local.ts · claude.ts · chat.ts · planned.ts (o que ainda não existe)
  services/   auth · finance · agenda · habits · messages · dashboard   (toda query filtra por user_id)
  db/         index.ts (abre SQLite ou PostgreSQL) · migrations.ts (SQLite) · migrations.pg.ts (PostgreSQL) — nunca edite migrações antigas
  vercel.ts   função serverless (empacotada em api/[...path].js pelo scripts/build-api.mjs)
  http/       servidor, cookies, CSRF, limites de taxa, cabeçalhos de segurança
  routes/     rotas da API
  demo/       dados de demonstração (isolados)
web/src/
  components/ Card, Button, Field, Sheet, Toasts, Composer, Message (recibo), Rows, Nav
  screens/    Auth · Home · Flow · Finance · Agenda · More
  state/      auth · app (chat, avisos, versão de dados) · router
```

### Como estender (sem reconstruir nada)

- **Nova função da IA** (ex.: `consultar_ibovespa`): crie o serviço, adicione um `Tool` em `ai/tools.ts` (nome, descrição, JSON Schema, `run`) e remova a entrada de `ai/planned.ts`. O Claude passa a enxergá-la sozinho; para o modo local, adicione o padrão em `ai/local.ts`.
- **WhatsApp / áudio**: um novo canal só precisa chamar `handleChat(ctx, texto, deps)` e devolver `assistant.text`. A tabela `messages` já tem a coluna `channel`.
- **Notificações / calendário**: `reminders.notified_at` e `events.external_id` já existem para isso.
- **Mercado, treinos**: as tabelas (`exercises`, `workouts`, `workout_sets`, `market_alerts`, `watchlist`) já estão criadas.

## Segurança

- Senhas com **scrypt** + sal; resposta de login idêntica para e-mail inexistente ou senha errada; limite de tentativas.
- Sessão por cookie **HttpOnly + SameSite=Lax** (+ `Secure` em produção); o token é guardado só como hash no banco.
- **CSRF**: toda requisição que altera dados exige o cabeçalho `X-Requested-With` + checagem de `Origin`.
- **Isolamento**: todas as consultas filtram por `user_id`; acessar registro de outra conta devolve 404 (testado com duas contas).
- Entrada validada em toda a API e nas funções da IA; valores em centavos (inteiros); limites de tamanho de corpo e de taxa; CSP e demais cabeçalhos.
- A chave da Anthropic existe **apenas** no servidor; `/api/me` informa só “claude” ou “local”.
- Limites de login, cadastro e conversa ficam **no banco** (valem para todas as instâncias, essencial na Vercel). O limite geral da API é em memória, por instância.

## Limitações conhecidas

- Datas e horas são guardadas como “horário de parede” no fuso do usuário (configurável em Mais). Viajar entre fusos não reajusta itens já criados.
- Saldo = entradas − saídas registradas até hoje. Para partir do seu saldo real, diga “meu saldo é 2.840” (cria um lançamento de ajuste transparente).
- Sem recuperação de senha por e-mail e sem verificação de e-mail (exigem um serviço de e-mail).
- Sem service worker/offline ainda: o `manifest` está pronto para virar PWA, mas instalar como app e notificações ficam para a Fase 6.
- Tema escuro não implementado (a direção visual é base clara).
- A fonte (Hanken Grotesk) vem do Google Fonts; sem internet, cai para a fonte do sistema.
- **A publicação real na Vercel não pôde ser testada daqui** (sem acesso à sua conta). O que foi testado: o pacote da função gerado (`api/`) rodando num processo Node separado, do mesmo jeito que a Vercel o carrega, contra um PostgreSQL 16 real. Ficaram sem teste: o comportamento da plataforma Vercel em si e o driver `pg` oficial (o ambiente de testes não tinha acesso ao npm; os testes usam um cliente de protocolo PostgreSQL próprio, só de teste).
- Este pacote foi validado no ambiente de desenvolvimento com bundler alternativo (esbuild + React local) porque o registro do npm estava bloqueado: **`npm install` e `npm run build` (Vite) não puderam ser executados aqui.** O código segue a configuração padrão do Vite; se algo falhar na sua máquina, me envie a mensagem de erro.

## Roadmap

1. **Fundação** — este pacote ✅
2. Finanças: gráficos, edição, metas, orçamento por categoria
3. Agenda: edição, visão semanal arrastável
4. Hábitos e treinos completos
5. Mercado: cotações reais, watchlist, alertas
6. Integrações: WhatsApp, calendário, push, voz
