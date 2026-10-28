// Migrações versionadas. Para evoluir o banco, ADICIONE uma nova entrada ao final da lista;
// nunca edite uma migração que já foi aplicada. O número de versão fica em PRAGMA user_version.

export const migrations: { name: string; sql: string }[] = [
  {
    name: "001_fundacao",
    sql: `
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE settings (
  user_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  currency TEXT NOT NULL DEFAULT 'BRL',
  locale   TEXT NOT NULL DEFAULT 'pt-BR'
);

-- Finanças ---------------------------------------------------------------
CREATE TABLE categories (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('expense','income')),
  icon    TEXT NOT NULL DEFAULT '•',
  UNIQUE (user_id, name, kind)
);

CREATE TABLE transactions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('expense','income')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  category_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
  description  TEXT NOT NULL DEFAULT '',
  occurred_on  TEXT NOT NULL,            -- YYYY-MM-DD no fuso do usuário
  source       TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','demo')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tx_user_date ON transactions(user_id, occurred_on);

-- Agenda -----------------------------------------------------------------
CREATE TABLE tasks (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  due_date   TEXT,
  due_time   TEXT,
  priority   TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta')),
  done_at    TEXT,
  source     TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','demo')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_user ON tasks(user_id, due_date);

CREATE TABLE reminders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  remind_date TEXT NOT NULL,              -- data inicial
  remind_time TEXT,                        -- HH:mm (opcional)
  recurrence  TEXT,                        -- NULL | daily | weekdays | weekly:1,3 | monthly:15
  priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta')),
  done_at     TEXT,
  notified_at TEXT,                        -- reservado para a Fase 6 (notificações)
  source      TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','demo')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_reminders_user ON reminders(user_id, remind_date);

CREATE TABLE events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  location   TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  start_time TEXT,                         -- NULL = dia inteiro
  end_time   TEXT,
  recurrence TEXT,
  external_id TEXT,                        -- reservado para a Fase 6 (calendário externo)
  source     TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','demo')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_user ON events(user_id, start_date);

-- Hábitos ----------------------------------------------------------------
CREATE TABLE habits (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '•',
  archived   INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','demo')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);
CREATE TABLE habit_logs (
  id       TEXT PRIMARY KEY,
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,
  UNIQUE (habit_id, log_date)
);
CREATE INDEX idx_habit_logs_user ON habit_logs(user_id, log_date);

-- Treinos (estrutura pronta; ferramentas de IA entram na Fase 4) ----------
CREATE TABLE exercises (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  muscle_group TEXT NOT NULL DEFAULT '',
  UNIQUE (user_id, name)
);
CREATE TABLE workouts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_date TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE workout_sets (
  id          TEXT PRIMARY KEY,
  workout_id  TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  weight_kg   REAL,
  reps        INTEGER NOT NULL,
  sets        INTEGER NOT NULL DEFAULT 1
);

-- Mercado (estrutura pronta; integração com API de cotações entra na Fase 5) --
CREATE TABLE market_alerts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     TEXT NOT NULL,
  condition  TEXT NOT NULL CHECK (condition IN ('above','below','change_up_pct','change_down_pct')),
  threshold  REAL NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','triggered','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE watchlist (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol  TEXT NOT NULL,
  PRIMARY KEY (user_id, symbol)
);

-- Conversa ---------------------------------------------------------------
CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  actions    TEXT,                          -- JSON: ações executadas nesta resposta
  pending    TEXT,                          -- JSON: pergunta de acompanhamento aguardando resposta
  channel    TEXT NOT NULL DEFAULT 'app',   -- app | whatsapp (Fase 6)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_messages_user ON messages(user_id, created_at);
`,
  },
];
