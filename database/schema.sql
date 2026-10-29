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
  app_account_token CHAR(36)      NOT NULL,              -- UUID tying App Store purchases to this member
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_blessing_app_account_token (app_account_token),
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
  amount_blessed  DECIMAL(12,2)   NOT NULL DEFAULT 0.00,  -- sum of succeeded blessings
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
  CONSTRAINT ck_bills_amounts CHECK (subtotal >= 0 AND tax >= 0 AND total >= 0 AND amount_blessed >= 0)
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

-- ---------------------------------------------------------------------------
-- Blessings membership subscriptions (App Store auto-renewable subscriptions)
--   monthly  $9.99 / 1 month
--   yearly   $69.99 / 1 year
--   two_year $104.99 / 2 years
-- A member is subscribed while status = 'active' AND expires_at is in the future.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id                  BIGINT UNSIGNED NOT NULL,
  plan                     ENUM('monthly','yearly','two_year') NOT NULL,
  status                   ENUM('active','revoked') NOT NULL DEFAULT 'active',
  original_transaction_id  VARCHAR(64)     NOT NULL,     -- stays the same across renewals
  latest_transaction_id    VARCHAR(64)     NOT NULL,
  expires_at               DATETIME(3)     NOT NULL,
  environment              VARCHAR(16)     NOT NULL,     -- Production / Sandbox / Xcode
  created_at               DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at               DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscriptions_original_txn (original_transaction_id),
  KEY ix_subscriptions_user_expires (user_id, expires_at),
  CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Blessings: a Blessings member paying toward a Billable member's bill.
-- Every blessing also carries a Tip Service Fee of $1.99 per started $800.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blessings (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id                CHAR(26)        NOT NULL,
  bill_id                  BIGINT UNSIGNED NOT NULL,
  blesser_user_id          BIGINT UNSIGNED NOT NULL,
  amount                   DECIMAL(12,2)   NOT NULL,     -- goes toward the bill
  tip_service_fee          DECIMAL(12,2)   NOT NULL,     -- $1.99 per started $800 of amount
  charge_total             DECIMAL(12,2)   NOT NULL,     -- amount + tip_service_fee
  currency                 CHAR(3)         NOT NULL DEFAULT 'USD',
  status                   ENUM('pending','succeeded','failed','canceled') NOT NULL DEFAULT 'pending',
  payment_intent_id        VARCHAR(255)    NULL,         -- Stripe PaymentIntent
  created_at               DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at               DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_blessings_public_id (public_id),
  UNIQUE KEY uq_blessings_payment_intent (payment_intent_id),
  KEY ix_blessings_bill (bill_id, id),
  KEY ix_blessings_blesser (blesser_user_id, id),
  CONSTRAINT fk_blessings_bill FOREIGN KEY (bill_id) REFERENCES bills (id),
  CONSTRAINT fk_blessings_user FOREIGN KEY (blesser_user_id) REFERENCES users (id),
  CONSTRAINT ck_blessings_amounts CHECK (amount > 0 AND tip_service_fee >= 0 AND charge_total = amount + tip_service_fee)
) ENGINE=InnoDB;
