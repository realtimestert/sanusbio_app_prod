-- SanusBio migration 23 | 2026-08-18
-- 1) Mark imported litters as having kits already created (individuals_created)
-- 2) Recompute female_status from latest reproductive_event for every female
-- 3) Clear stale "mated" status: if latest event is mated and >70 days ago
--    with no subsequent littered/weaned, insert no_litter so she returns to baseline
--    and drops off the Reproductive Status Board.
-- Safe to re-run (no_litter insert is guarded).

USE sanusbio;

-- ── 1. Litters: kits already exist in ferret_qr005 ───────────────────────────
UPDATE litter_log ll
SET individuals_created = (
  SELECT COUNT(*)
  FROM ferret_qr005 f
  WHERE f.litter_id IS NOT NULL
    AND f.litter_id <> ''
    AND f.litter_id = ll.litter_id
)
WHERE ll.litter_id IS NOT NULL AND ll.litter_id <> '';

-- Also align surviving_litter_count when it was seeded as kit_count
UPDATE litter_log ll
SET surviving_litter_count = COALESCE(
  (SELECT COUNT(*) FROM ferret_qr005 f
   WHERE f.litter_id = ll.litter_id AND f.litter_id IS NOT NULL AND f.litter_id <> ''),
  surviving_litter_count
)
WHERE ll.litter_id IS NOT NULL AND ll.litter_id <> '';

-- ── 2. Stale mated → no_litter (board cleanup) ───────────────────────────────
-- For each live, non-retired female whose *latest* event is 'mated' and that
-- event is more than 70 days old, insert a no_litter event so status → baseline.
INSERT INTO reproductive_event (ferret_id, event_type, event_date, notes, recorded_by)
SELECT f.Ferret_QR005_id,
       'no_litter',
       DATE_ADD(re.event_date, INTERVAL 70 DAY),
       CONCAT('Auto-cleared: mated ', re.event_date, ' with no litter recorded (migration 23)'),
       'migration-23'
FROM ferret_qr005 f
JOIN reproductive_event re ON re.event_id = (
  SELECT r2.event_id FROM reproductive_event r2
  WHERE r2.ferret_id = f.Ferret_QR005_id
  ORDER BY r2.event_date DESC, r2.event_id DESC
  LIMIT 1
)
WHERE f.sex = 'female'
  AND (f.dead = '0' OR f.dead IS NULL)
  AND (f.breeding_retired = 0 OR f.breeding_retired IS NULL)
  AND re.event_type = 'mated'
  AND re.event_date < DATE_SUB(CURDATE(), INTERVAL 70 DAY)
  AND NOT EXISTS (
    SELECT 1 FROM reproductive_event x
    WHERE x.ferret_id = f.Ferret_QR005_id
      AND x.event_type = 'no_litter'
      AND x.event_date >= re.event_date
      AND x.notes LIKE 'Auto-cleared:%'
  );

-- ── 3. Recompute female_status from latest event ─────────────────────────────
-- Maps: no_litter/weaned → NULL (baseline), else event_type
UPDATE ferret_qr005 f
LEFT JOIN reproductive_event re ON re.event_id = (
  SELECT r2.event_id FROM reproductive_event r2
  WHERE r2.ferret_id = f.Ferret_QR005_id
  ORDER BY r2.event_date DESC, r2.event_id DESC
  LIMIT 1
)
SET f.female_status = CASE
  WHEN re.event_id IS NULL THEN NULL
  WHEN re.event_type IN ('no_litter', 'weaned') THEN NULL
  ELSE re.event_type
END
WHERE f.sex = 'female';
