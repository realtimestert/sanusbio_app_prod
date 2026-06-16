-- SanusBio Migration 05: Distributors & Distribution Events
-- Run AFTER 04_new_features.sql
-- Safe to re-run

USE sanusbio;

SET FOREIGN_KEY_CHECKS=0;

-- 1. Distributor table (like supplier but for outgoing sales)
CREATE TABLE IF NOT EXISTS `sanusbio`.`distributor` (
  `distributor_id`   INT NOT NULL AUTO_INCREMENT,
  `distributor_name` VARCHAR(150) NOT NULL,
  `contact_info`     VARCHAR(255) NULL DEFAULT NULL,
  `address`          VARCHAR(255) NULL DEFAULT NULL,
  `phone`            VARCHAR(30)  NULL DEFAULT NULL,
  `notes`            TEXT         NULL DEFAULT NULL,
  `created_at`       TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`distributor_id`),
  UNIQUE INDEX `uq_distributor_name` (`distributor_name` ASC)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 2. Seed the UGA distributor mentioned by the user
INSERT IGNORE INTO `sanusbio`.`distributor`
  (distributor_name, contact_info, address)
VALUES
  ('BIOLOGICAL SCIENCES, University of Georgia', NULL, 'Athens, GA');

-- 3. Distribution event table (one row per ferret distributed)
CREATE TABLE IF NOT EXISTS `sanusbio`.`distribution_event` (
  `distribution_id`   INT NOT NULL AUTO_INCREMENT,
  `ferret_id`         INT NOT NULL,
  `distributor_id`    INT NOT NULL,
  `distribution_date` DATE NOT NULL,
  `price`             DECIMAL(10,2) NULL DEFAULT NULL,
  `notes`             TEXT          NULL DEFAULT NULL,
  `recorded_by`       VARCHAR(100)  NULL DEFAULT NULL,
  `created_at`        TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`distribution_id`),
  INDEX `idx_ferret`      (`ferret_id`      ASC),
  INDEX `idx_distributor` (`distributor_id` ASC),
  INDEX `idx_date`        (`distribution_date` ASC),
  CONSTRAINT `fk_dist_event_ferret`
    FOREIGN KEY (`ferret_id`)
    REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`),
  CONSTRAINT `fk_dist_event_distributor`
    FOREIGN KEY (`distributor_id`)
    REFERENCES `sanusbio`.`distributor` (`distributor_id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 4. Add distributed flag + distributor_id to ferret_qr005 (safe re-run)
SET @dbname = 'sanusbio';
SET @tablename = 'ferret_qr005';

SET @col = 'distributed';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @col) > 0,
  'SELECT 1',
  'ALTER TABLE ferret_qr005 ADD COLUMN distributed TINYINT(1) NOT NULL DEFAULT 0'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @col = 'distributor_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @col) > 0,
  'SELECT 1',
  'ALTER TABLE ferret_qr005 ADD COLUMN distributor_id INT NULL DEFAULT NULL'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET FOREIGN_KEY_CHECKS=1;