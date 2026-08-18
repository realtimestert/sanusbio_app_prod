#!/usr/bin/env node
/**
 * SanusBio Maternity Import
 * Additive import: parents (mother_id/father_id) + litter_log + kit litter links.
 * Does NOT wipe existing data. Match key: animal_id (from AID#####).
 *
 * Usage (inside sanusbio-app container):
 *   node import-maternity.js --dry-run /app/QR005.csv
 *   node import-maternity.js --import  /app/QR005.csv
 *
 * Expects animals already loaded (e.g. via import-csv.js).
 * Mating History → free-text notes on a reproductive_event when present.
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
  console.error('Usage: node import-maternity.js [--dry-run] [--import] <csv-file>');
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

function aidNum(raw) {
  if (!raw) return null;
  const n = parseInt(String(raw).replace(/^AID/i, '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
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
  console.log(`Parsed ${records.length} rows`);

  // Transform
  const animals = [];
  const warnings = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const rowNum = i + 2;
    const animal_id = aidNum(r['Animal ID']);
    if (!animal_id) {
      warnings.push(`Row ${rowNum}: bad Animal ID — skipped`);
      continue;
    }

    const litter_id = (r['Litter ID'] || '').trim() || null;
    const litter_date = parseDate(r['Litter Date']);
    const delivery_date = parseDate(r['Litter Delivery Date']) || parseDate(r['Most recent delivery Date']);
    const wean_date = parseDate(r['Litter Wean Date']);
    const mate_date = parseDate(r['Last Mating date']);
    const estrus_date = parseDate(r['Confirmed Estrus Start-In Season']) || parseDate(r['Last Confirmed Estrus']);
    const jill_aid = aidNum(r['Jill ID']);
    const hob_aid = aidNum(r['Hob ID']);
    const mating_history = (r['Mating History'] || '').trim();
    const name = (r['Entered Nick Name'] || r['ID'] || `AID${animal_id}`).toString().slice(0, 45);

    animals.push({
      rowNum, animal_id, name,
      litter_id, litter_date, delivery_date, wean_date, mate_date, estrus_date,
      jill_aid, hob_aid,
      mating_history: mating_history && !/^#/.test(mating_history) ? mating_history : null,
    });
  }

  // Group kits by litter_id
  const litterGroups = new Map(); // litter_id -> { litter_date, jill_aid, hob_aid, kits: [] }
  for (const a of animals) {
    if (!a.litter_id) continue;
    if (!litterGroups.has(a.litter_id)) {
      litterGroups.set(a.litter_id, {
        litter_id: a.litter_id,
        litter_date: a.litter_date,
        delivery_date: a.delivery_date,
        wean_date: a.wean_date,
        jill_aid: a.jill_aid,
        hob_aid: a.hob_aid,
        kits: [],
      });
    }
    const g = litterGroups.get(a.litter_id);
    g.kits.push(a);
    // Prefer non-null dates/parents from any kit in the group
    if (!g.litter_date && a.litter_date) g.litter_date = a.litter_date;
    if (!g.delivery_date && a.delivery_date) g.delivery_date = a.delivery_date;
    if (!g.wean_date && a.wean_date) g.wean_date = a.wean_date;
    if (!g.jill_aid && a.jill_aid) g.jill_aid = a.jill_aid;
    if (!g.hob_aid && a.hob_aid) g.hob_aid = a.hob_aid;
  }

  const withParents = animals.filter(a => a.jill_aid || a.hob_aid).length;
  console.log(`Animals with parent AIDs: ${withParents}`);
  console.log(`Unique litters: ${litterGroups.size}`);
  console.log(`Kits in litters: ${[...litterGroups.values()].reduce((s, g) => s + g.kits.length, 0)}`);

  if (DRY && !DO_IMPORT) {
    console.log('\n[DRY-RUN] Sample litters:');
    let n = 0;
    for (const [id, g] of litterGroups) {
      console.log(`  ${id}: date=${g.litter_date} jill=${g.jill_aid} hob=${g.hob_aid} kits=${g.kits.length} [${g.kits.slice(0, 3).map(k => k.name).join(', ')}…]`);
      if (++n >= 5) break;
    }
    if (warnings.length) {
      console.log(`Warnings: ${warnings.length}`);
      warnings.slice(0, 10).forEach(w => console.log('  ', w));
    }
    console.log('\nDry-run complete. Re-run with --import to write.');
    return;
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'db',
    user: process.env.DB_USER || 'sanusbio',
    password: process.env.DB_PASS || process.env.MYSQL_PWD,
    database: process.env.DB_NAME || 'sanusbio',
    waitForConnections: true,
    connectionLimit: 5,
  });

  const conn = await pool.getConnection();
  try {
    // Map animal_id -> Ferret_QR005_id (+ name for notes)
    const [ferretRows] = await conn.query(
      'SELECT Ferret_QR005_id, animal_id, ferret_name FROM ferret_qr005'
    );
    const byAnimalId = new Map();
    for (const f of ferretRows) byAnimalId.set(f.animal_id, f);
    console.log(`DB ferrets loaded: ${byAnimalId.size}`);

    let parentsUpdated = 0;
    let parentsMissing = 0;
    let littersCreated = 0;
    let littersSkipped = 0;
    let kitsLinked = 0;
    let reproCreated = 0;
    let notesAttached = 0;

    // ── 1. Parent IDs ────────────────────────────────────────────────────────
    console.log('\nUpdating mother_id / father_id…');
    for (const a of animals) {
      const f = byAnimalId.get(a.animal_id);
      if (!f) {
        parentsMissing++;
        continue;
      }
      let mid = null, fid = null;
      if (a.jill_aid) {
        const m = byAnimalId.get(a.jill_aid);
        if (m) mid = m.Ferret_QR005_id;
        else warnings.push(`Jill AID${a.jill_aid} not in DB for ${a.name}`);
      }
      if (a.hob_aid) {
        const h = byAnimalId.get(a.hob_aid);
        if (h) fid = h.Ferret_QR005_id;
        else warnings.push(`Hob AID${a.hob_aid} not in DB for ${a.name}`);
      }
      if (mid || fid) {
        await conn.query(
          `UPDATE ferret_qr005
             SET mother_id = COALESCE(?, mother_id),
                 father_id = COALESCE(?, father_id),
                 mother_name = COALESCE(mother_name, ?),
                 father_name = COALESCE(father_name, ?)
           WHERE Ferret_QR005_id = ?`,
          [
            mid, fid,
            mid ? byAnimalId.get(a.jill_aid)?.ferret_name : null,
            fid ? byAnimalId.get(a.hob_aid)?.ferret_name : null,
            f.Ferret_QR005_id,
          ]
        );
        parentsUpdated++;
      }
    }
    console.log(`  parents updated: ${parentsUpdated} (animals not in DB: ${parentsMissing})`);

    // ── 2. Litter logs + kit links ───────────────────────────────────────────
    console.log('Creating litter_log rows…');
    // Existing litter_ids to avoid duplicates
    const [existingLitters] = await conn.query(
      'SELECT litter_log_id, litter_id, Ferret_QR005_id FROM litter_log WHERE litter_id IS NOT NULL'
    );
    const existingByLitterId = new Map();
    for (const L of existingLitters) existingByLitterId.set(L.litter_id, L);

    for (const [litterId, g] of litterGroups) {
      if (existingByLitterId.has(litterId)) {
        littersSkipped++;
        // Still link kits that might be missing litter_id
        for (const kit of g.kits) {
          const f = byAnimalId.get(kit.animal_id);
          if (!f) continue;
          await conn.query(
            `UPDATE ferret_qr005
               SET litter_id = COALESCE(NULLIF(litter_id,''), ?),
                   litter_date = COALESCE(litter_date, ?)
             WHERE Ferret_QR005_id = ?`,
            [litterId, g.litter_date, f.Ferret_QR005_id]
          );
          kitsLinked++;
        }
        continue;
      }

      // Mother must exist for litter_log.Ferret_QR005_id NOT NULL
      let motherFid = null;
      if (g.jill_aid) {
        const m = byAnimalId.get(g.jill_aid);
        if (m) motherFid = m.Ferret_QR005_id;
      }
      if (!motherFid) {
        warnings.push(`Litter ${litterId}: no mother in DB (Jill AID${g.jill_aid}) — skipped`);
        littersSkipped++;
        continue;
      }

      const motherName = byAnimalId.get(g.jill_aid)?.ferret_name || null;
      const fatherName = g.hob_aid ? (byAnimalId.get(g.hob_aid)?.ferret_name || null) : null;
      const kit_count = g.kits.length;
      const eventDate = g.delivery_date || g.litter_date;
      let alreadyInDb = 0;
      for (const kit of g.kits) {
        if (byAnimalId.get(kit.animal_id)) alreadyInDb++;
      }

      const [ins] = await conn.query(
        `INSERT INTO litter_log
           (litter_id, litter_date, kit_count, surviving_litter_count, total_litter_size,
            individuals_created, mother, father, Ferret_QR005_id, created, created_by, anomalies_and_notes)
         VALUES (?,?,?,?,?,?,?,?,?,CURDATE(),'csv-maternity',?)`,
        [
          litterId,
          g.litter_date,
          kit_count,
          kit_count,
          kit_count,
          alreadyInDb,
          motherName,
          fatherName,
          motherFid,
          `Imported ${kit_count} kits from Smartsheet (${alreadyInDb} already in DB)`,
        ]
      );
      littersCreated++;
      existingByLitterId.set(litterId, { litter_log_id: ins.insertId, litter_id: litterId });

      // Link kits
      for (const kit of g.kits) {
        const f = byAnimalId.get(kit.animal_id);
        if (!f) {
          warnings.push(`Kit AID${kit.animal_id} (${kit.name}) not in DB for litter ${litterId}`);
          continue;
        }
        await conn.query(
          `UPDATE ferret_qr005 SET litter_id = ?, litter_date = COALESCE(?, litter_date) WHERE Ferret_QR005_id = ?`,
          [litterId, g.litter_date, f.Ferret_QR005_id]
        );
        kitsLinked++;
      }

      // Reproductive events on mother
      if (eventDate) {
        await conn.query(
          `INSERT INTO reproductive_event (ferret_id, event_type, event_date, partner_id, notes, recorded_by)
           VALUES (?,'littered',?,?,?,'csv-maternity')`,
          [
            motherFid,
            eventDate,
            g.hob_aid ? (byAnimalId.get(g.hob_aid)?.Ferret_QR005_id || null) : null,
            `Litter ${litterId}: ${kit_count} kits`,
          ]
        );
        reproCreated++;
      }
      if (g.wean_date) {
        await conn.query(
          `INSERT INTO reproductive_event (ferret_id, event_type, event_date, notes, recorded_by)
           VALUES (?,'weaned',?,?,'csv-maternity')`,
          [motherFid, g.wean_date, `Weaned litter ${litterId}`]
        );
        reproCreated++;
      }
    }

    // ── 3. Mating history as free-text notes (does NOT drive board status) ───
    // Stored as reproductive_event with event_type 'mated' only when there is a
    // concrete Last Mating date; otherwise kept off the status timeline by using
    // exam_note so historical free-text does not clog the Reproductive Status Board.
    console.log('Attaching mating history notes…');
    for (const a of animals) {
      if (!a.mating_history) continue;
      const f = byAnimalId.get(a.animal_id);
      if (!f) continue;
      const snippet = a.mating_history.slice(0, 80);

      if (a.mate_date) {
        // Real mating date → proper mated event (may affect status; migration 23
        // clears ones older than 70 days with no litter)
        const [exists] = await conn.query(
          `SELECT event_id FROM reproductive_event
            WHERE ferret_id = ? AND event_type = 'mated' AND event_date = ? LIMIT 1`,
          [f.Ferret_QR005_id, a.mate_date]
        );
        if (exists.length) continue;
        await conn.query(
          `INSERT INTO reproductive_event (ferret_id, event_type, event_date, notes, recorded_by)
           VALUES (?,'mated',?,?,'csv-maternity')`,
          [f.Ferret_QR005_id, a.mate_date, a.mating_history.slice(0, 65000)]
        );
        notesAttached++;
        reproCreated++;
      } else {
        // Free-text history only → exam_note (no board impact)
        const [exists] = await conn.query(
          `SELECT exam_note_id FROM exam_note WHERE ferret_id = ? AND notes LIKE ? LIMIT 1`,
          [f.Ferret_QR005_id, snippet + '%']
        );
        if (exists.length) continue;
        await conn.query(
          `INSERT INTO exam_note (ferret_id, exam_date, notes, recorded_by)
           VALUES (?,?,?,'csv-maternity')`,
          [f.Ferret_QR005_id, a.litter_date || a.estrus_date || '2020-01-01', a.mating_history.slice(0, 65000)]
        );
        notesAttached++;
      }
    }

    // Summary
    const [[lc]] = await conn.query('SELECT COUNT(*) AS n FROM litter_log');
    const [[rc]] = await conn.query('SELECT COUNT(*) AS n FROM reproductive_event');
    const [[pc]] = await conn.query(
      'SELECT COUNT(*) AS n FROM ferret_qr005 WHERE mother_id IS NOT NULL OR father_id IS NOT NULL'
    );
    console.log('\n══ Maternity import complete ══');
    console.log(`  parents updated:     ${parentsUpdated}`);
    console.log(`  litters created:     ${littersCreated} (skipped existing: ${littersSkipped})`);
    console.log(`  kits linked:         ${kitsLinked}`);
    console.log(`  reproductive events: ${reproCreated} (mating notes: ${notesAttached})`);
    console.log(`  DB totals → litters: ${lc.n}, repro: ${rc.n}, with parents: ${pc.n}`);
    if (warnings.length) {
      console.log(`\nWarnings (${warnings.length}):`);
      warnings.slice(0, 40).forEach(w => console.log('  ', w));
      if (warnings.length > 40) console.log(`  … +${warnings.length - 40} more`);
    }
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
