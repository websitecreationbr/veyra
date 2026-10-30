// Migrações do PostgreSQL. Mesma numeração/nomes das migrações do SQLite (migrations.ts):
// ao evoluir o banco, ADICIONE a mudança nos DOIS arquivos, com o mesmo número.
// Datas continuam como TEXT (ISO) para o código funcionar igual nos dois bancos.

const NOW = `(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))`;
const NOW_ISO = `(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`;

export const pgMigrations: { name: string; sql: string }[] = [
  {
    name: "001_fundacao",
    sql: `
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE settings (
  user_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  currency TEXT NOT NULL DEFAULT 'BRL',
  locale   TEXT NOT NULL DEFAULT 'pt-BR'
);

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
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  category_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
  description  TEXT NOT NULL DEFAULT '',
  occurred_on  TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','demo')),
  created_at   TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_tx_user_date ON transactions(user_id, occurred_on);

CREATE TABLE tasks (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  due_date   TEXT,
  due_time   TEXT,
  priority   TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta')),
  done_at    TEXT,
  source     TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','demo')),
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_tasks_user ON tasks(user_id, due_date);

CREATE TABLE reminders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  remind_date TEXT NOT NULL,
  remind_time TEXT,
  recurrence  TEXT,
  priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta')),
  done_at     TEXT,
  notified_at TEXT,
  source      TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','demo')),
  created_at  TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_reminders_user ON reminders(user_id, remind_date);

CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  start_date  TEXT NOT NULL,
  start_time  TEXT,
  end_time    TEXT,
  recurrence  TEXT,
  external_id TEXT,
  source      TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','demo')),
  created_at  TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_events_user ON events(user_id, start_date);

CREATE TABLE habits (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '•',
  archived   INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','demo')),
  created_at TEXT NOT NULL DEFAULT ${NOW},
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

CREATE TABLE exercises (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  muscle_group TEXT NOT NULL DEFAULT '',
  UNIQUE (user_id, name)
);
CREATE TABLE workouts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_date TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE workout_sets (
  id          TEXT PRIMARY KEY,
  workout_id  TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  weight_kg   DOUBLE PRECISION,
  reps        INTEGER NOT NULL,
  sets        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE market_alerts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     TEXT NOT NULL,
  condition  TEXT NOT NULL CHECK (condition IN ('above','below','change_up_pct','change_down_pct')),
  threshold  DOUBLE PRECISION NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','triggered','cancelled')),
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE watchlist (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol  TEXT NOT NULL,
  PRIMARY KEY (user_id, symbol)
);

CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  actions    TEXT,
  pending    TEXT,
  channel    TEXT NOT NULL DEFAULT 'app',
  created_at TEXT NOT NULL DEFAULT ${NOW_ISO}
);
CREATE INDEX idx_messages_user ON messages(user_id, created_at);
`,
  },
  {
    name: "002_seq",
    sql: `
ALTER TABLE transactions ADD COLUMN seq BIGINT NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN seq BIGINT NOT NULL DEFAULT 0;
CREATE INDEX idx_messages_seq ON messages(user_id, seq);
`,
  },
  {
    name: "003_rate_limits",
    sql: `
CREATE TABLE rate_limits (
  k        TEXT PRIMARY KEY,
  hits     INTEGER NOT NULL,
  reset_at BIGINT NOT NULL
);
`,
  },
];
