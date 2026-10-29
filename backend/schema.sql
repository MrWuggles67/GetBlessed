CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  name VARCHAR(120) NOT NULL,
  role ENUM('billable','blessings','admin') NOT NULL DEFAULT 'billable',
  annual_income DECIMAL(14,2) NULL,
  status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_role (role),
  INDEX idx_users_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bills (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  merchant VARCHAR(160) NULL,
  image_path VARCHAR(255) NOT NULL,
  total DECIMAL(12,2) NOT NULL,
  status ENUM('pending','approved','rejected','blessed') NOT NULL DEFAULT 'pending',
  admin_note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_bills_user (user_id, created_at),
  INDEX idx_bills_status (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bill_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bill_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  price DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  INDEX idx_items_bill (bill_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blessings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bill_id BIGINT UNSIGNED NOT NULL,
  blesser_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  message VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  FOREIGN KEY (blesser_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_bless_bill (bill_id),
  INDEX idx_bless_blesser (blesser_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(60) PRIMARY KEY,
  `value` VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO settings (`key`, `value`) VALUES
  ('signups_enabled', 'true'),
  ('uploads_enabled', 'true'),
  ('require_bill_approval', 'false'),
  ('max_bill_total', '100000'),
  ('min_blessing_income', '0'),
  ('site_name', 'GetBlessed');
