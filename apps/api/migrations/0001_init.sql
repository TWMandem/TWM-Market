-- Шаг 2: аккаунты, сессии, коды подтверждения, серверы, игровые профили.

CREATE TABLE servers (
  id            smallserial PRIMARY KEY,
  number        smallint    NOT NULL UNIQUE CHECK (number > 0),
  name          text        NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 32),
  color         text        NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active     boolean     NOT NULL DEFAULT true,
  transfer_open boolean     NOT NULL DEFAULT true,
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  login              text        NOT NULL CHECK (char_length(login) BETWEEN 3 AND 24),
  email              text        NOT NULL CHECK (char_length(email) <= 254),
  password_hash      text        NOT NULL,
  role               text        NOT NULL DEFAULT 'user'
                                 CHECK (role IN ('user', 'moderator', 'admin', 'superadmin')),
  status             text        NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'blocked')),
  email_verified_at  timestamptz,
  failed_login_count integer     NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- Логин и email уникальны без учёта регистра.
CREATE UNIQUE INDEX users_login_lower_uq ON users (lower(login));
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

-- Сессия = одно устройство. Храним только хеш refresh-токена.
CREATE TABLE sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash      text        NOT NULL UNIQUE,
  -- Предыдущий хеш: если старый токен предъявят ещё раз, значит его украли.
  prev_token_hash text        UNIQUE,
  user_agent      text,
  ip              text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- Шестизначные коды из писем: подтверждение email и сброс пароля.
CREATE TABLE email_codes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose    text        NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  code_hash  text        NOT NULL,
  attempts   integer     NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_codes_lookup_idx ON email_codes (user_id, purpose, created_at DESC);

CREATE TABLE game_profiles (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  server_id           smallint    NOT NULL REFERENCES servers (id),
  nickname            text        NOT NULL CHECK (char_length(nickname) BETWEEN 2 AND 32),
  verified_at         timestamptz,
  nickname_changed_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Один аккаунт не может дважды указать один ник на одном сервере.
-- Между разными аккаунтами ники не уникальны: подтвердить владение мы пока не можем.
CREATE UNIQUE INDEX game_profiles_user_nick_uq ON game_profiles (user_id, server_id, lower(nickname));
CREATE INDEX game_profiles_nick_idx ON game_profiles (server_id, lower(nickname));

CREATE TABLE game_profile_history (
  id           bigserial   PRIMARY KEY,
  profile_id   uuid        NOT NULL REFERENCES game_profiles (id) ON DELETE CASCADE,
  old_nickname text        NOT NULL,
  new_nickname text        NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX game_profile_history_profile_idx ON game_profile_history (profile_id, changed_at DESC);
