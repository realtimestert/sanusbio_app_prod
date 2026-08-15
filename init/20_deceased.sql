-- SanusBio Migration 20: Backfill — Unassign Deceased Ferrets From Former Rooms
-- Run AFTER 19_care_schedule.sql
-- Safe to re-run
--
-- server.js v1.10.7 makes marking a ferret deceased automatically move it to
-- the shared "N/A" (unassigned) address instead of leaving it parked in its
-- last real room. That only affects ferrets marked deceased FROM NOW ON —
-- this migration does the same cleanup for ferrets that were already marked
-- deceased before that fix, which is what was blocking deletion of empty
-- test rooms (DELETE /addresses/:id refuses if ANY ferret, dead or alive,
-- still references that address_id).

USE sanusbio;

SET FOREIGN_KEY_CHECKS=0;

-- Ensure the shared "N/A" address exists (same one new/unassigned ferrets use)
INSERT INTO address (room_id, cage_address)
SELECT 0, 'N/A'
WHERE NOT EXISTS (SELECT 1 FROM address WHERE cage_address = 'N/A');

SET @na_address_id = (SELECT address_id FROM address WHERE cage_address = 'N/A' LIMIT 1);

-- Close out any still-open location-history row for deceased ferrets
-- currently sitting in a real room (anything other than the N/A address)
UPDATE ferret_location_history flh
JOIN ferret_qr005 f ON flh.ferret_id = f.Ferret_QR005_id
SET flh.move_out = COALESCE(f.death_date, CURDATE())
WHERE f.dead = '1'
  AND flh.move_out IS NULL
  AND flh.address_id <> @na_address_id;

-- Open a new "moved to N/A" history row for each of those ferrets, so the
-- move is visible in Location History rather than just silently applied
INSERT INTO ferret_location_history (move_in, ferret_id, address_id)
SELECT COALESCE(f.death_date, CURDATE()), f.Ferret_QR005_id, @na_address_id
FROM ferret_qr005 f
WHERE f.dead = '1'
  AND f.address_id <> @na_address_id
  AND NOT EXISTS (
    SELECT 1 FROM ferret_location_history flh2
    WHERE flh2.ferret_id = f.Ferret_QR005_id
      AND flh2.address_id = @na_address_id
      AND flh2.move_out IS NULL
  );

-- Finally, unassign the deceased ferrets themselves
UPDATE ferret_qr005
SET address_id = @na_address_id
WHERE dead = '1' AND address_id <> @na_address_id;

SET FOREIGN_KEY_CHECKS=1;