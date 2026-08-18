#!/usr/bin/env node
/**
 * SanusBio — Import historical location moves + recompute continuous light-cycle periods
 *
 * Reads Light_change.csv and:
 *   1. Loads prior room moves into ferret_location_history
 *   2. Recomputes each ferret's eight_hour_light + light_state_since so that
 *      continuous periods across same-schedule room moves are preserved
 *
 * Usage:
 *   node import-light-location-history.js --dry-run /path/to/Light_change.csv
 *   node import-light-location-history.js --import  /path/to/Light_change.csv
 *
 * Safe to re-run. Skips Temp rooms. Prefers the animal's real current address
 * for the open location row when the room matches.
 *
 * Requires: migration 24 + import-room-light-history.js already applied.
 */

'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

let parse;
try {
  parse = require('csv-parse/sync').parse;
} catch (e) {
  console.error('Missing dependency. Run:  npm install csv-parse');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const DO_IMPORT = args.includes('--import');
const fileArg = args.find(a => !a.startsWith('--'));

if (!fileArg || (!DRY && !DO_IMPORT)) {
  console.error('Usage: node import-light-location-history.js [--dry-run | --import] <Light_change.csv>');
  process.exit(1);
}

const CSV_PATH = path.resolve(fileArg);
if (!fs.existsSync(CSV_PATH)) {
  console.error('CSV not found:', CSV_PATH);
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function aidNum(raw) {
  if (!raw) return null;
  const n = parseInt(String(raw).replace(/^AID/i, '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseMDY(s) {
  if (!s || !String(s).trim()) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mo, dy, yr] = m;
  yr = parseInt(yr, 10);
  if (yr < 100) yr += 2000;
  const d = new Date(yr, parseInt(mo, 10) - 1, parseInt(dy, 10));
  if (isNaN(d.getTime())) return null;
  return `${yr}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}`;
}

function normalizeRoom(raw) {
  if (raw == null) return null;
  // Take first line only (CSV sometimes has "Room 11\nRoom 12")
  const first = String(raw).split(/[\n\r]+/)[0].trim();
  if (!first) return null;
  const m = first.match(/^Room\s+(\d+)$/i);
  if (!m) return null; // Temp or garbage → skip
  return parseInt(m[1], 10);
}

function daysBetween(a, b) {
  // a, b as YYYY-MM-DD strings
  const da = new Date(a + 'T12:00:00Z');
  const db = new Date(b + 'T12:00:00Z');
  return Math.round((db - da) / 864e5);
}

// ─── Parse CSV into per-animal move lists ─────────────────────────────────────

function parseLightChange(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });
  console.log(`Parsed ${rows.length} rows from Light_change.csv`);

  // Dedupe by Animal ID — keep last occurrence
  const byAid = new Map();
  for (const row of rows) {
    const aid = aidNum(row['Animal ID']);
    if (!aid) continue;
    byAid.set(aid, row);
  }
  console.log(`Unique AIDs: ${byAid.size}`);

  const animals = [];
  for (const [aid, row] of byAid) {
    const moves = []; // {move_in, room_id} oldest → newest after sort
    for (let i = 0; i <= 25; i++) {
      const mc = i === 0 ? 'Move 0' : `Move -${i}`;
      const ac = i === 0 ? 'New Address 0' : `New -${i} Address`;
      const d = parseMDY(row[mc]);
      const roomId = normalizeRoom(row[ac]);
      if (d && roomId) {
        moves.push({ move_in: d, room_id: roomId });
      }
    }
    // Sort oldest first, then de-dupe consecutive same-date/same-room
    moves.sort((a, b) => a.move_in.localeCompare(b.move_in));
    const deduped = [];
    for (const m of moves) {
      const last = deduped[deduped.length - 1];
      if (last && last.move_in === m.move_in && last.room_id === m.room_id) continue;
      // If same date but different room, keep the later-listed (more recent in CSV index)
      if (last && last.move_in === m.move_in) {
        deduped[deduped.length - 1] = m;
        continue;
      }
      deduped.push(m);
    }
    animals.push({
      animal_id: aid,
      full_id: row['Full ID'] || '',
      moves: deduped
    });
  }
  return animals;
}

// ─── Continuous light-period recompute ────────────────────────────────────────

/**
 * Given ordered location stays [{move_in, move_out|null, room_id}, ...] (oldest first)
 * and roomTransitions Map room_id → [{change_date, eight_hour_light}, ...] sorted asc,
 * return { eight_hour_light, light_state_since } for the continuous trailing period.
 */
function computeContinuousPeriod(stays, roomTransitions, today) {
  if (!stays || !stays.length) return null;

  // Build segmented (start, end, state) periods for the animal
  const segments = []; // {start, end, state}

  for (const stay of stays) {
    const start = stay.move_in;
    const end = stay.move_out || today;
    const rid = stay.room_id;
    const hist = roomTransitions.get(rid) || [];

    // State of room on a given date = latest transition ≤ date.
    // If no transition exists yet, fall back to the earliest known state for
    // this room (we don't have pre-history; assume that state applied earlier).
    function stateOn(dateStr) {
      let state = null;
      for (const t of hist) {
        if (t.change_date <= dateStr) state = t.eight_hour_light;
        else break;
      }
      if (state === null && hist.length) state = hist[0].eight_hour_light;
      return state;
    }

    // Transitions that fall strictly inside (start, end]
    const flips = hist.filter(t => t.change_date > start && t.change_date <= end);

    let cursor = start;
    for (const flip of flips) {
      const st = stateOn(cursor);
      if (st !== null) {
        segments.push({ start: cursor, end: flip.change_date, state: st });
      }
      cursor = flip.change_date;
    }
    const st = stateOn(cursor);
    if (st !== null) {
      segments.push({ start: cursor, end, state: st });
    }
  }

  if (!segments.length) return null;

  // Walk backwards from the end to find continuous same-state stretch
  const currentState = segments[segments.length - 1].state;
  let since = segments[segments.length - 1].start;
  for (let i = segments.length - 2; i >= 0; i--) {
    const s = segments[i];
    if (s.state === currentState && s.end === since) {
      since = s.start;
    } else {
      break;
    }
  }

  return { eight_hour_light: currentState, light_state_since: since };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const animals = parseLightChange(CSV_PATH);
  const withMoves = animals.filter(a => a.moves.length > 0);
  console.log(`Animals with ≥1 parseable room moves: ${withMoves.length}`);
  console.log(`Animals with 0 moves: ${animals.length - withMoves.length}`);

  // Move count histogram
  const counts = {};
  for (const a of withMoves) {
    const n = a.moves.length;
    counts[n] = (counts[n] || 0) + 1;
  }
  console.log('Moves per animal:', Object.entries(counts).sort((a,b)=>a[0]-b[0]).map(([k,v])=>`${k}:${v}`).join(' '));

  if (DRY) {
    // Show a few samples
    console.log('\n[DRY RUN] Sample animals:');
    for (const a of withMoves.slice(0, 3)) {
      console.log(`  AID${String(a.animal_id).padStart(5,'0')} ${a.full_id.slice(0,40)}`);
      for (const m of a.moves) {
        console.log(`    ${m.move_in}  Room ${m.room_id}`);
      }
    }
    console.log('\n[DRY RUN] No database changes.');
    return;
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sanusbio',
    waitForConnections: true,
    connectionLimit: 5
  });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ── Load animal_id → ferret mapping ──────────────────────────────────────
    const [ferrets] = await conn.query(`
      SELECT Ferret_QR005_id, animal_id, address_id, light_mode,
             eight_hour_light, light_state_since, birth_date
      FROM ferret_qr005
    `);
    const byAnimalId = new Map();
    for (const f of ferrets) byAnimalId.set(f.animal_id, f);
    console.log(`\nFerrets in DB: ${ferrets.length}`);

    // ── Load room light transitions ──────────────────────────────────────────
    const [transitions] = await conn.query(`
      SELECT room_id, change_date, eight_hour_light
      FROM room_light_history
      ORDER BY room_id, change_date ASC
    `);
    const roomTransitions = new Map();
    for (const t of transitions) {
      const d = t.change_date instanceof Date
        ? t.change_date.toISOString().slice(0, 10)
        : String(t.change_date).slice(0, 10);
      if (!roomTransitions.has(t.room_id)) roomTransitions.set(t.room_id, []);
      roomTransitions.get(t.room_id).push({
        change_date: d,
        eight_hour_light: t.eight_hour_light ? 1 : 0
      });
    }
    console.log(`Room light transitions loaded: ${transitions.length}`);

    // Fallback: rooms that have a live schedule but no history entries get a
    // synthetic "since epoch" transition so stateOn() never returns null.
    const [schedules] = await conn.query(`
      SELECT room_id, eight_hour_light, light_state_since FROM room_light_schedule
    `);
    for (const s of schedules) {
      if (!roomTransitions.has(s.room_id) || roomTransitions.get(s.room_id).length === 0) {
        const d = s.light_state_since
          ? (s.light_state_since instanceof Date
              ? s.light_state_since.toISOString().slice(0, 10)
              : String(s.light_state_since).slice(0, 10))
          : '2000-01-01';
        roomTransitions.set(s.room_id, [{
          change_date: d,
          eight_hour_light: s.eight_hour_light ? 1 : 0
        }]);
      }
    }

    // ── HIST address cache ───────────────────────────────────────────────────
    const histAddrCache = new Map(); // room_id → address_id
    // Pre-load any existing HIST addresses
    const [existingHist] = await conn.query(
      `SELECT address_id, room_id FROM address WHERE cage_address = 'HIST'`
    );
    for (const a of existingHist) histAddrCache.set(a.room_id, a.address_id);

    // Pre-create HIST addresses for every room that appears in the import
    const neededRooms = new Set();
    for (const a of withMoves) {
      for (const m of a.moves) neededRooms.add(m.room_id);
    }
    for (const roomId of neededRooms) {
      if (histAddrCache.has(roomId)) continue;
      const [ins] = await conn.query(
        `INSERT INTO address (room_id, cage_address, room_name) VALUES (?, 'HIST', ?)`,
        [roomId, `Room ${roomId}`]
      );
      histAddrCache.set(roomId, ins.insertId);
    }
    console.log(`HIST addresses ready for ${histAddrCache.size} rooms`);

    function getOrCreateHistAddress(roomId) {
      // All needed rooms were pre-created above
      return histAddrCache.get(roomId);
    }

    // ── Current address room lookup ──────────────────────────────────────────
    const [allAddrs] = await conn.query(`SELECT address_id, room_id, cage_address FROM address`);
    const addrById = new Map(allAddrs.map(a => [a.address_id, a]));

    // ── Process each animal ──────────────────────────────────────────────────
    let matched = 0, unmatched = 0, locInserted = 0, recomputed = 0, skippedManual = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const a of withMoves) {
      const ferret = byAnimalId.get(a.animal_id);
      if (!ferret) {
        unmatched++;
        continue;
      }
      matched++;
      const fid = ferret.Ferret_QR005_id;

      // Build stays with move_out
      const stays = a.moves.map((m, i) => ({
        move_in: m.move_in,
        move_out: i < a.moves.length - 1 ? a.moves[i + 1].move_in : null,
        room_id: m.room_id
      }));

      // Resolve address_ids for each stay
      const stayAddrs = [];
      for (let i = 0; i < stays.length; i++) {
        const stay = stays[i];
        let addressId;
        // For the open (last) stay, prefer the ferret's real current address if room matches
        if (i === stays.length - 1 && ferret.address_id) {
          const cur = addrById.get(ferret.address_id);
          if (cur && cur.room_id === stay.room_id && cur.cage_address !== 'HIST') {
            addressId = ferret.address_id;
          }
        }
        if (!addressId) {
          addressId = await getOrCreateHistAddress(stay.room_id);
        }
        stayAddrs.push({ ...stay, address_id: addressId });
      }

      // Full replace of location history for this ferret from the CSV.
      // During migration the CSV is the source of truth; app-generated rows
      // are only days old. Wiping avoids uq_active_location conflicts.
      // Close open row first so the unique key is free, then delete all rows.
      const latestCsvMove = stays[stays.length - 1].move_in;
      await conn.query(
        `UPDATE ferret_location_history SET move_out = COALESCE(move_out, ?)
         WHERE ferret_id = ? AND move_out IS NULL`,
        [latestCsvMove, fid]
      );
      await conn.query(
        `DELETE FROM ferret_location_history WHERE ferret_id = ?`,
        [fid]
      );

      // Insert the reconstructed chain (last stay has move_out = null → open)
      for (const s of stayAddrs) {
        await conn.query(
          `INSERT INTO ferret_location_history (move_in, move_out, ferret_id, address_id)
           VALUES (?, ?, ?, ?)`,
          [s.move_in, s.move_out, fid, s.address_id]
        );
        locInserted++;
      }

      // Always recompute from reconstructed history during this migration import.
      // (Manual mode is for staff overrides going forward; seeding overwrites.)
      const result = computeContinuousPeriod(stayAddrs, roomTransitions, today);
      if (result) {
        await conn.query(
          `UPDATE ferret_qr005
           SET eight_hour_light = ?, light_state_since = ?,
               light_mode = CASE WHEN light_mode = 'manual' THEN 'manual' ELSE 'auto' END
           WHERE Ferret_QR005_id = ?`,
          [result.eight_hour_light, result.light_state_since, fid]
        );
        recomputed++;
      } else {
        skippedManual++; // reused counter: animals with insufficient history to recompute
      }
    }

    await conn.commit();
    console.log(`\nImport complete:`);
    console.log(`  Matched AIDs:     ${matched}`);
    console.log(`  Unmatched AIDs:   ${unmatched}`);
    console.log(`  Location rows:    ${locInserted}`);
    console.log(`  Recomputed:       ${recomputed}`);
    console.log(`  No period data:   ${skippedManual}`);
    console.log(`  HIST addresses:   ${histAddrCache.size}`);
  } catch (err) {
    await conn.rollback();
    console.error('Import failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
