# VEYRA — seu assistente pessoal inteligente

> **Você fala. A Veyra entende. A Veyra faz.**

Assistente pessoal conversacional: você escreve “gastei 47 no mercado” ou “amanhã às 10 me lembra de ligar para o contador” e a Veyra **executa de verdade** — grava no banco, atualiza saldo, agenda e hábitos. Esta é a **Fase 1 (fundação)** do roadmap, com Finanças e Agenda em versão inicial.

## Instalação rápida

Requisitos: **Node.js 22.13 ou superior** (o banco usa o SQLite nativo do Node — não há nada para compilar) e npm.

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

Copie `server/.env.example` para `server/.env`. **Tudo é opcional** — sem nenhuma variável o app funciona com o interpretador local.

| Variável | Para quê |
|---|---|
| `ANTHROPIC_API_KEY` | Liga a IA em nuvem (Claude). Fica **só no servidor**, nunca vai ao navegador. |
| `ANTHROPIC_MODEL` | Modelo usado (padrão `claude-sonnet-5-5`). |
| `PORT`, `VEYRA_DATA_DIR` | Porta e pasta do banco. |
| `ALLOWED_ORIGINS`, `TRUST_PROXY`, `COOKIE_SECURE` | Ajustes de deploy (ver `.env.example`). |

### Testes

```bash
npm test             # 43 testes: interpretador, API ponta a ponta, isolamento, persistência, segurança
npm run typecheck
```

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
| Ibovespa, dólar, ações, watchlist | 5 | API de cotações (ex.: brapi.dev) + chave no servidor |
| Alertas de mercado | 5 | A API acima + monitor em segundo plano |
| Treinos (carga/séries/evolução) | 4 | Ferramentas de IA (as tabelas já existem). Hoje “treinei” marca o **hábito** Treino. |
| WhatsApp | 6 | WhatsApp Business Cloud API + webhook público |
| Voz | 6 | Serviço de transcrição (o botão de microfone avisa que ainda não funciona) |
| Notificações push | 6 | PWA com Web Push (VAPID) + agendador. **Lembretes ficam salvos e aparecem na Agenda, mas ainda não “tocam” no horário.** |
| Calendário externo | 6 | OAuth Google/Apple |
| Resumos automáticos manhã/noite | 6 | Agendador. (Por enquanto: “resumo do dia” responde na hora.) |

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
  db/         migrations.ts (adicione uma migração nova ao final — nunca edite as antigas)
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
- Limitador de taxa é em memória (uma instância). Para várias instâncias, troque por Redis mantendo a interface de `http/rateLimit.ts`.

## Limitações conhecidas

- Datas e horas são guardadas como “horário de parede” no fuso do usuário (configurável em Mais). Viajar entre fusos não reajusta itens já criados.
- Saldo = entradas − saídas registradas até hoje. Para partir do seu saldo real, diga “meu saldo é 2.840” (cria um lançamento de ajuste transparente).
- Sem recuperação de senha por e-mail e sem verificação de e-mail (exigem um serviço de e-mail).
- Sem service worker/offline ainda: o `manifest` está pronto para virar PWA, mas instalar como app e notificações ficam para a Fase 6.
- Tema escuro não implementado (a direção visual é base clara).
- A fonte (Hanken Grotesk) vem do Google Fonts; sem internet, cai para a fonte do sistema.
- Este pacote foi validado no ambiente de desenvolvimento com bundler alternativo (esbuild + React local) porque o registro do npm estava bloqueado: **`npm install` e `npm run build` (Vite) não puderam ser executados aqui.** O código segue a configuração padrão do Vite; se algo falhar na sua máquina, me envie a mensagem de erro.

## Roadmap

1. **Fundação** — este pacote ✅
2. Finanças: gráficos, edição, metas, orçamento por categoria
3. Agenda: edição, visão semanal arrastável
4. Hábitos e treinos completos
5. Mercado: cotações reais, watchlist, alertas
6. Integrações: WhatsApp, calendário, push, voz
