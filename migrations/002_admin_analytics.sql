-- Événements site (clics, funnel) avec classification trafic Maroc
CREATE TABLE IF NOT EXISTS site_events (
  id BIGSERIAL PRIMARY KEY,
  event_name VARCHAR(80) NOT NULL,
  event_id VARCHAR(128),
  page_path TEXT,
  product_slug VARCHAR(50),
  value NUMERIC(12, 2),
  currency CHAR(3) NOT NULL DEFAULT 'MAD',
  ip_hash VARCHAR(16) NOT NULL,
  country_code CHAR(2),
  is_valid_ma BOOLEAN NOT NULL DEFAULT FALSE,
  is_proxy BOOLEAN,
  is_hosting BOOLEAN,
  source_url TEXT,
  user_agent TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_events_created_at
  ON site_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_events_valid_ma_created
  ON site_events (is_valid_ma, created_at DESC)
  WHERE is_valid_ma = TRUE;

CREATE INDEX IF NOT EXISTS idx_site_events_event_name_created
  ON site_events (event_name, created_at DESC);

-- Accélère les listes commandes admin (filtre JSONB trafic valide)
CREATE INDEX IF NOT EXISTS idx_order_events_order_created
  ON order_events (event_type, created_at DESC)
  WHERE event_type = 'order_created';
