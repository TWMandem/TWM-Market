-- Предложения игроков по улучшению приложения и ответы администрации.

CREATE TABLE feedback (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id      uuid        REFERENCES users (id) ON DELETE SET NULL,
  category       text        NOT NULL CHECK (category IN ('improvement', 'problem', 'other')),
  title          text        NOT NULL CHECK (char_length(title) BETWEEN 5 AND 120),
  description    text        NOT NULL CHECK (char_length(description) BETWEEN 20 AND 4000),
  status         text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'planned', 'done', 'declined')),
  response       text        NOT NULL DEFAULT '' CHECK (char_length(response) <= 2000),
  reviewed_by    uuid        REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feedback_author_idx ON feedback (author_id, created_at DESC);
CREATE INDEX feedback_status_idx ON feedback (status, created_at DESC);

