-- SanusBio Migration 25: Inspect / clean non-physical rooms (e.g. Room 15)
-- Run AFTER 24_room_light_history.sql
-- Safe to re-run (report queries are read-only; destructive steps are commented)
--
-- Background: the Light_Cycle_History / Light_change CSV imports treated
-- "Room 15" as a real room and created HIST addresses + room_light_history
-- rows. If Room 15 does not physically exist, those rows confuse location
-- history and continuous light-period reconstruction.
--
-- This script:
--   1. Reports how much Room 15 (and any other HIST-only room) data exists
--   2. Optionally removes Room 15 from the *live* room_light_schedule cache
--      so the move handler treats it as unknown going forward
--   3. Does NOT auto-remap location history — that decision is per-animal
--      (some ferrets may need Room 15 → 14, others a different correction)
--
-- Usage (usual pattern):
--   podman exec -e MYSQL_PWD="$(cat ~/.sanusbio-db-pass)" -i sanusbio-db \
--     mysql -u sanusbio sanusbio < init/25_cleanup_nonphysical_rooms.sql

USE sanusbio;

-- ─── 1. Report: rooms that only have HIST addresses (no physical cages) ──────
SELECT a.room_id,
       COUNT(*) AS address_rows,
       SUM(CASE WHEN a.cage_address = 'HIST' THEN 1 ELSE 0 END) AS hist_rows,
       SUM(CASE WHEN a.cage_address IS NULL OR a.cage_address != 'HIST' THEN 1 ELSE 0 END) AS physical_rows
FROM address a
WHERE a.room_id > 0
GROUP BY a.room_id
HAVING physical_rows = 0
ORDER BY a.room_id;

-- ─── 2. Report: ferrets whose *current* address is a HIST-only room ───────────
SELECT f.Ferret_QR005_id, f.ferret_name, f.animal_id,
       a.address_id, a.room_id, a.cage_address,
       f.eight_hour_light, f.light_state_since, f.light_mode
FROM ferret_qr005 f
JOIN address a ON f.address_id = a.address_id
WHERE a.room_id > 0
  AND a.cage_address = 'HIST'
  AND NOT EXISTS (
    SELECT 1 FROM address a2
    WHERE a2.room_id = a.room_id
      AND (a2.cage_address IS NULL OR a2.cage_address != 'HIST')
  )
ORDER BY a.room_id, f.ferret_name;

-- ─── 3. Report: location_history stays in HIST-only rooms ─────────────────────
SELECT a.room_id,
       COUNT(*) AS stay_count,
       COUNT(DISTINCT flh.ferret_id) AS ferret_count,
       MIN(flh.move_in) AS earliest_move_in,
       MAX(COALESCE(flh.move_out, flh.move_in)) AS latest_move
FROM ferret_location_history flh
JOIN address a ON flh.address_id = a.address_id
WHERE a.room_id > 0
  AND a.cage_address = 'HIST'
  AND NOT EXISTS (
    SELECT 1 FROM address a2
    WHERE a2.room_id = a.room_id
      AND (a2.cage_address IS NULL OR a2.cage_address != 'HIST')
  )
GROUP BY a.room_id
ORDER BY a.room_id;

-- ─── 4. Report: room_light_history / schedule for Room 15 specifically ────────
SELECT 'room_light_history' AS src, room_id, change_date, eight_hour_light, source
FROM room_light_history WHERE room_id = 15
UNION ALL
SELECT 'room_light_schedule', room_id, light_state_since, eight_hour_light, NULL
FROM room_light_schedule WHERE room_id = 15
ORDER BY src, change_date;

-- ─── 5. OPTIONAL cleanup (uncomment when ready) ───────────────────────────────
-- Remove Room 15 from the *live* schedule cache so moves out of it are treated
-- as leaving an unknown room (forces adopt of destination cycle).
-- Historical room_light_history rows are left in place for audit; the app's
-- light-history endpoint already ignores schedule data for HIST-only rooms.
--
DELETE FROM room_light_schedule WHERE room_id = 15;
--
-- If you decide Room 15 data should never have existed at all:
DELETE FROM room_light_history WHERE room_id = 15;
--
-- Remapping a specific ferret's current location is done in the UI (Move).
-- Remapping *historical* stays (Room 15 → Room 14) must be done carefully per
-- animal, e.g.:
--
-- UPDATE ferret_location_history flh
-- JOIN address a_old ON flh.address_id = a_old.address_id
-- JOIN address a_new ON a_new.room_id = 14 AND a_new.cage_address = 'HIST'
-- SET flh.address_id = a_new.address_id
-- WHERE a_old.room_id = 15
--   AND flh.ferret_id = <Ferret_QR005_id>;
