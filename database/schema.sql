-- GetBlessed MySQL schema (MySQL 8.0+)
--
-- Designed for a very large member base:
--   * InnoDB everywhere, BIGINT UNSIGNED surrogate keys (no int overflow at scale)
--   * utf8mb4 for full Unicode names / item descriptions
--   * Every list endpoint is served by a covering or prefix index and uses
--     keyset (cursor) pagination, never OFFSET scans
--   * Money is DECIMAL, never FLOAT
--   * Role is set by the server based on which sign-up page was used and can
--     never be supplied by the client

CREATE DATABASE IF NOT EXISTS getblessed
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE getblessed;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id       CHAR(26)        NOT NULL,              -- ULID exposed to clients
  email           VARCHAR(254)    NOT NULL,
  password_hash   VARCHAR(255)    NOT NULL,              -- bcrypt
  display_name    VARCHAR(80)     NOT NULL,
  role            ENUM('billable','blessings') NOT NULL, -- assigned automatically at sign-up
  status          ENUM('active','suspended','deleted') NOT NULL DEFAULT 'active',
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_login_at   DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_public_id (public_id),
  UNIQUE KEY uq_users_email (email),
  KEY ix_users_role (role, id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Extra profile data that only Blessings members have.
-- Kept in its own table so the hot `users` rows stay narrow.
CREATE TABLE IF NOT EXISTS blessing_profiles (
  user_id         BIGINT UNSIGNED NOT NULL,
  annual_income   DECIMAL(14,2)   NOT NULL,              -- yearly income entered at sign-up
  income_currency CHAR(3)         NOT NULL DEFAULT 'USD',
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  KEY ix_blessing_income (annual_income),
  CONSTRAINT fk_blessing_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_income_nonneg CHECK (annual_income >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Bills (posted by Billable members, visible to all Blessings members)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bills (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id       CHAR(26)        NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,              -- the Billable member who posted it
  title           VARCHAR(120)    NOT NULL,
  merchant        VARCHAR(120)    NULL,
  description     VARCHAR(1000)   NULL,
  image_key       VARCHAR(255)    NOT NULL,              -- storage key of the uploaded photo
  item_count      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  subtotal        DECIMAL(12,2)   NOT NULL DEFAULT 0.00,  -- sum of line items
  tax             DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  total           DECIMAL(12,2)   NOT NULL,              -- complete total of the bill
  currency        CHAR(3)         NOT NULL DEFAULT 'USD',
  status          ENUM('open','blessed','closed','removed') NOT NULL DEFAULT 'open',
  ocr_raw_text    MEDIUMTEXT      NULL,                  -- raw recognised text, for audits / re-parsing
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bills_public_id (public_id),
  KEY ix_bills_user (user_id, id),                       -- "my bills" (keyset on id)
  KEY ix_bills_status (status, id),                      -- Blessings feed filtered by status
  CONSTRAINT fk_bills_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT ck_bills_amounts CHECK (subtotal >= 0 AND tax >= 0 AND total >= 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Individual line items recognised on the bill (one row per item).
CREATE TABLE IF NOT EXISTS bill_items (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bill_id         BIGINT UNSIGNED NOT NULL,
  line_no         SMALLINT UNSIGNED NOT NULL,
  name            VARCHAR(200)    NOT NULL,
  quantity        DECIMAL(10,3)   NOT NULL DEFAULT 1.000,
  unit_price      DECIMAL(12,2)   NOT NULL,
  line_total      DECIMAL(12,2)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bill_items_line (bill_id, line_no),
  CONSTRAINT fk_items_bill FOREIGN KEY (bill_id) REFERENCES bills (id) ON DELETE CASCADE,
  CONSTRAINT ck_items_amounts CHECK (quantity > 0 AND unit_price >= 0 AND line_total >= 0)
) ENGINE=InnoDB;
