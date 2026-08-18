#!/usr/bin/env node
/**
 * SanusBio — Import Room Light Cycle History
 *
 * Reads Light_Cycle_History.csv (daily room status snapshots) and stores
 * only the transition points into room_light_history. Also refreshes the
 * live room_light_schedule table so current UI state matches the CSV.
 *
 * Usage:
 *   node import-room-light-history.js --dry-run /path/to/Light_Cycle_History.csv
 *   node import-room-light-history.js --import  /path/to/Light_Cycle_History.csv
 *
 * Safe to re-run: uses UNIQUE (room_id, change_date) upsert.
 * Skips Temp rooms.
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
  console.error('Usage: node import-room-light-history.js [--dry-run | --import] <Light_Cycle_History.csv>');
  process.exit(1);
}

const CSV_PATH = path.resolve(fileArg);
if (!fs.existsSync(CSV_PATH)) {
  console.error('CSV not found:', CSV_PATH);
  process.exit(1);
}

// Rooms we care about (skip Temp *)
const ROOM_COLS = {
  'Room 1': 1, 'Room 2': 2, 'Room 3': 3, 'Room 4': 4, 'Room 5': 5, 'Room 6': 6,
  'Room 11': 11, 'Room 12': 12, 'Room 13': 13, 'Room 14': 14,
  'Room 15': 15, 'Room 16': 16, 'Room 17': 17, 'Room 18': 18
};

function parseDate(s) {
  if (!s || !String(s).trim()) return null;
  const t = String(s).trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mo, dy, yr] = m;
  yr = parseInt(yr, 10);
  if (yr < 100) yr += 2000;
  const d = new Date(yr, parseInt(mo, 10) - 1, parseInt(dy, 10));
  if (isNaN(d.getTime())) return null;
  return `${yr}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}`;
}

function isEightHour(status) {
  if (!status) return null;
  const s = String(status).trim().toLowerCase();
  if (s === '8 on' || s === '8-on' || s === '8 hour' || s === '8-hour') return 1;
  if (s === '16 on' || s === '16-on' || s === '16 hour' || s === '16-hour') return 0;
  return null;
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });
  console.log(`Parsed ${rows.length} daily snapshot rows`);

  // Build timeline per room: list of {date, state} newest-first in file → reverse to oldest-first
  // Prefer the explicit "change date" column when present; otherwise detect transitions.
  const roomTimelines = {}; // room_id → [{change_date, eight_hour_light}]

  for (const [colName, roomId] of Object.entries(ROOM_COLS)) {
    roomTimelines[roomId] = [];
  }

  // File is newest → oldest. Walk oldest → newest to detect transitions cleanly.
  const ordered = [...rows].reverse();

  for (const row of ordered) {
    const snapDate = parseDate(row['Date'] || row['Hidden Date']);
    if (!snapDate) continue;

    for (const [colName, roomId] of Object.entries(ROOM_COLS)) {
      const status = row[colName];
      const state = isEightHour(status);
      if (state === null) continue;

      // Look for a change-date column (naming varies)
      const changeColCandidates = [
        `${colName} Change Date`,
        `${colName} change date`,
        `${colName} Change date`
      ];
      let changeDate = null;
      for (const c of changeColCandidates) {
        if (row[c]) {
          changeDate = parseDate(row[c]);
          if (changeDate) break;
        }
      }

      const timeline = roomTimelines[roomId];
      const last = timeline[timeline.length - 1];

      if (!last) {
        // First observation for this room
        timeline.push({
          change_date: changeDate || snapDate,
          eight_hour_light: state
        });
      } else if (last.eight_hour_light !== state) {
        // Transition detected
        timeline.push({
          change_date: changeDate || snapDate,
          eight_hour_light: state
        });
      }
      // else: same state continues — ignore
    }
  }

  // Flatten + dedupe by (room_id, change_date)
  const events = [];
  for (const [roomId, timeline] of Object.entries(roomTimelines)) {
    const seen = new Set();
    for (const ev of timeline) {
      const key = `${roomId}|${ev.change_date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({
        room_id: parseInt(roomId, 10),
        change_date: ev.change_date,
        eight_hour_light: ev.eight_hour_light
      });
    }
  }

  events.sort((a, b) => a.room_id - b.room_id || a.change_date.localeCompare(b.change_date));

  console.log(`\nDetected ${events.length} room light transitions:`);
  for (const e of events) {
    console.log(`  Room ${e.room_id}  ${e.change_date}  →  ${e.eight_hour_light ? '8-On (dark)' : '16-On (standard)'}`);
  }

  // Current state per room = last event
  const currentByRoom = {};
  for (const e of events) {
    currentByRoom[e.room_id] = e;
  }

  if (DRY) {
    console.log('\n[DRY RUN] No database changes.');
    console.log('Current state that would be written to room_light_schedule:');
    for (const [rid, e] of Object.entries(currentByRoom).sort((a, b) => a[0] - b[0])) {
      console.log(`  Room ${rid}: ${e.eight_hour_light ? '8-On' : '16-On'} since ${e.change_date}`);
    }
    return;
  }

  // ─── Live import ──────────────────────────────────────────────────────────
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

    // Ensure table exists (migration 24 should have been run, but be defensive)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS room_light_history (
        light_history_id INT NOT NULL AUTO_INCREMENT,
        room_id INT NOT NULL,
        change_date DATE NOT NULL,
        eight_hour_light TINYINT(1) NOT NULL,
        source VARCHAR(50) NULL DEFAULT 'import',
        imported_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (light_history_id),
        UNIQUE KEY uq_room_change_date (room_id, change_date),
        INDEX idx_room_date (room_id, change_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    let inserted = 0, updated = 0;
    for (const e of events) {
      const [result] = await conn.query(`
        INSERT INTO room_light_history (room_id, change_date, eight_hour_light, source)
        VALUES (?, ?, ?, 'import')
        ON DUPLICATE KEY UPDATE
          eight_hour_light = VALUES(eight_hour_light),
          source = 'import',
          imported_at = CURRENT_TIMESTAMP
      `, [e.room_id, e.change_date, e.eight_hour_light]);
      if (result.affectedRows === 1) inserted++;
      else if (result.affectedRows === 2) updated++;
    }

    // Refresh live current-state table
    for (const [rid, e] of Object.entries(currentByRoom)) {
      await conn.query(`
        INSERT INTO room_light_schedule (room_id, eight_hour_light, light_state_since)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          eight_hour_light = VALUES(eight_hour_light),
          light_state_since = VALUES(light_state_since)
      `, [rid, e.eight_hour_light, e.change_date]);
    }

    await conn.commit();
    console.log(`\nImport complete: ${inserted} inserted, ${updated} updated transitions`);
    console.log(`room_light_schedule refreshed for ${Object.keys(currentByRoom).length} rooms`);
  } catch (err) {
    await conn.rollback();
    console.error('Import failed:', err.message);
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
