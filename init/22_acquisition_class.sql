-- SanusBio migration 22 | 2026-08-17
-- Add acquisition_class (Littered / Sourced / both)
-- Replaces reliance on free-text acquisition_by for structured filtering.
-- Safe to re-run.

USE sanusbio;

SET @dbname = 'sanusbio';
SET @tablename = 'ferret_qr005';
SET @columnname = 'acquisition_class';

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  "ALTER TABLE ferret_qr005
     ADD COLUMN acquisition_class SET('Littered','Sourced') NULL DEFAULT NULL
     COMMENT 'One or both: Littered, Sourced'
     AFTER acquisition_by"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Ensure a placeholder supplier exists for animals with no supplier (NA)
INSERT INTO supplier (supplier_name, contact_info)
SELECT 'NA', 'Placeholder for animals with no supplier in legacy data'
WHERE NOT EXISTS (SELECT 1 FROM supplier WHERE supplier_name = 'NA');