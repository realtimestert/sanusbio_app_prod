#!/usr/bin/env node
/**
 * SanusBio Mating History + Estrus Import
 * From Smartsheet "Estrus & Mating Summary" export.
 *
 * - Parses Mating History into individual mated reproductive_event rows
 * - Parses Unconfirmed Estrus into estrus reproductive_event rows
 * - Sets mating_restriction when present
 * - Recomputes female_status from latest reproductive_event
 *
 * Match key: RFID via rfid_assignment (prefer unassigned_date IS NULL),
 * fallback to ferret_name containing the RFID digits.
 *
 * Idempotent: skips existing (ferret_id, event_type, event_date, partner_id)
 * pairs. Does not delete prior events.
 *
 * Usage (inside sanusbio-app container):
 *   node import-mating-history.js --dry-run /app/Estrus_Mating_Summary.csv
 *   node import-mating-history.js --import  /app/Estrus_Mating_Summary.csv
 *
 * Copy the CSV into the container first, e.g.:
 *   podman cp "Estrus & Mating Summary.csv" sanusbio-app:/app/Estrus_Mating_Summary.csv
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
  console.error('Missing csv-parse. Run: npm install csv-parse');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const DO_IMPORT = args.includes('--import');
const fileArg = args.find(a => !a.startsWith('--'));

if (!fileArg || (!DRY && !DO_IMPORT)) {
  console.error('Usage: node import-mating-history.js [--dry-run] [--import] <csv-file>');
  process.exit(1);
}

const CSV_PATH = path.resolve(fileArg);
if (!fs.existsSync(CSV_PATH)) {
  console.error('CSV not found:', CSV_PATH);
  process.exit(1);
}

function parseDate(s) {
  if (!s || !String(s).trim()) return null;
  const t = String(s).trim();
  if (/^#/i.test(t) || /invalid/i.test(t)) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mo, d, y] = m;
  y = y.length === 2 ? '20' + y : y;
  const iso = `${y.padStart(4, '0')}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  if (isNaN(new Date(iso + 'T12:00:00Z').getTime())) return null;
  return iso;
}

function extractRfid(s) {
  if (!s) return null;
  // Prefer trailing RFID (optionally followed by a short cage/litter code like BL02)
  const m = String(s).trim().match(/(\d{12,15})(?:\s+[A-Za-z0-9._-]{1,8})?\s*$/);
  if (m) return m[1];
  // Fallback: last 12–15 digit run anywhere in the string
  const all = [...String(s).matchAll(/(\d{12,15})/g)];
  return all.length ? all[all.length - 1][1] : null;
}

/**
 * Split Mating History text into discrete events.
 * Format (Smartsheet):
 *   08/08/26
 *   Female Name … RFID +
 *   Male Name … RFID
 * Multiple events separated by ';'
 */
function parseMatingHistory(text) {
  if (!text || !String(text).trim() || /^#/.test(String(text).trim())) return [];
  const parts = String(text).split(/\s*;\s*/);
  const events = [];
  for (const part of parts) {
    const chunk = part.trim();
    if (!chunk) continue;
    const lines = chunk.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    let date = null;
    const body = [];
    for (const ln of lines) {
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(ln)) date = ln;
      else body.push(ln);
    }
    const blob = body.join(' ').replace(/\s+/g, ' ').trim();
    if (!blob && !date) continue;

    let femaleSide = blob;
    let maleSide = null;
    const plus = blob.indexOf('+');
    if (plus >= 0) {
      femaleSide = blob.slice(0, plus).trim();
      maleSide = blob.slice(plus + 1).trim();
    }

    events.push({
      date: parseDate(date),
      dateRaw: date,
      female_rfid: extractRfid(femaleSide),
      male_rfid: extractRfid(maleSide),
      female_text: femaleSide || null,
      male_text: maleSide || null,
      notes: chunk.slice(0, 65000),
    });
  }
  return events;
}

function deriveStatus(events) {
  // events sorted DESC by date then id
  if (!events.length) return null; // baseline → NULL in DB
  const last = events[0];
  if (last.event_type === 'no_litter' || last.event_type === 'weaned') return null;
  return last.event_type; // estrus | mated | littered
}

async function main() {
  console.log('Reading CSV…', CSV_PATH);
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
  });
  console.log(`Parsed ${records.length} female rows`);

  // Transform rows
  const females = [];
  for (const r of records) {
    const idText = (r['ID'] || r['Primary'] || '').trim();
    if (!idText) continue;
    const rfid = extractRfid(idText);
    const restriction = (r['Mating Restriction'] || '').trim();
    const unconfirmed = parseDate(r['Unconfirmed Estrus']);
    const confirmed = parseDate(r['Confirmed Estrus Start']);
    const lastMate = parseDate(r['Last Mating date']);
    const history = parseMatingHistory(r['Mating History'] || '');

    females.push({
      idText,
      rfid,
      restriction: restriction && !/^#/.test(restriction) ? restriction : null,
      unconfirmed_estrus: unconfirmed,
      confirmed_estrus: confirmed,
      last_mate: lastMate,
      history,
    });
  }

  const totalMated = females.reduce((n, f) => n + f.history.length, 0);
  const withEstrus = females.filter(f => f.unconfirmed_estrus || f.confirmed_estrus).length;
  console.log(`Mating history events: ${totalMated}`);
  console.log(`Rows with estrus date:  ${withEstrus}`);
  console.log(`Rows with restriction:  ${females.filter(f => f.restriction).length}`);

  if (DRY) {
    console.log('\n── Dry-run sample (first 8 mated events) ──');
    let shown = 0;
    for (const f of females) {
      for (const e of f.history) {
        if (shown >= 8) break;
        console.log(
          `  ${e.date || '?'}  ♀ ${e.female_rfid || f.rfid || '?'}  +  ♂ ${e.male_rfid || (e.male_text || '—').slice(0, 40)}`
        );
        shown++;
      }
      if (shown >= 8) break;
    }
    console.log('\nDry-run only — no DB changes. Re-run with --import to apply.');
    return;
  }

  // Credentials: match server.js / other import scripts. Compose injects DB_* via env_file.
  // Fallback to MYSQL_PWD for one-off: podman exec -e MYSQL_PWD=... 
  const dbHost = process.env.DB_HOST || 'db';
  const dbUser = process.env.DB_USER || 'sanusbio';
  const dbPass = process.env.DB_PASS || process.env.MYSQL_PWD || process.env.MYSQL_PASSWORD || '';
  const dbName = process.env.DB_NAME || 'sanusbio';
  if (!dbPass) {
    console.error('No DB password found in environment.');
    console.error('  Expected DB_PASS (from compose .env) or MYSQL_PWD / MYSQL_PASSWORD.');
    console.error('  Retry with:');
    console.error('    podman exec -e MYSQL_PWD="YOUR_PASSWORD" -it sanusbio-app \\');
    console.error('      node import-mating-history.js --import /app/Estrus_Mating_Summary.csv');
    console.error('  Or, if password is in ~/.sanusbio-db-pass:');
    console.error('    podman exec -e MYSQL_PWD="$(cat ~/.sanusbio-db-pass)" -it sanusbio-app \\');
    console.error('      node import-mating-history.js --import /app/Estrus_Mating_Summary.csv');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: dbHost,
    user: dbUser,
    password: dbPass,
    database: dbName,
    waitForConnections: true,
    connectionLimit: 5,
  });

  const conn = await pool.getConnection();
  try {
    // Build RFID → ferret_id map (prefer currently assigned / unassigned_date IS NULL)
    const [rfidRows] = await conn.query(`
      SELECT r.rfid, r.ferret_id, r.unassigned_date, f.ferret_name, f.sex, f.animal_id, f.dead, f.distributed
      FROM rfid_assignment r
      JOIN ferret_qr005 f ON f.Ferret_QR005_id = r.ferret_id
      ORDER BY r.rfid, (r.unassigned_date IS NULL) DESC, r.rfid_assignment_id DESC
    `);
    const byRfid = new Map();
    for (const row of rfidRows) {
      if (!byRfid.has(row.rfid)) byRfid.set(String(row.rfid), row);
    }

    // Fallback: name contains RFID digits
    const [allFerrets] = await conn.query(
      'SELECT Ferret_QR005_id, ferret_name, sex, animal_id, dead, distributed FROM ferret_qr005'
    );
    const byNameRfid = new Map();
    for (const f of allFerrets) {
      const digits = extractRfid(f.ferret_name);
      if (digits && !byNameRfid.has(digits)) byNameRfid.set(digits, f);
    }

    function resolve(rfid) {
      if (!rfid) return null;
      const key = String(rfid);
      if (byRfid.has(key)) return byRfid.get(key);
      if (byNameRfid.has(key)) return byNameRfid.get(key);
      return null;
    }

    let matedInserted = 0;
    let matedSkipped = 0;
    let estrusInserted = 0;
    let estrusSkipped = 0;
    let restrictionUpdated = 0;
    let femalesMissing = 0;
    let malesMissing = 0;
    const touchedFemaleIds = new Set();
    const warnings = [];

    await conn.beginTransaction();

    for (const f of females) {
      const female = resolve(f.rfid);
      if (!female) {
        femalesMissing++;
        warnings.push(`Female not found for RFID/ID: ${f.idText.slice(0, 70)}`);
        continue;
      }
      const femaleId = female.Ferret_QR005_id || female.ferret_id;
      touchedFemaleIds.add(femaleId);

      // Mating restriction
      if (f.restriction) {
        await conn.query(
          'UPDATE ferret_qr005 SET mating_restriction = ? WHERE Ferret_QR005_id = ?',
          [f.restriction, femaleId]
        );
        restrictionUpdated++;
      }

      // Estrus events (prefer confirmed, else unconfirmed)
      const estrusDate = f.confirmed_estrus || f.unconfirmed_estrus;
      if (estrusDate) {
        const [exists] = await conn.query(
          `SELECT event_id FROM reproductive_event
            WHERE ferret_id = ? AND event_type = 'estrus' AND event_date = ? LIMIT 1`,
          [femaleId, estrusDate]
        );
        if (exists.length) {
          estrusSkipped++;
        } else {
          const note = f.confirmed_estrus
            ? 'Imported confirmed estrus (Smartsheet Estrus & Mating Summary)'
            : 'Imported unconfirmed estrus (Smartsheet Estrus & Mating Summary)';
          await conn.query(
            `INSERT INTO reproductive_event (ferret_id, event_type, event_date, notes, recorded_by)
             VALUES (?,'estrus',?,?,'csv-mating-history')`,
            [femaleId, estrusDate, note]
          );
          estrusInserted++;
        }
      }

      // Mated events from Mating History
      for (const e of f.history) {
        if (!e.date) {
          warnings.push(`No date for mating on ${f.idText.slice(0, 40)}: ${e.notes.slice(0, 60)}`);
          continue;
        }
        let partnerId = null;
        if (e.male_rfid) {
          const male = resolve(e.male_rfid);
          if (male) {
            partnerId = male.Ferret_QR005_id || male.ferret_id;
          } else {
            malesMissing++;
            warnings.push(`Male RFID ${e.male_rfid} not found (♀ ${f.rfid}, ${e.date})`);
          }
        }

        // Idempotency: same female + mated + date + partner (NULL-safe)
        const [exists] = await conn.query(
          `SELECT event_id FROM reproductive_event
            WHERE ferret_id = ? AND event_type = 'mated' AND event_date = ?
              AND ((partner_id IS NULL AND ? IS NULL) OR partner_id = ?)
            LIMIT 1`,
          [femaleId, e.date, partnerId, partnerId]
        );
        if (exists.length) {
          matedSkipped++;
          continue;
        }

        await conn.query(
          `INSERT INTO reproductive_event
             (ferret_id, event_type, event_date, partner_id, notes, recorded_by)
           VALUES (?,'mated',?,?,?,'csv-mating-history')`,
          [femaleId, e.date, partnerId, e.notes]
        );
        matedInserted++;
      }
    }

    // Recompute female_status for every touched female
    console.log(`Recomputing female_status for ${touchedFemaleIds.size} females…`);
    let statusUpdated = 0;
    for (const fid of touchedFemaleIds) {
      const [events] = await conn.query(
        `SELECT event_type FROM reproductive_event
          WHERE ferret_id = ?
          ORDER BY event_date DESC, event_id DESC`,
        [fid]
      );
      const status = deriveStatus(events);
      await conn.query(
        'UPDATE ferret_qr005 SET female_status = ? WHERE Ferret_QR005_id = ?',
        [status, fid]
      );
      statusUpdated++;
    }

    // Auto no_litter for stale mated >70d (same rule as migration 23)
    const [[{ n: autoNoLitter }]] = await conn.query(`
      SELECT COUNT(*) AS n FROM (
        SELECT f.Ferret_QR005_id
        FROM ferret_qr005 f
        JOIN reproductive_event re ON re.event_id = (
          SELECT r2.event_id FROM reproductive_event r2
          WHERE r2.ferret_id = f.Ferret_QR005_id
          ORDER BY r2.event_date DESC, r2.event_id DESC LIMIT 1
        )
        WHERE f.sex = 'female'
          AND (f.dead = '0' OR f.dead IS NULL)
          AND (f.distributed = 0 OR f.distributed IS NULL)
          AND re.event_type = 'mated'
          AND re.event_date < DATE_SUB(CURDATE(), INTERVAL 70 DAY)
      ) t
    `);
    if (autoNoLitter > 0) {
      await conn.query(`
        INSERT INTO reproductive_event (ferret_id, event_type, event_date, notes, recorded_by)
        SELECT f.Ferret_QR005_id, 'no_litter', CURDATE(),
               'Auto no_litter: mated >70 days with no subsequent litter (import-mating-history)',
               'csv-mating-history'
        FROM ferret_qr005 f
        JOIN reproductive_event re ON re.event_id = (
          SELECT r2.event_id FROM reproductive_event r2
          WHERE r2.ferret_id = f.Ferret_QR005_id
          ORDER BY r2.event_date DESC, r2.event_id DESC LIMIT 1
        )
        WHERE f.sex = 'female'
          AND (f.dead = '0' OR f.dead IS NULL)
          AND (f.distributed = 0 OR f.distributed IS NULL)
          AND re.event_type = 'mated'
          AND re.event_date < DATE_SUB(CURDATE(), INTERVAL 70 DAY)
      `);
      // Recompute those again
      const [stale] = await conn.query(`
        SELECT DISTINCT ferret_id FROM reproductive_event
        WHERE recorded_by = 'csv-mating-history' AND event_type = 'no_litter'
          AND event_date = CURDATE()
      `);
      for (const row of stale) {
        const [events] = await conn.query(
          `SELECT event_type FROM reproductive_event
            WHERE ferret_id = ?
            ORDER BY event_date DESC, event_id DESC`,
          [row.ferret_id]
        );
        await conn.query(
          'UPDATE ferret_qr005 SET female_status = ? WHERE Ferret_QR005_id = ?',
          [deriveStatus(events), row.ferret_id]
        );
      }
      console.log(`Auto no_litter inserted for ${stale.length} stale mated females`);
    }

    await conn.commit();

    const [[reproCount]] = await conn.query('SELECT COUNT(*) AS n FROM reproductive_event');
    console.log('\n══ Mating history import complete ══');
    console.log(`  mated events inserted:  ${matedInserted} (skipped existing: ${matedSkipped})`);
    console.log(`  estrus events inserted: ${estrusInserted} (skipped existing: ${estrusSkipped})`);
    console.log(`  mating_restriction set: ${restrictionUpdated}`);
    console.log(`  female_status recomputed: ${statusUpdated}`);
    console.log(`  females not found: ${femalesMissing}`);
    console.log(`  male RFID not found: ${malesMissing} (events still inserted without partner_id)`);
    console.log(`  DB reproductive_event total: ${reproCount.n}`);
    if (warnings.length) {
      console.log(`\nWarnings (${warnings.length}):`);
      for (const w of warnings.slice(0, 30)) console.log('  ·', w);
      if (warnings.length > 30) console.log(`  … and ${warnings.length - 30} more`);
    }
  } catch (err) {
    await conn.rollback();
    console.error('Import failed, rolled back:', err.message);
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
