#!/usr/bin/env node
/**
 * SanusBio CSV Import Script
 *
 * Usage:
 *   node import-csv.js --dry-run /path/to.csv              # parse only
 *   node import-csv.js --wipe --import /path/to.csv        # full replace
 *   node import-csv.js --update --dry-run /path/to.csv     # preview incremental
 *   node import-csv.js --update /path/to.csv               # incremental upsert
 *
 * --update rules:
 *   Match key: animal_id (AID#####)
 *   New AIDs → full insert
 *   Existing → update core fields; append weights/locations/exam notes if not present
 *   Animals in DB but missing from CSV → left alone
 *   Never truncates
 *
 * Supports both the original 25-col export and the fuller Smartsheet export.
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

// ─── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const WIPE = args.includes('--wipe');
const DO_IMPORT = args.includes('--import');
const DO_UPDATE = args.includes('--update');
const fileArg = args.find(a => !a.startsWith('--'));

if (!fileArg) {
  console.error('Usage: node import-csv.js [--dry-run] [--wipe --import | --update] <csv-file>');
  process.exit(1);
}
if (!DRY && !DO_IMPORT && !DO_UPDATE) {
  console.error('Specify --dry-run, --wipe --import, or --update');
  process.exit(1);
}
if (WIPE && DO_UPDATE) {
  console.error('Cannot combine --wipe with --update');
  process.exit(1);
}

const CSV_PATH = path.resolve(fileArg);
if (!fs.existsSync(CSV_PATH)) {
  console.error('CSV not found:', CSV_PATH);
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function col(r, ...names) {
  for (const n of names) {
    if (r[n] != null && String(r[n]).trim() !== '') return r[n];
  }
  // case-insensitive fallback
  const keys = Object.keys(r);
  for (const n of names) {
    const hit = keys.find(k => k.toLowerCase() === n.toLowerCase());
    if (hit && r[hit] != null && String(r[hit]).trim() !== '') return r[hit];
  }
  return '';
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

function daysBefore(isoDate, n) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function parseIdField(raw) {
  if (!raw) return { name: null, mother: null, father: null, rfid: null };
  let s = String(raw).replace(/\s+/g, ' ').trim();
  const byIdx = s.search(/\s+by\s+/i);
  if (byIdx === -1) return { name: s, mother: null, father: null, rfid: null };
  const name = s.slice(0, byIdx).trim();
  let rest = s.slice(byIdx).replace(/^\s+by\s+/i, '').trim();
  let rfid = null;
  const rfidMatch = rest.match(/\s+(\d{10,20}|TBD)\s*$/i);
  if (rfidMatch) {
    rfid = rfidMatch[1].toUpperCase() === 'TBD' ? null : rfidMatch[1];
    rest = rest.slice(0, rfidMatch.index).trim();
  }
  let mother = null, father = null;
  const amp = rest.indexOf('&');
  if (amp >= 0) {
    mother = rest.slice(0, amp).trim() || null;
    father = rest.slice(amp + 1).trim() || null;
  } else if (rest) {
    mother = rest;
  }
  return { name, mother, father, rfid };
}

function parseRoomToken(token) {
  if (!token) return null;
  const s = String(token).replace(/\s+/g, ' ').trim();
  const m = s.match(/Room\s+(\d+)\s*([A-Za-z])\s*(Top|Middle|Bottom)/i);
  if (!m) return null;
  return {
    room_id: parseInt(m[1], 10),
    cage_address: m[2].toUpperCase(),
    room_lighting: m[3].charAt(0).toUpperCase() + m[3].slice(1).toLowerCase(),
  };
}

function parseLocationHistory(raw) {
  if (!raw || !String(raw).trim()) return [];
  const parts = String(raw).split(';').map(p => p.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const dm = p.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+)$/);
    if (dm) {
      const date = parseDate(dm[1]);
      const room = parseRoomToken(dm[2]);
      if (date && room) out.push({ date, ...room });
    } else {
      const room = parseRoomToken(p);
      if (room) out.push({ date: null, ...room });
    }
  }
  return out;
}

function parseWeights(weightRecord, weightDateIso, birthIso) {
  if (!weightRecord || !String(weightRecord).trim() || !weightDateIso) return [];
  const nums = String(weightRecord).split(',')
    .map(s => parseFloat(s.trim()))
    .filter(n => !isNaN(n) && n >= 50 && n <= 5000);
  if (!nums.length) return [];
  const trySteps = [30, 10, 5];
  for (const step of trySteps) {
    const rows = [];
    let ok = true;
    for (let i = 0; i < nums.length; i++) {
      const d = daysBefore(weightDateIso, i * step);
      if (birthIso && d < birthIso) { ok = false; break; }
      rows.push({ date: d, weight: Math.round(nums[i]) });
    }
    if (ok) return rows;
  }
  return nums.map((w, i) => ({
    date: i === 0 ? weightDateIso : (birthIso || weightDateIso),
    weight: Math.round(w),
  }));
}

function parseMedicalNotes(raw) {
  if (!raw || !String(raw).trim()) return [];
  const parts = String(raw).split(';').map(p => p.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const m = p.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+)$/s);
    if (m) {
      const date = parseDate(m[1]);
      const notes = m[2].trim();
      if (date && notes) out.push({ date, notes });
    } else if (p.length > 3) {
      out.push({ date: null, notes: p });
    }
  }
  return out;
}

function parseColorAndDescription(description, comments) {
  let color = null;
  let descParts = [];
  for (const raw of [description, comments]) {
    if (!raw || !String(raw).trim()) continue;
    const lines = String(raw).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const cm = line.match(/^Color-(.+)$/i);
      if (cm && !color) color = cm[1].trim();
      else descParts.push(line);
    }
  }
  return { color, description: descParts.join('\n') || null };
}

function mapLight(raw) {
  if (!raw) return { eight_hour_light: 0, light_mode: 'manual' };
  const s = String(raw).trim().toLowerCase();
  if (s === 'gone' || s === '16 on') return { eight_hour_light: 0, light_mode: 'manual' };
  if (s === 'on' || s === '8 on' || s.includes('8')) return { eight_hour_light: 1, light_mode: 'manual' };
  return { eight_hour_light: 0, light_mode: 'manual' };
}

function mapMatingFlags(raw) {
  if (!raw) return null;
  const flags = new Set();
  const s = String(raw).toLowerCase();
  if (s.includes('under age') || s.includes('under_age')) flags.add('under_age');
  if (s.includes('over age') || s.includes('over aged') || s.includes('over_age')) flags.add('over_age');
  if (s.includes('albino')) flags.add('albino');
  return flags.size ? [...flags].join(',') : null;
}

function mapAcquisitionClass(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  const parts = [];
  if (s.includes('littered')) parts.push('Littered');
  if (s.includes('sourced')) parts.push('Sourced');
  return parts.length ? parts.join(',') : null;
}

function primarySupplierName(raw) {
  if (!raw || !String(raw).trim()) return null;
  const first = String(raw).split(/\r?\n/)[0].trim();
  if (!first || first.toUpperCase() === 'NA') return null;
  return first.slice(0, 100);
}

function supplierExtras(raw) {
  if (!raw) return { contact_info: null, supplier_address: null };
  const lines = String(raw).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length <= 1) return { contact_info: null, supplier_address: null };
  return {
    contact_info: lines.slice(1).join(' | ').slice(0, 255),
    supplier_address: lines.slice(1).join('\n').slice(0, 150),
  };
}

function aidNum(raw) {
  if (!raw) return null;
  const n = parseInt(String(raw).replace(/^AID/i, '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ─── Transform one CSV row ────────────────────────────────────────────────────
function transformRow(r, rowNum, warnings) {
  const animal_id = aidNum(col(r, 'Animal ID'));
  if (!animal_id) {
    warnings.push(`Row ${rowNum}: bad Animal ID — skipped`);
    return null;
  }

  const idParsed = parseIdField(col(r, 'ID'));
  const nick = col(r, 'Entered Nick Name').trim();
  const name = (nick || idParsed.name || `Animal-${animal_id}`).slice(0, 45);

  const sexRaw = col(r, 'Sex').trim().toLowerCase();
  let sex = null;
  let forceCastrated = false;
  if (sexRaw.startsWith('male')) sex = 'male';
  if (sexRaw.startsWith('female')) sex = 'female';
  if (sexRaw.includes('neutered') || sexRaw.includes('spay')) forceCastrated = true;

  const spay = col(r, 'Spay/Neuter Status').toLowerCase().includes('castrat') || forceCastrated;
  const { color, description } = parseColorAndDescription(col(r, 'Description'), col(r, 'Descriptive comments'));
  const birth_date = parseDate(col(r, 'Reported Birth Date'));
  if (!birth_date) {
    warnings.push(`Row ${rowNum} (${name}): missing/invalid birth date — skipped`);
    return null;
  }

  const weightDate = parseDate(col(r, 'Weight date'));
  const weightRaw = col(r, 'Weight Record', 'Weight (gms) last 30 days');
  const weightRows = parseWeights(weightRaw, weightDate, birth_date);
  let currentWeight = weightRows.length ? weightRows[0].weight : (parseInt(col(r, 'Weight'), 10) || 0);
  if (currentWeight < 50 || currentWeight > 5000) currentWeight = 0;

  const locHist = parseLocationHistory(col(r, 'Location History'));
  const medicalNotes = parseMedicalNotes(col(r, 'Medical Condition History'));
  const light = mapLight(col(r, '8-hour Light'));
  const matingFlags = mapMatingFlags(col(r, 'Mating Restriction'));
  const acquisition_class = mapAcquisitionClass(col(r, 'Acquisition Class'));
  const rabiesDue = parseDate(col(r, 'Rabies Due'));

  const currentAddrRaw = col(r, 'Address').trim();
  const currentRoom = parseRoomToken(currentAddrRaw);
  const isUnassigned = !currentAddrRaw || /^unassigned$/i.test(currentAddrRaw);

  const deathDate = parseDate(col(r, 'Death Date'));
  const distDate = parseDate(col(r, 'Distribution Date'));
  const distTo = col(r, 'Distributed To').trim();
  const lastMove = parseDate(col(r, 'Last Move Date'));
  const deadOrGone = col(r, 'Dead or Gone').toString().toUpperCase() === 'TRUE';

  let isDead = !!(deathDate || (deadOrGone && !distDate));
  let isDistributed = !!(distDate && distTo) || (deadOrGone && distDate);
  if (deathDate) isDead = true;

  const supName = primarySupplierName(col(r, 'Supplier'));
  const supExtra = supplierExtras(col(r, 'Supplier Address') || col(r, 'Supplier'));

  let rfid = col(r, 'Animal RFID').trim();
  if (!rfid || rfid.toUpperCase() === 'TBD') rfid = idParsed.rfid;
  if (rfid && rfid.toUpperCase() === 'TBD') rfid = null;

  const jill_aid = aidNum(col(r, 'Jill ID'));
  const hob_aid = aidNum(col(r, 'Hob ID'));
  const litter_id = col(r, 'Litter ID').trim() || null;
  const litter_date = parseDate(col(r, 'Litter Date'));

  return {
    rowNum, animal_id, name,
    mother_name: idParsed.mother || null,
    father_name: idParsed.father || null,
    jill_aid, hob_aid, litter_id, litter_date,
    rfid, sex, spay, color, description,
    birth_date, currentWeight, weightRows, rabiesDue,
    locHist, medicalNotes, light, matingFlags, acquisition_class,
    currentRoom, isUnassigned, isDead, isDistributed,
    deathDate, distDate, distTo, lastMove,
    supName, supExtra,
    created: parseDate((col(r, 'Created') || '').split(' ')[0]),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
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

  const animals = [];
  const warnings = [];
  for (let i = 0; i < records.length; i++) {
    const a = transformRow(records[i], i + 2, warnings);
    if (a) animals.push(a);
  }
  console.log(`Transformable animals: ${animals.length}`);
  if (warnings.length) {
    console.log(`Transform warnings (${warnings.length}):`);
    warnings.slice(0, 20).forEach(w => console.log('  ', w));
    if (warnings.length > 20) console.log(`  … +${warnings.length - 20} more`);
  }

  // Dry-run without DB (parse-only) when not --update
  if (DRY && !DO_UPDATE && !DO_IMPORT) {
    console.log('\n[DRY-RUN] Sample of first 3:');
    console.log(JSON.stringify(animals.slice(0, 3), null, 2));
    console.log('Dead:', animals.filter(a => a.isDead).length);
    console.log('Distributed:', animals.filter(a => a.isDistributed).length);
    console.log('With RFID:', animals.filter(a => a.rfid).length);
    console.log('\nDry-run complete.');
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
    // Shared lookups
    const ensureNaSupplier = async () => {
      let [[na]] = await conn.query("SELECT supplier_id FROM supplier WHERE supplier_name = 'NA' LIMIT 1");
      if (!na) {
        const [ins] = await conn.query("INSERT INTO supplier (supplier_name, contact_info) VALUES ('NA', 'Placeholder')");
        na = { supplier_id: ins.insertId };
      }
      return na.supplier_id;
    };
    const ensureNaAddress = async () => {
      let [[na]] = await conn.query("SELECT address_id FROM address WHERE cage_address = 'N/A' LIMIT 1");
      if (!na) {
        const [ins] = await conn.query("INSERT INTO address (room_id, cage_address) VALUES (0, 'N/A')");
        na = { address_id: ins.insertId };
      }
      return na.address_id;
    };

    const NA_SUPPLIER_ID = await ensureNaSupplier();
    const NA_ADDRESS_ID = await ensureNaAddress();

    const supplierMap = new Map();
    supplierMap.set('NA', NA_SUPPLIER_ID);
    for (const s of (await conn.query('SELECT supplier_id, supplier_name FROM supplier'))[0]) {
      supplierMap.set(s.supplier_name, s.supplier_id);
    }
    const ensureSupplier = async (a) => {
      if (!a.supName) return NA_SUPPLIER_ID;
      if (supplierMap.has(a.supName)) return supplierMap.get(a.supName);
      if (DRY) return -1; // placeholder
      const [ins] = await conn.query(
        'INSERT INTO supplier (supplier_name, contact_info, supplier_address) VALUES (?,?,?)',
        [a.supName, a.supExtra.contact_info, a.supExtra.supplier_address]
      );
      supplierMap.set(a.supName, ins.insertId);
      return ins.insertId;
    };

    const distRows = (await conn.query('SELECT distributor_id, distributor_name FROM distributor'))[0];
    const distMap = new Map();
    for (const d of distRows) distMap.set(d.distributor_name.toLowerCase(), d.distributor_id);
    const resolveDistributor = (name) => {
      if (!name) return null;
      const key = name.toLowerCase();
      if (distMap.has(key)) return distMap.get(key);
      for (const [k, id] of distMap) {
        if (k.includes(key) || key.includes(k)) return id;
      }
      return null;
    };

    const addrCache = new Map();
    addrCache.set('0|N/A|', NA_ADDRESS_ID);
    for (const a of (await conn.query('SELECT address_id, room_id, cage_address, room_lighting FROM address'))[0]) {
      addrCache.set(`${a.room_id}|${a.cage_address || ''}|${a.room_lighting || ''}`, a.address_id);
    }
    const ensureAddress = async (room) => {
      if (!room) return NA_ADDRESS_ID;
      const key = `${room.room_id}|${room.cage_address}|${room.room_lighting || ''}`;
      if (addrCache.has(key)) return addrCache.get(key);
      if (DRY) return -1;
      const [ins] = await conn.query(
        'INSERT INTO address (room_id, cage_address, room_lighting) VALUES (?,?,?)',
        [room.room_id, room.cage_address, room.room_lighting || null]
      );
      addrCache.set(key, ins.insertId);
      return ins.insertId;
    };

    const resolveAddressId = async (a) => {
      if (a.isDead || a.isDistributed || a.isUnassigned) return NA_ADDRESS_ID;
      if (a.currentRoom) return ensureAddress(a.currentRoom);
      return NA_ADDRESS_ID;
    };

    // ── WIPE path (original full import) ────────────────────────────────────
    if (WIPE && !DRY) {
      console.log('\nWiping ferret-related data…');
      await conn.query('SET FOREIGN_KEY_CHECKS=0');
      for (const t of [
        'exam_note', 'health_event', 'litter_care_event', 'litter_kit_death',
        'litter_log', 'reproductive_event', 'rfid_assignment', 'distribution_event',
        'ferret_location_history', 'vaccination_event', 'room_cleaning_report',
        'activity_log', 'ferret_qr005', 'medical_info', 'estrus_check_log',
        'females_to_mate', 'health_log',
      ]) {
        try { await conn.query(`TRUNCATE TABLE \`${t}\``); console.log('  truncated', t); }
        catch (e) { console.log('  skip', t, e.message.split('\n')[0]); }
      }
      await conn.query("DELETE FROM address WHERE cage_address <> 'N/A'");
      await conn.query('SET FOREIGN_KEY_CHECKS=1');
    }

    // Existing animals map
    const [existingRows] = await conn.query(
      'SELECT Ferret_QR005_id, animal_id, ferret_name, medical_info_id, address_id, weight FROM ferret_qr005'
    );
    const byAnimalId = new Map();
    for (const f of existingRows) byAnimalId.set(f.animal_id, f);
    console.log(`DB ferrets currently: ${byAnimalId.size}`);

    const toInsert = animals.filter(a => !byAnimalId.has(a.animal_id));
    const toUpdate = animals.filter(a => byAnimalId.has(a.animal_id));
    console.log(`Would insert: ${toInsert.length}  |  Would update: ${toUpdate.length}`);

    if (DRY && DO_UPDATE) {
      console.log('\n[DRY-RUN --update] New AIDs (first 15):');
      toInsert.slice(0, 15).forEach(a =>
        console.log(`  AID${String(a.animal_id).padStart(5, '0')} ${a.name} ${a.sex || '?'} dead=${a.isDead} dist=${a.isDistributed}`)
      );
      if (toInsert.length > 15) console.log(`  … +${toInsert.length - 15} more`);
      console.log('\nDry-run complete. Re-run with --update (no --dry-run) to write.');
      return;
    }

    if (!DO_IMPORT && !DO_UPDATE) return;

    await conn.query('SET FOREIGN_KEY_CHECKS=0');

    // ── Shared: insert one new animal ───────────────────────────────────────
    async function insertAnimal(a) {
      const supplier_id = await ensureSupplier(a);
      const address_id = await resolveAddressId(a);

      const [mi] = await conn.query(
        "INSERT INTO medical_info (castrated_or_spayed, dead, date_of_death) VALUES (?,?,?)",
        [a.spay ? 'y' : 'n', a.isDead ? 'y' : 'n', a.isDead ? a.deathDate : null]
      );
      const [ec] = await conn.query('INSERT INTO estrus_check_log () VALUES ()');
      const [fm] = await conn.query('INSERT INTO females_to_mate () VALUES ()');
      const [hl] = await conn.query('INSERT INTO health_log () VALUES ()');

      const [fr] = await conn.query(`
        INSERT INTO ferret_qr005
          (animal_id, ferret_name, birth_date, weight, description, color, sex,
           address_id, medical_info_id, estrus_check_log_id, females_to_mate_id, health_log_id,
           supplier_id, mother_name, father_name, dead, death_date,
           eight_hour_light, light_state_since, light_mode,
           distributed, distributor_id, distribution_date,
           mating_restriction_flags, acquisition_class, acquisition_by,
           next_rabies_vaccine_due, litter_id, litter_date, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'csv-import')
      `, [
        a.animal_id, a.name, a.birth_date, a.currentWeight || 0,
        a.description, a.color, a.sex,
        address_id, mi.insertId, ec.insertId, fm.insertId, hl.insertId,
        supplier_id, a.mother_name, a.father_name,
        a.isDead ? '1' : '0', a.deathDate,
        a.light.eight_hour_light, a.birth_date, a.light.light_mode,
        a.isDistributed ? 1 : 0,
        a.isDistributed ? resolveDistributor(a.distTo) : null,
        a.isDistributed ? a.distDate : null,
        a.matingFlags, a.acquisition_class, a.acquisition_class,
        a.rabiesDue, a.litter_id, a.litter_date,
      ]);
      const fid = fr.insertId;
      a._fid = fid;
      a._address_id = address_id;
      byAnimalId.set(a.animal_id, { Ferret_QR005_id: fid, animal_id: a.animal_id, ferret_name: a.name, medical_info_id: mi.insertId, address_id });
      return fid;
    }

    async function appendHistory(a, fid) {
      // Weights — only insert if that date not present
      for (const w of a.weightRows) {
        const [ex] = await conn.query(
          "SELECT health_event_id FROM health_event WHERE ferret_id=? AND event_type='weight' AND event_date=? LIMIT 1",
          [fid, w.date]
        );
        if (ex.length) continue;
        await conn.query(
          "INSERT INTO health_event (ferret_id, event_type, weight, event_date, recorded_by) VALUES (?,'weight',?,?,?)",
          [fid, w.weight, w.date, 'csv-import']
        );
      }
      // Exam notes
      for (const n of a.medicalNotes) {
        const ed = n.date || a.birth_date;
        const [ex] = await conn.query(
          'SELECT exam_note_id FROM exam_note WHERE ferret_id=? AND exam_date=? AND notes=? LIMIT 1',
          [fid, ed, n.notes]
        );
        if (ex.length) continue;
        await conn.query(
          'INSERT INTO exam_note (ferret_id, exam_date, notes, recorded_by) VALUES (?,?,?,?)',
          [fid, ed, n.notes, 'csv-import']
        );
      }
      // Location: if current address differs from open location, close and open new
      if (a.currentRoom && !a.isDead && !a.isDistributed) {
        const addrId = await ensureAddress(a.currentRoom);
        const [open] = await conn.query(
          'SELECT location_event_id, address_id FROM ferret_location_history WHERE ferret_id=? AND move_out IS NULL LIMIT 1',
          [fid]
        );
        if (!open.length) {
          await conn.query(
            'INSERT INTO ferret_location_history (move_in, move_out, ferret_id, address_id) VALUES (?,?,?,?)',
            [a.lastMove || a.birth_date, null, fid, addrId]
          );
        } else if (open[0].address_id !== addrId) {
          const moveDate = a.lastMove || new Date().toISOString().slice(0, 10);
          await conn.query(
            'UPDATE ferret_location_history SET move_out=? WHERE location_event_id=?',
            [moveDate, open[0].location_event_id]
          );
          await conn.query(
            'INSERT INTO ferret_location_history (move_in, move_out, ferret_id, address_id) VALUES (?,?,?,?)',
            [moveDate, null, fid, addrId]
          );
        }
      }
      // Distribution event
      if (a.isDistributed && a.distDate) {
        const did = resolveDistributor(a.distTo);
        if (did) {
          const [ex] = await conn.query(
            'SELECT distribution_id FROM distribution_event WHERE ferret_id=? AND distribution_date=? LIMIT 1',
            [fid, a.distDate]
          );
          if (!ex.length) {
            await conn.query(
              'INSERT INTO distribution_event (ferret_id, distributor_id, distribution_date, recorded_by) VALUES (?,?,?,?)',
              [fid, did, a.distDate, 'csv-import']
            );
          }
        }
      }
    }

    // ── UPDATE path ─────────────────────────────────────────────────────────
    if (DO_UPDATE) {
      console.log('\n--update: inserting new animals…');
      let inserted = 0;
      for (const a of toInsert) {
        await insertAnimal(a);
        await appendHistory(a, a._fid);
        // Initial location
        await conn.query(
          'INSERT INTO ferret_location_history (move_in, move_out, ferret_id, address_id) VALUES (?,?,?,?)',
          [a.birth_date, (a.isDead || a.isDistributed) ? (a.deathDate || a.distDate || a.birth_date) : null, a._fid, a._address_id]
        );
        if (a.isDead || a.isDistributed) {
          await conn.query(
            'INSERT INTO ferret_location_history (move_in, move_out, ferret_id, address_id) VALUES (?,?,?,?)',
            [a.deathDate || a.distDate || a.birth_date, null, a._fid, NA_ADDRESS_ID]
          );
        }
        inserted++;
        if (inserted % 25 === 0) console.log(`  … inserted ${inserted}`);
      }
      console.log(`  inserted ${inserted}`);

      console.log('Updating existing animals…');
      let updated = 0;
      for (const a of toUpdate) {
        const existing = byAnimalId.get(a.animal_id);
        const fid = existing.Ferret_QR005_id;
        a._fid = fid;
        const supplier_id = await ensureSupplier(a);
        const address_id = await resolveAddressId(a);

        await conn.query(`
          UPDATE ferret_qr005 SET
            ferret_name = ?, sex = COALESCE(?, sex), color = COALESCE(?, color),
            description = COALESCE(?, description), birth_date = ?,
            weight = CASE WHEN ? > 0 THEN ? ELSE weight END,
            eight_hour_light = ?, light_mode = ?,
            mating_restriction_flags = COALESCE(?, mating_restriction_flags),
            acquisition_class = COALESCE(?, acquisition_class),
            next_rabies_vaccine_due = COALESCE(?, next_rabies_vaccine_due),
            litter_id = COALESCE(?, litter_id),
            litter_date = COALESCE(?, litter_date),
            mother_name = COALESCE(?, mother_name),
            father_name = COALESCE(?, father_name),
            supplier_id = ?,
            address_id = ?,
            dead = ?, death_date = COALESCE(?, death_date),
            distributed = ?, distributor_id = COALESCE(?, distributor_id),
            distribution_date = COALESCE(?, distribution_date)
          WHERE Ferret_QR005_id = ?
        `, [
          a.name, a.sex, a.color, a.description, a.birth_date,
          a.currentWeight, a.currentWeight,
          a.light.eight_hour_light, a.light.light_mode,
          a.matingFlags, a.acquisition_class, a.rabiesDue,
          a.litter_id, a.litter_date,
          a.mother_name, a.father_name,
          supplier_id, address_id,
          a.isDead ? '1' : '0', a.deathDate,
          a.isDistributed ? 1 : 0,
          a.isDistributed ? resolveDistributor(a.distTo) : null,
          a.distDate,
          fid,
        ]);

        // medical_info castration / death
        if (existing.medical_info_id) {
          await conn.query(
            `UPDATE medical_info SET
               castrated_or_spayed = COALESCE(?, castrated_or_spayed),
               dead = ?, date_of_death = COALESCE(?, date_of_death)
             WHERE medical_info_id = ?`,
            [a.spay ? 'y' : null, a.isDead ? 'y' : 'n', a.deathDate, existing.medical_info_id]
          );
        }

        await appendHistory(a, fid);
        updated++;
        if (updated % 50 === 0) console.log(`  … updated ${updated}`);
      }
      console.log(`  updated ${updated}`);

      // Parent ID resolution (Jill/Hob AID preferred, else name)
      console.log('Resolving parent IDs…');
      let linked = 0;
      const nameMap = new Map();
      for (const [, f] of byAnimalId) {
        const nk = (f.ferret_name || '').toLowerCase();
        if (!nameMap.has(nk)) nameMap.set(nk, []);
        nameMap.get(nk).push(f.Ferret_QR005_id);
      }
      for (const a of animals) {
        if (!a._fid && !byAnimalId.has(a.animal_id)) continue;
        const fid = a._fid || byAnimalId.get(a.animal_id).Ferret_QR005_id;
        let mid = null, faid = null;
        if (a.jill_aid && byAnimalId.has(a.jill_aid)) mid = byAnimalId.get(a.jill_aid).Ferret_QR005_id;
        if (a.hob_aid && byAnimalId.has(a.hob_aid)) faid = byAnimalId.get(a.hob_aid).Ferret_QR005_id;
        if (!mid && a.mother_name) {
          const hits = nameMap.get(a.mother_name.toLowerCase()) || [];
          if (hits.length === 1) mid = hits[0];
        }
        if (!faid && a.father_name) {
          const hits = nameMap.get(a.father_name.toLowerCase()) || [];
          if (hits.length === 1) faid = hits[0];
        }
        if (mid || faid) {
          await conn.query(
            'UPDATE ferret_qr005 SET mother_id = COALESCE(?, mother_id), father_id = COALESCE(?, father_id) WHERE Ferret_QR005_id = ?',
            [mid, faid, fid]
          );
          linked++;
        }
      }
      console.log(`  parent links touched: ${linked}`);

      // RFID active rule for newly inserted + any with rfid in this batch
      console.log('RFID assignments…');
      const byRfid = new Map();
      for (const a of animals) {
        if (!a.rfid) continue;
        const fid = a._fid || byAnimalId.get(a.animal_id)?.Ferret_QR005_id;
        if (!fid) continue;
        if (!byRfid.has(a.rfid)) byRfid.set(a.rfid, []);
        byRfid.get(a.rfid).push({ ...a, _fid: fid });
      }
      for (const [rfid, group] of byRfid) {
        const live = group.filter(a => !a.isDead && !a.isDistributed);
        const active = (live.length ? live : group).sort((x, y) => y.animal_id - x.animal_id)[0];
        for (const a of group) {
          const [ex] = await conn.query(
            'SELECT rfid_assignment_id FROM rfid_assignment WHERE rfid=? AND ferret_id=? LIMIT 1',
            [rfid, a._fid]
          );
          if (ex.length) continue;
          const isActive = a._fid === active._fid;
          await conn.query(
            'INSERT INTO rfid_assignment (rfid, ferret_id, assigned_date, unassigned_date, reason, notes) VALUES (?,?,?,?,?,?)',
            [
              rfid, a._fid, a.birth_date,
              isActive ? null : (a.deathDate || a.distDate || a.birth_date),
              isActive ? 'import' : 'tag reused',
              isActive ? null : `Superseded by animal_id ${active.animal_id}`,
            ]
          );
        }
      }
    }

    // ── Full --import path (after optional wipe) ────────────────────────────
    if (DO_IMPORT && !DO_UPDATE) {
      console.log('\nInserting ferrets…');
      let inserted = 0;
      for (const a of animals) {
        if (byAnimalId.has(a.animal_id) && !WIPE) {
          // shouldn't happen after wipe; skip if re-run without wipe
          continue;
        }
        await insertAnimal(a);
        inserted++;
        if (inserted % 50 === 0) console.log(`  … ${inserted}`);
      }
      console.log(`Inserted ${inserted}`);

      console.log('Location history…');
      for (const a of animals) {
        if (!a._fid) continue;
        const moves = [...a.locHist].reverse();
        let events = moves.map(m => ({ ...m }));
        if (a.currentRoom && !a.isUnassigned && !a.isDead) {
          const last = events[events.length - 1];
          const same = last && last.room_id === a.currentRoom.room_id
            && last.cage_address === a.currentRoom.cage_address
            && last.room_lighting === a.currentRoom.room_lighting;
          if (!same) events.push({ date: a.lastMove || a.birth_date, ...a.currentRoom });
        }
        if (!events.length) {
          await conn.query(
            'INSERT INTO ferret_location_history (move_in, move_out, ferret_id, address_id) VALUES (?,?,?,?)',
            [a.birth_date, null, a._fid, a._address_id]
          );
        } else {
          for (let i = 0; i < events.length; i++) {
            const e = events[i];
            const addrId = await ensureAddress(e);
            const moveIn = e.date || a.birth_date;
            let finalOut = (i < events.length - 1) ? (events[i + 1].date || null) : null;
            if (i === events.length - 1 && (a.isDead || a.isDistributed)) {
              finalOut = a.deathDate || a.distDate || moveIn;
            }
            await conn.query(
              'INSERT INTO ferret_location_history (move_in, move_out, ferret_id, address_id) VALUES (?,?,?,?)',
              [moveIn, finalOut, a._fid, addrId]
            );
          }
          if (a.isDead || a.isDistributed) {
            await conn.query(
              'INSERT INTO ferret_location_history (move_in, move_out, ferret_id, address_id) VALUES (?,?,?,?)',
              [a.deathDate || a.distDate || a.birth_date, null, a._fid, NA_ADDRESS_ID]
            );
          }
        }
      }

      console.log('Weight / exam / distribution / RFID…');
      for (const a of animals) {
        if (!a._fid) continue;
        await appendHistory(a, a._fid);
      }

      // RFID
      const byRfid = new Map();
      for (const a of animals) {
        if (!a._fid || !a.rfid) continue;
        if (!byRfid.has(a.rfid)) byRfid.set(a.rfid, []);
        byRfid.get(a.rfid).push(a);
      }
      for (const [rfid, group] of byRfid) {
        const live = group.filter(a => !a.isDead && !a.isDistributed);
        const active = (live.length ? live : group).sort((x, y) => y.animal_id - x.animal_id)[0];
        for (const a of group) {
          const isActive = a._fid === active._fid;
          await conn.query(
            'INSERT INTO rfid_assignment (rfid, ferret_id, assigned_date, unassigned_date, reason, notes) VALUES (?,?,?,?,?,?)',
            [
              rfid, a._fid, a.birth_date,
              isActive ? null : (a.deathDate || a.distDate || a.birth_date),
              isActive ? 'import' : 'tag reused',
              isActive ? null : `Superseded by animal_id ${active.animal_id}`,
            ]
          );
        }
      }

      // Parents by name
      console.log('Resolving mother/father IDs…');
      const idByName = new Map();
      for (const a of animals) {
        if (!a._fid) continue;
        const nk = a.name.toLowerCase();
        if (!idByName.has(nk)) idByName.set(nk, []);
        idByName.get(nk).push(a._fid);
      }
      let linked = 0;
      for (const a of animals) {
        if (!a._fid) continue;
        let mid = null, fid = null;
        if (a.mother_name) {
          const hits = idByName.get(a.mother_name.toLowerCase()) || [];
          if (hits.length === 1) mid = hits[0];
        }
        if (a.father_name) {
          const hits = idByName.get(a.father_name.toLowerCase()) || [];
          if (hits.length === 1) fid = hits[0];
        }
        if (mid || fid) {
          await conn.query(
            'UPDATE ferret_qr005 SET mother_id = COALESCE(?, mother_id), father_id = COALESCE(?, father_id) WHERE Ferret_QR005_id = ?',
            [mid, fid, a._fid]
          );
          linked++;
        }
      }
      console.log(`  linked ${linked}`);
    }

    await conn.query('SET FOREIGN_KEY_CHECKS=1');

    const [[c]] = await conn.query('SELECT COUNT(*) AS n FROM ferret_qr005');
    console.log('\n══ Done ══');
    console.log(`  ferrets in DB: ${c.n}`);
    if (warnings.length) {
      console.log(`Warnings (${warnings.length}):`);
      warnings.slice(0, 30).forEach(w => console.log('  ', w));
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
