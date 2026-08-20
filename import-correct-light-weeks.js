#!/usr/bin/env node
/**
 * SanusBio — Correct CURRENT light-cycle duration from historical_data.csv
 *
 * Uses "Wks Out of Dark" / "Wks in Dark" + "8/16 Hrs Light" as the source of
 * truth for the *live* continuous period only.
 *
 * Updates per matched ferret (by AID / animal_id):
 *   • eight_hour_light  ←  "8 On" → 1,  "16 On" → 0
 *   • light_state_since ←  today − round(weeks × 7) days
 *
 * When "8/16 Hrs Light" is blank, state is inferred from Into Dark / Out Of Dark
 * (whichever date is more recent). Example: Skyla has blank 8/16 but
 * Out Of Dark = 05/04/26 → treated as 16 On with Wks Out of Dark.
 *
 * Does NOT touch:
 *   • ferret_location_history
 *   • room_light_history / room_light_schedule
 *   • address / current location (Room 15 typos left for manual fix)
 *
 * NOTE: The original animal CSV import set light_mode='manual' for everyone, so
 * this script updates manual animals by default. Use --skip-manual to exclude them.
 *
 * Usage:
 *   node import-correct-light-weeks.js --dry-run /path/to/historical_data.csv
 *   node import-correct-light-weeks.js --import  /path/to/historical_data.csv
 *   node import-correct-light-weeks.js --import --skip-manual ...
 *   node import-correct-light-weeks.js --import --as-of 2026-08-20 ...
 *
 * Safe to re-run.
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
const SKIP_MANUAL = args.includes('--skip-manual');
// --force-manual kept as alias (no-op now that manual is updated by default)
const asOfIdx = args.indexOf('--as-of');
const AS_OF = asOfIdx >= 0 ? args[asOfIdx + 1] : null;
const fileArg = args.find(a => !a.startsWith('--') && a !== AS_OF);

if (!fileArg || (!DRY && !DO_IMPORT)) {
  console.error('Usage: node import-correct-light-weeks.js [--dry-run | --import] [--skip-manual] [--as-of YYYY-MM-DD] <historical_data.csv>');
  process.exit(1);
}

const CSV_PATH = path.resolve(fileArg);
if (!fs.existsSync(CSV_PATH)) {
  console.error('CSV not found:', CSV_PATH);
  process.exit(1);
}

function aidNum(raw) {
  if (!raw) return null;
  const n = parseInt(String(raw).replace(/^AID/i, '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseWeeks(raw) {
  if (raw == null || !String(raw).trim()) return null;
  const n = parseFloat(String(raw).trim().replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseHrs(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (s.startsWith('8')) return 1;   // "8 On" → dark / 8-hour
  if (s.startsWith('16')) return 0;  // "16 On" → standard / out of dark
  return null;
}

/** Parse MM/DD/YY or MM/DD/YYYY → 'YYYY-MM-DD' or null */
function parseMDY(s) {
  if (!s || !String(s).trim()) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mo, dy, yr] = m;
  yr = parseInt(yr, 10);
  if (yr < 100) yr += 2000;
  const d = new Date(Date.UTC(yr, parseInt(mo, 10) - 1, parseInt(dy, 10)));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Infer eight_hour_light from Into Dark / Out Of Dark when 8/16 cell is blank.
 * More recent date wins. Only Into → 8h; only Out → 16h.
 */
function inferHrsFromDates(intoRaw, outRaw) {
  const into = parseMDY(intoRaw);
  const out = parseMDY(outRaw);
  if (into && out) return into >= out ? 1 : 0;
  if (into && !out) return 1;
  if (out && !into) return 0;
  return null;
}

function weeksToSince(weeks, asOfDate) {
  const days = Math.round(weeks * 7);
  const d = new Date(asOfDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const today = AS_OF || new Date().toISOString().slice(0, 10);
  console.log(`Correct light weeks from: ${CSV_PATH}`);
  console.log(`Mode: ${DRY ? 'DRY-RUN' : 'IMPORT'}${SKIP_MANUAL ? ' (skip-manual)' : ' (includes manual — default)'}`);
  console.log(`As-of date for duration math: ${today}`);

  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
  console.log(`CSV rows: ${records.length}`);

  const corrections = [];
  const skipped = { noAid: 0, noState: 0, noWeeks: 0, inferred: 0, room15: [] };

  for (const r of records) {
    const animal_id = aidNum(r['ID'] || r['Animal ID']);
    if (!animal_id) {
      skipped.noAid++;
      continue;
    }

    let eight = parseHrs(r['8/16 Hrs Light']);
    let inferred = false;
    if (eight === null) {
      eight = inferHrsFromDates(r['Into Dark'], r['Out Of Dark']);
      if (eight === null) {
        skipped.noState++;
        continue;
      }
      inferred = true;
      skipped.inferred++;
    }

    // Active-state weeks only
    const weeks = eight === 1
      ? parseWeeks(r['Wks in Dark'])
      : parseWeeks(r['Wks Out of Dark']);
    if (weeks === null) {
      skipped.noWeeks++;
      continue;
    }

    const addr = (r['Address'] || '').trim();
    if (/Room\s*15/i.test(addr) || /Room\s*15/i.test(r['Current Room-Intermediate value'] || '')) {
      skipped.room15.push({ animal_id, addr, name: (r['Animal ID'] || '').slice(0, 40) });
    }

    corrections.push({
      animal_id,
      eight_hour_light: eight,
      weeks,
      light_state_since: weeksToSince(weeks, today),
      label: eight === 1 ? '8-Hour (in dark)' : 'Standard (out of dark)',
      name: (r['Animal ID'] || '').split(/\s+by\s+/i)[0].slice(0, 40),
      inferred,
    });
  }

  console.log(`Parsed corrections: ${corrections.length} (of which ${skipped.inferred} inferred 8/16 from Into/Out dates)`);
  console.log(`Skipped: no AID=${skipped.noAid}, no state=${skipped.noState}, no weeks for active state=${skipped.noWeeks}`);
  if (skipped.room15.length) {
    console.log(`Note: ${skipped.room15.length} row(s) still list Room 15 (location left for manual fix):`);
    for (const x of skipped.room15) {
      console.log(`  AID${String(x.animal_id).padStart(5, '0')}  ${x.addr}  ${x.name}`);
    }
  }

  // Highlight Skyla / Eddie if present
  for (const c of corrections) {
    if (c.animal_id === 101 || c.animal_id === 132) {
      console.log(`  → AID${String(c.animal_id).padStart(5, '0')} ${c.name}: ${c.label}, ${c.weeks} wk → since ${c.light_state_since}${c.inferred ? ' (inferred)' : ''}`);
    }
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'sanusbio',
    password: process.env.DB_PASS || process.env.MYSQL_PWD,
    database: process.env.DB_NAME || 'sanusbio',
    waitForConnections: true,
    connectionLimit: 4,
  });

  try {
    const [existing] = await pool.query(
      `SELECT Ferret_QR005_id, animal_id, ferret_name, eight_hour_light,
              light_state_since, light_mode
       FROM ferret_qr005`
    );
    const byAid = new Map(existing.map(f => [f.animal_id, f]));
    console.log(`DB ferrets: ${byAid.size}`);

    let matched = 0, unmatched = 0, skippedManual = 0, wouldUpdate = 0, updated = 0;
    const samples = [];

    for (const c of corrections) {
      const f = byAid.get(c.animal_id);
      if (!f) {
        unmatched++;
        continue;
      }
      matched++;

      if (f.light_mode === 'manual' && SKIP_MANUAL) {
        skippedManual++;
        continue;
      }

      const prevState = f.eight_hour_light ? 1 : 0;
      const prevSince = f.light_state_since
        ? (f.light_state_since instanceof Date
            ? f.light_state_since.toISOString().slice(0, 10)
            : String(f.light_state_since).slice(0, 10))
        : null;

      const changed = prevState !== c.eight_hour_light || prevSince !== c.light_state_since;
      if (!changed) continue;

      wouldUpdate++;
      if (samples.length < 15 || c.animal_id === 101 || c.animal_id === 132) {
        samples.push({
          id: f.Ferret_QR005_id,
          aid: c.animal_id,
          name: f.ferret_name || c.name,
          from: `${prevState ? '8h' : '16h'} since ${prevSince || '—'}`,
          to: `${c.eight_hour_light ? '8h' : '16h'} since ${c.light_state_since} (${c.weeks} wk)`,
          inferred: c.inferred,
        });
      }

      if (!DRY) {
        // Keep light_mode as-is (manual animals stay manual with corrected since-date)
        await pool.query(
          `UPDATE ferret_qr005
           SET eight_hour_light = ?, light_state_since = ?
           WHERE Ferret_QR005_id = ?`,
          [c.eight_hour_light, c.light_state_since, f.Ferret_QR005_id]
        );
        updated++;
      }
    }

    console.log('\n── Results ──────────────────────────────────────────');
    console.log(`Matched AID:          ${matched}`);
    console.log(`Unmatched AID:        ${unmatched}`);
    if (SKIP_MANUAL) console.log(`Skipped (manual):     ${skippedManual}`);
    console.log(`${DRY ? 'Would update' : 'Updated'}:         ${DRY ? wouldUpdate : updated}`);
    if (samples.length) {
      console.log('\nSample changes:');
      for (const s of samples) {
        console.log(`  #${s.id} AID${String(s.aid).padStart(5, '0')} ${s.name}${s.inferred ? ' [inferred 8/16]' : ''}`);
        console.log(`      ${s.from}  →  ${s.to}`);
      }
    }
    if (DRY) {
      console.log('\nDry-run only. Re-run with --import to apply.');
    } else {
      console.log('\nDone. Live Weeks into/out of Dark boards will reflect new since-dates.');
      console.log('Location history and room light history were not modified.');
      console.log('Room 15 address typos (Skyla/Eddie) still need a manual move to 14 I Middle.');
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
