<<<<<<< Updated upstream
// SanusBio v1.10.7 | 2026-08-13 | server.js
=======
// SanusBio v1.11.2 | 2026-08-18 | server.js
// v1.11.2: Reproductive Status Board — exclude weaned (treated as baseline);
//          board row can record no_litter to return a mated female to baseline.
//          Migration 23 recomputes female_status, marks imported litter kits
//          as already created, and auto-clears mated>70d with no litter.
// v1.11.1: Dropped three orphaned/retired tables via migration 21
//          (push_subscriptions, estrus_&_mating_summary, assignments).
//          Removed residual DELETE statements and the 'assignments' entry
//          from the ferret activity-history filter. Feature had already
//          been retired from UI and routes in earlier 1.10.x work.
>>>>>>> Stashed changes
// v1.10.7: (1) added missing GET /api/rooms — app-cleaning.js has always
//          called this to populate the "what room(s) did you clean" picker
//          and the report-history room filter, but the route never existed,
//          so that fetch 404'd. Because loadCrHistory() awaited it BEFORE
//          fetching /cleaning-reports, the whole history load was silently
//          aborted too — this single missing route explains both "no rooms
//          to pick" and "history shows nothing"; (2) marking a ferret
//          deceased now unassigns it from its physical room (moves it to
//          the shared "N/A" address used for new/unassigned ferrets, and
//          closes/opens the matching ferret_location_history rows) — dead
//          ferrets were staying parked in their last room forever, which
//          blocked deleting empty test rooms (DELETE /addresses/:id refuses
//          if ANY ferret, dead or alive, still references that address_id);
//          see migration 20 for a one-time backfill of already-deceased
//          ferrets that predate this fix.
// v1.10.6: (1) removed the unused /api/assignments routes (tab was already
//          gone from the UI — this is the cleanup); (2) dashboard no longer
//          queries the assignments table for "Overdue Tasks" (always read 0
//          since the feature has no writers left); (3) new /api/reports/*
//          endpoints — ferrets-by-room, deaths, infant-mortality — backing
//          the new Reports page (reproductive-status reuses the existing
//          /api/females/estrus endpoint); (4) PUT /ferrets/:id/location no
//          longer requires/expects a `position` field from the client (Move
//          modal in the UI no longer sends one) — existing cage positions
//          are left untouched unless explicitly provided
// v1.9.5: light-cycle duration tracking moved from rooms to ferrets
//         (light_mode auto/manual); moves now take a move_date; room toggle
//         cascades to auto-mode ferrets in that room
// v1.10.0: (1) ferret_location_history now actually populated on create/move,
//          plus GET history endpoint — former rooms are viewable; (2) mating
//          records support a pulled_date (date female was separated from the
//          male); expected litter is now returned as a RANGE — 6 weeks from
//          mating date through 6 weeks from pulled_date; (3) marking a female
//          deceased snapshots her female_status into death_female_status when
//          she was active on the Reproductive Status Board at time of death
// v1.10.1: stillborn kits no longer count toward individuals left to create —
//          surviving_litter_count is now computed on litter create/edit
// v1.10.2: care-alerts weight check now also considers exam_note.weight_grams
//          entries (Medical Info tab), taking whichever is more recent vs.
//          health_event weight logs — previously exam-note weights were
//          invisible to the Weight & Grooming Alerts card
// v1.10.3: FIX — GET /api/ferrets/care-alerts was registered AFTER
//          GET /api/ferrets/:id, so Express matched :id first (id="care-alerts")
//          and returned 404 "Ferret not found" on every request. The Weight &
//          Grooming Alerts card has likely never worked as a result. Moved
//          care-alerts route to register before the :id route.
// v1.10.5: (1) health events can now be edited (event_date correction, plus
//          weight/notes) via PUT /api/health-events/:id, and deleted via
//          DELETE /api/health-events/:id — both restricted to admin/research/
//          maternity (require_perm('update')); editing/deleting the most
//          recent weight entry re-syncs ferret_qr005.weight to the new
//          latest value; (2) new GET /api/ferrets/:id/litters-as-father —
//          matches litter_log.father (free-text) against the ferret's name,
//          used for a male's "Litters (as Father)" tab; (3) Assignments
//          feature is no longer exposed in the UI (tab removed) — the
//          underlying /api/assignments routes are left in place unused.
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 4000;
const SECRET = process.env.JWT_SECRET || 'change-this-secret';

// ─── Uploads Directory ────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `ferret-${req.params.id}-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

app.use(express.json());
app.use(cors());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname)));  // serves sanusbio_favicon.svg from app root

// ─── Database ─────────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'sanusbio',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});

// ─── Role Permission Map ──────────────────────────────────────────────────────
const PERMS = {
  admin: new Set(['read', 'write', 'update', 'delete', 'manage_users']),
  research: new Set(['read', 'write', 'update', 'delete']),
  maternity: new Set(['read', 'write', 'update']),
  caretaker: new Set(['read', 'write']),
  cleaner: new Set(['cleaning_report'])
};

function can(role, action) { return PERMS[role]?.has(action) ?? false; }

// ─── Middleware ───────────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No authorization header' });
  const token = header.split(' ')[1];
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

function require_perm(action) {
  return (req, res, next) => {
    if (!can(req.user.role, action))
      return res.status(403).json({ error: `Role '${req.user.role}' cannot perform this action` });
    next();
  };
}

function admin_only(req, res, next) {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
}

function admin_or_research(req, res, next) {
  if (!['admin', 'research'].includes(req.user.role))
    return res.status(403).json({ error: 'Admin or Research access required' });
  next();
}

// Shared "unassigned" address (room_id 0, cage_address 'N/A') — used both
// for brand-new ferrets created without a location, and (as of v1.10.7) for
// ferrets that are marked deceased, so they don't stay parked in a real room.
async function getUnassignedAddressId(conn) {
  const [[existing]] = await conn.query("SELECT address_id FROM address WHERE cage_address = 'N/A' LIMIT 1");
  if (existing) return existing.address_id;
  const [newAddr] = await conn.query("INSERT INTO address (room_id, cage_address) VALUES (0, 'N/A')");
  return newAddr.insertId;
}

async function log_activity(user_id, action, table_name = null, record_id = null, details = null) {
  try {
    await pool.query(
      'INSERT INTO activity_log (user_id, action, table_name, record_id, details) VALUES (?,?,?,?,?)',
      [user_id, action, table_name, record_id, details]
    );
  } catch { /* non-fatal */ }
}

// ─── Serve Frontend ───────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ─── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid username or password' });
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });
    await pool.query('UPDATE users SET last_login = NOW() WHERE user_id = ?', [user.user_id]);
    const token = jwt.sign(
      { user_id: user.user_id, username: user.username, role: user.role, full_name: user.full_name },
      SECRET, { expiresIn: '8h' }
    );
    await log_activity(user.user_id, 'LOGIN', 'users', user.user_id, `${user.username} logged in`);
    res.json({ token, user: { user_id: user.user_id, username: user.username, role: user.role, full_name: user.full_name } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/me', authenticate, (req, res) => res.json(req.user));

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
app.get('/api/dashboard', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [[{ total }]] = await pool.query("SELECT COUNT(*) as total FROM ferret_qr005 WHERE (dead='0' OR dead IS NULL) AND (distributed = 0 OR distributed IS NULL)");
    const [[{ vacc_due }]] = await pool.query("SELECT COUNT(*) as vacc_due FROM ferret_qr005 WHERE next_rabies_vaccine_due <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND (dead='0' OR dead IS NULL)");
    const [[{ litters_this_month }]] = await pool.query("SELECT COUNT(*) as litters_this_month FROM litter_log WHERE litter_date >= DATE_FORMAT(CURDATE(),'%Y-%m-01')");
    const [recent_activity] = await pool.query(`
      SELECT al.action, al.details, al.created_at, u.username
      FROM activity_log al JOIN users u ON al.user_id = u.user_id
      ORDER BY al.created_at DESC LIMIT 10
    `);
    res.json({ total, vacc_due, litters_this_month, recent_activity });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Ferrets ──────────────────────────────────────────────────────────────────
app.get('/api/ferrets', authenticate, require_perm('read'), async (req, res) => {
  try {
    const q = req.query.search ? `%${req.query.search}%` : '%';
    let rows;
    try {
      [rows] = await pool.query(`
        SELECT f.Ferret_QR005_id AS id, f.ferret_name AS name, f.animal_id,
              f.birth_date, f.death_date, f.weight, f.dead, f.description, f.color, f.litter_id,
              f.photo_url, f.mother_name, f.father_name, f.acquisition_by,
              f.next_rabies_vaccine_due, f.sex,
              COALESCE(f.eight_hour_light, 0) AS eight_hour_light,
              f.light_state_since, f.light_mode,
              f.distributed, f.distributor_id, f.female_status, f.breeding_retired,
              f.death_female_status,
              a.cage_address, a.room_id, a.room_name, a.room_lighting,
              s.supplier_name,
              d.distributor_name,
              de.distribution_date
        FROM ferret_qr005 f
        LEFT JOIN address     a ON f.address_id     = a.address_id
        LEFT JOIN supplier    s ON f.supplier_id    = s.supplier_id
        LEFT JOIN distributor d ON f.distributor_id = d.distributor_id
        LEFT JOIN (
          SELECT ferret_id, MAX(distribution_date) AS distribution_date
          FROM distribution_event GROUP BY ferret_id
        ) de ON de.ferret_id = f.Ferret_QR005_id
        WHERE f.ferret_name LIKE ? OR f.animal_id LIKE ?
        ORDER BY f.ferret_name
      `, [q, q]);
    } catch {
      [rows] = await pool.query(`
        SELECT f.Ferret_QR005_id AS id, f.ferret_name AS name, f.animal_id,
               f.birth_date, f.death_date, f.weight, f.dead, f.description, f.color, f.litter_id,
               f.photo_url, f.mother_name, f.father_name, f.acquisition_by,
               f.next_rabies_vaccine_due, f.sex, COALESCE(f.eight_hour_light, 0) AS eight_hour_light,
               f.light_state_since, f.light_mode,
               0 AS distributed, NULL AS distributor_id, 0 AS breeding_retired,
               a.cage_address, a.room_id, a.room_name, a.room_lighting,
               s.supplier_name, NULL AS distributor_name
        FROM ferret_qr005 f
        LEFT JOIN address  a ON f.address_id  = a.address_id
        LEFT JOIN supplier s ON f.supplier_id = s.supplier_id
        WHERE f.ferret_name LIKE ? OR f.animal_id LIKE ?
        ORDER BY f.ferret_name
      `, [q, q]);
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Weight & Grooming Care Alerts ────────────────────────────────────────────
// NOTE: this route MUST be registered before /api/ferrets/:id below — Express
// matches routes in registration order, so if this were placed after :id,
// a request to /api/ferrets/care-alerts would match :id with id="care-alerts"
// and 404 with "Ferret not found" (this was a real bug, fixed 2026-08-05).
app.get('/api/ferrets/care-alerts', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [[settingsRow]] = await pool.query('SELECT * FROM care_schedule_settings WHERE id = 1');
    const s = settingsRow || { nail_trim_interval_days: 180, bath_interval_days: 180, weight_warn_days: 30, weight_critical_days: 45 };

    const [rows] = await pool.query(`
      SELECT f.Ferret_QR005_id AS id, f.ferret_name AS name, f.animal_id, f.birth_date,
             a.room_id, a.room_name, a.cage_address,
             GREATEST(
               COALESCE(lw.last_weight_date, '1900-01-01'),
               COALESCE(len.last_exam_weight_date, '1900-01-01')
             ) AS last_weight_date_raw,
             lb.last_bath_date, lnt.last_nail_trim_date
      FROM ferret_qr005 f
      LEFT JOIN address a ON f.address_id = a.address_id
      LEFT JOIN (SELECT ferret_id, MAX(event_date) AS last_weight_date FROM health_event WHERE event_type = 'weight' GROUP BY ferret_id) lw ON lw.ferret_id = f.Ferret_QR005_id
      LEFT JOIN (SELECT ferret_id, MAX(exam_date) AS last_exam_weight_date FROM exam_note WHERE weight_grams IS NOT NULL GROUP BY ferret_id) len ON len.ferret_id = f.Ferret_QR005_id
      LEFT JOIN (SELECT ferret_id, MAX(event_date) AS last_bath_date FROM health_event WHERE event_type = 'bath' GROUP BY ferret_id) lb ON lb.ferret_id = f.Ferret_QR005_id
      LEFT JOIN (SELECT ferret_id, MAX(event_date) AS last_nail_trim_date FROM health_event WHERE event_type = 'nail_trim' GROUP BY ferret_id) lnt ON lnt.ferret_id = f.Ferret_QR005_id
      WHERE (f.dead = '0' OR f.dead IS NULL) AND (f.distributed = 0 OR f.distributed IS NULL)
    `);

    const today = new Date();
    const daysSince = d => d ? Math.floor((today - new Date(d)) / 864e5) : null;

    const result = rows.map(f => {
      const lastWeightDate = (f.last_weight_date_raw && String(f.last_weight_date_raw).slice(0, 4) !== '1900')
        ? f.last_weight_date_raw : null;
      const weightDays = daysSince(lastWeightDate);
      const bathDays = daysSince(f.last_bath_date);
      const nailDays = daysSince(f.last_nail_trim_date);
      const ageDays = daysSince(f.birth_date);

      let weight_status = 'ok';
      if (weightDays === null) weight_status = 'never';
      else if (weightDays >= s.weight_critical_days) weight_status = 'red';
      else if (weightDays >= s.weight_warn_days) weight_status = 'yellow';

      let nail_status = 'ok';
      if (nailDays === null) { if (ageDays !== null && ageDays >= s.nail_trim_interval_days) nail_status = 'overdue'; }
      else if (nailDays >= s.nail_trim_interval_days) nail_status = 'overdue';

      let bath_status = 'ok';
      if (bathDays === null) { if (ageDays !== null && ageDays >= s.bath_interval_days) bath_status = 'overdue'; }
      else if (bathDays >= s.bath_interval_days) bath_status = 'overdue';

      return {
        id: f.id, name: f.name, animal_id: f.animal_id,
        room_id: f.room_id, room_name: f.room_name, cage_address: f.cage_address,
        last_weight_date: lastWeightDate, weight_days: weightDays, weight_status,
        last_bath_date: f.last_bath_date, bath_days: bathDays, bath_status,
        last_nail_trim_date: f.last_nail_trim_date, nail_days: nailDays, nail_status
      };
    }).filter(f => f.weight_status !== 'ok' || f.nail_status !== 'ok' || f.bath_status !== 'ok');

    res.json({ settings: s, ferrets: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ferrets/:id', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
        SELECT f.*,
              a.cage_address, a.room_id, a.room_lighting, a.maintenance,
              s.supplier_name, s.contact_info, s.supplier_phone_number,
              mi.castrated_or_spayed, mi.castration_or_spay_date,
              mi.treatments, mi.last_exam_date, mi.orders, mi.performed_by,
              mi.weight_loss_or_gain, mi.exam_log, mi.surgical_procedure_log,
              mi.cause_of_death,
              ecl.estrus_status, ecl.in_estrus, ecl.vulva_description,
              ecl.formed_observation, ecl.comments AS estrus_comments,
              COALESCE(rls.eight_hour_light, 0) AS room_eight_hour_light
        FROM ferret_qr005 f
        LEFT JOIN address          a   ON f.address_id          = a.address_id
        LEFT JOIN supplier         s   ON f.supplier_id         = s.supplier_id
        LEFT JOIN medical_info     mi  ON f.medical_info_id     = mi.medical_info_id
        LEFT JOIN estrus_check_log ecl ON f.estrus_check_log_id = ecl.estrus_check_log_id
        LEFT JOIN room_light_schedule rls ON a.room_id = rls.room_id
        WHERE f.Ferret_QR005_id = ?
      `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Ferret not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create ferret
app.post('/api/ferrets', authenticate, async (req, res) => {
  if (!['admin', 'maternity', 'research'].includes(req.user.role))
    return res.status(403).json({ error: 'Only admin, research, and maternity roles can add ferrets' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const {
      ferret_name, animal_id, birth_date, weight = 0, description, color,
      address_id, supplier_id, mother_name, father_name,
      next_rabies_vaccine_due, acquisition_by, photo_url, sex,
      castrated_or_spayed, castration_or_spay_date, litter_id, litter_date
    } = req.body;

    const [mi] = await conn.query('INSERT INTO medical_info (castrated_or_spayed, castration_or_spay_date) VALUES (?,?)',
      [castrated_or_spayed || 'n', castration_or_spay_date || null]);
    const [ec] = await conn.query('INSERT INTO estrus_check_log () VALUES ()');
    const [fm] = await conn.query('INSERT INTO females_to_mate () VALUES ()');
    const [hl] = await conn.query('INSERT INTO health_log () VALUES ()');

    let resolved_address_id = address_id || null;
    if (!resolved_address_id) {
      const [[existing]] = await conn.query("SELECT address_id FROM address WHERE cage_address = 'N/A' LIMIT 1");
      if (existing) { resolved_address_id = existing.address_id; }
      else {
        const [newAddr] = await conn.query("INSERT INTO address (room_id, cage_address) VALUES (0, 'N/A')");
        resolved_address_id = newAddr.insertId;
      }
    }

    let resolved_supplier_id = supplier_id || null;
    if (!resolved_supplier_id) {
      const [[existing]] = await conn.query("SELECT supplier_id FROM supplier WHERE supplier_name = 'Unknown' LIMIT 1");
      if (existing) { resolved_supplier_id = existing.supplier_id; }
      else {
        const [newSup] = await conn.query("INSERT INTO supplier (supplier_name) VALUES ('Unknown')");
        resolved_supplier_id = newSup.insertId;
      }
    }

    const [r] = await conn.query(`
      INSERT INTO ferret_qr005
        (ferret_name, animal_id, birth_date, weight, description, color, address_id,
         medical_info_id, estrus_check_log_id, females_to_mate_id, health_log_id,
         supplier_id, mother_name, father_name, next_rabies_vaccine_due,
         acquisition_by, photo_url, created_by, dead, sex, litter_id, litter_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'','0',?,?,?)
    `, [ferret_name, animal_id || null, birth_date, weight, description || null, color || null,
      resolved_address_id, mi.insertId, ec.insertId, fm.insertId, hl.insertId,
      resolved_supplier_id, mother_name || null, father_name || null,
      next_rabies_vaccine_due || null, acquisition_by || null, photo_url || null,
      sex || null, litter_id || null, litter_date || null]);

    if (resolved_address_id) {
      await conn.query(
        'INSERT INTO ferret_location_history (move_in, ferret_id, address_id) VALUES (?,?,?)',
        [birth_date, r.insertId, resolved_address_id]
      );
    }

    await conn.commit();
    await log_activity(req.user.user_id, 'CREATE', 'ferret_qr005', r.insertId, `Created ferret: ${ferret_name}`);
    res.json({ id: r.insertId, message: 'Ferret created successfully' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Update ferret
app.put('/api/ferrets/:id', authenticate, require_perm('update'), async (req, res) => {
  const allowed = ['ferret_name', 'weight', 'description', 'color', 'dead', 'death_date', 'next_rabies_vaccine_due', 'photo_url', 'acquisition_by', 'sex', 'birth_date'];
  const sets = [], vals = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(req.body[key]); }
  }
  // eight_hour_light added in migration 04 — include only if present in request
  if (req.body.eight_hour_light !== undefined) {
    sets.push('eight_hour_light = ?');
    vals.push(req.body.eight_hour_light ? 1 : 0);
  }
  if (!sets.length) return res.status(400).json({ error: 'No valid fields provided' });
  vals.push(req.params.id);
  try {
    await pool.query(`UPDATE ferret_qr005 SET ${sets.join(', ')} WHERE Ferret_QR005_id = ?`, vals);
    await log_activity(req.user.user_id, 'UPDATE', 'ferret_qr005', req.params.id, `Updated ferret #${req.params.id}`);
    res.json({ message: 'Ferret updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mark ferret deceased (sets dead flag, death_date, and cause_of_death atomically)
app.put('/api/ferrets/:id/deceased', authenticate, require_perm('update'), async (req, res) => {
  const { death_date, cause_of_death } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[before]] = await conn.query(
      'SELECT medical_info_id, ferret_name, sex, female_status, breeding_retired, address_id FROM ferret_qr005 WHERE Ferret_QR005_id = ?',
      [req.params.id]
    );
    if (!before) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Ferret not found' }); }

    // If she's female, currently active on the Reproductive Status Board
    // (non-baseline status, not retired), snapshot that status so it's
    // flagged/queryable that she died while on the board.
    const diedOnBoard = before.sex === 'female'
      && before.female_status && before.female_status !== 'baseline'
      && !before.breeding_retired;

    const deathDateVal = death_date || null;
    const closeDate = deathDateVal || new Date().toISOString().slice(0, 10);

    // Unassign the ferret from its physical room — it moves to the shared
    // "N/A" address (same one new/unassigned ferrets use). Without this,
    // deceased ferrets stay parked in their last room forever, which blocks
    // deleting rooms (DELETE /addresses/:id refuses if any ferret, dead or
    // alive, still references that address_id).
    const unassignedAddrId = await getUnassignedAddressId(conn);

    await conn.query(
      "UPDATE ferret_qr005 SET dead = '1', death_date = ?, death_female_status = ?, address_id = ? WHERE Ferret_QR005_id = ?",
      [deathDateVal, diedOnBoard ? before.female_status : null, unassignedAddrId, req.params.id]
    );
    await conn.query(
      "UPDATE medical_info SET cause_of_death = ?, date_of_death = ?, dead = 'y' WHERE medical_info_id = ?",
      [cause_of_death || null, deathDateVal, before.medical_info_id]
    );

    if (String(before.address_id) !== String(unassignedAddrId)) {
      await conn.query(
        `UPDATE ferret_location_history SET move_out = ?
         WHERE ferret_id = ? AND move_out IS NULL`,
        [closeDate, req.params.id]
      );
      await conn.query(
        'INSERT INTO ferret_location_history (move_in, ferret_id, address_id) VALUES (?,?,?)',
        [closeDate, req.params.id, unassignedAddrId]
      );
    }

    await conn.commit();
    const boardNote = diedOnBoard ? ` — died while ${before.female_status} on the Reproductive Status Board` : '';
    await log_activity(req.user.user_id, 'UPDATE', 'ferret_qr005', req.params.id,
      `Marked deceased: ferret #${req.params.id}${cause_of_death ? ' — ' + cause_of_death : ''}${boardNote} — unassigned from former location`);
    res.json({ message: 'Ferret marked as deceased', died_on_board: diedOnBoard });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Upload photo for a ferret — keeps original, generates 400×400 square thumbnail
app.post('/api/ferrets/:id/photo', authenticate, require_perm('update'), upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const originalUrl = `/uploads/${req.file.filename}`;
    // Build thumbnail filename alongside original
    const ext = path.extname(req.file.filename);
    const base = path.basename(req.file.filename, ext);
    const thumbFilename = `${base}-thumb.jpg`;
    const thumbPath = path.join(UPLOADS_DIR, thumbFilename);
    const thumbUrl = `/uploads/${thumbFilename}`;

    // Generate 400×400 square thumbnail (cover crop, 80% JPEG quality ≈ 80-120 KB)
    await sharp(req.file.path)
      .resize(400, 400, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);

    // Delete old files if they exist
    const [[ferret]] = await pool.query('SELECT photo_url, photo_original_url FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]);
    for (const url of [ferret?.photo_url, ferret?.photo_original_url]) {
      if (url?.startsWith('/uploads/')) {
        const p = path.join(__dirname, url);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }

    await pool.query(
      'UPDATE ferret_qr005 SET photo_url = ?, photo_original_url = ? WHERE Ferret_QR005_id = ?',
      [thumbUrl, originalUrl, req.params.id]
    );
    await log_activity(req.user.user_id, 'PHOTO_UPLOAD', 'ferret_qr005', req.params.id, `Photo updated for ferret #${req.params.id}`);
    res.json({ photo_url: thumbUrl, photo_original_url: originalUrl, message: 'Photo uploaded' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Download original full-resolution photo
app.get('/api/ferrets/:id/photo/original', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [[ferret]] = await pool.query(
      'SELECT photo_original_url, ferret_name FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]
    );
    if (!ferret || !ferret.photo_original_url) return res.status(404).json({ error: 'No original photo found' });
    const filePath = path.join(__dirname, ferret.photo_original_url);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Original photo file not found on disk' });
    const safeName = ferret.ferret_name.replace(/[^a-z0-9]/gi, '_');
    res.download(filePath, `${safeName}_original${path.extname(filePath)}`);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Change ferret location
app.put('/api/ferrets/:id/location', authenticate, async (req, res) => {
  const { address_id, position, move_date } = req.body;
  if (!address_id) return res.status(400).json({ error: 'address_id required' });
  const moveDate = move_date || new Date().toISOString().slice(0, 10);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[ferret]] = await conn.query(
      'SELECT dead, distributed, light_mode, address_id FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]
    );
    if (!ferret) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Ferret not found' }); }
    if (ferret.dead === '1') { await conn.rollback(); conn.release(); return res.status(400).json({ error: 'Cannot change location of a deceased ferret' }); }
    if (ferret.distributed) { await conn.rollback(); conn.release(); return res.status(400).json({ error: 'Cannot change location of a distributed ferret' }); }

    await conn.query('UPDATE ferret_qr005 SET address_id = ? WHERE Ferret_QR005_id = ?', [address_id, req.params.id]);
    if (position !== undefined) {
      await conn.query('UPDATE address SET room_lighting = ? WHERE address_id = ?', [position || null, address_id]);
    }

    // Location history: close out the currently-open row (if any) and open a
    // new one for the destination, so every former room stays viewable.
    if (String(ferret.address_id) !== String(address_id)) {
      await conn.query(
        `UPDATE ferret_location_history SET move_out = ?
         WHERE ferret_id = ? AND move_out IS NULL`,
        [moveDate, req.params.id]
      );
      await conn.query(
        'INSERT INTO ferret_location_history (move_in, ferret_id, address_id) VALUES (?,?,?)',
        [moveDate, req.params.id, address_id]
      );
    }

    // Auto light-cycle sync: adopt the destination room's current schedule,
    // dated to the move (not necessarily today, if this is being logged after the fact)
    if (ferret.light_mode !== 'manual') {
      const [[destRoom]] = await conn.query(`
        SELECT rls.eight_hour_light
        FROM address a LEFT JOIN room_light_schedule rls ON a.room_id = rls.room_id
        WHERE a.address_id = ?`, [address_id]);
      await conn.query(
        'UPDATE ferret_qr005 SET eight_hour_light = ?, light_state_since = ? WHERE Ferret_QR005_id = ?',
        [destRoom?.eight_hour_light ? 1 : 0, moveDate, req.params.id]
      );
    }
    await conn.commit();
    await log_activity(req.user.user_id, 'MOVE', 'ferret_qr005', req.params.id,
      `Moved ferret #${req.params.id} to address #${address_id}${position ? ' · ' + position : ''} (moved ${moveDate})`);
    res.json({ message: 'Location updated' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Location history for a ferret — every former room, most recent first
app.get('/api/ferrets/:id/location-history', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT flh.location_event_id, flh.move_in, flh.move_out,
             a.address_id, a.room_id, a.room_name, a.cage_address, a.room_lighting
      FROM ferret_location_history flh
      LEFT JOIN address a ON flh.address_id = a.address_id
      WHERE flh.ferret_id = ?
      ORDER BY flh.move_in DESC, flh.location_event_id DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Set a ferret's light-cycle mode/state — 'manual' lets staff set the exact
// cycle and since-date directly; 'auto' immediately resyncs from the ferret's
// current room and hands control back to room moves / room toggles
app.put('/api/ferrets/:id/light-cycle', authenticate, require_perm('update'), async (req, res) => {
  const { light_mode, eight_hour_light, light_state_since } = req.body;
  if (!['auto', 'manual'].includes(light_mode)) return res.status(400).json({ error: 'Invalid light_mode' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (light_mode === 'manual') {
      if (eight_hour_light === undefined || !light_state_since) {
        await conn.rollback(); conn.release();
        return res.status(400).json({ error: 'eight_hour_light and light_state_since are required for manual mode' });
      }
      await conn.query(
        "UPDATE ferret_qr005 SET light_mode = 'manual', eight_hour_light = ?, light_state_since = ? WHERE Ferret_QR005_id = ?",
        [eight_hour_light ? 1 : 0, light_state_since, req.params.id]
      );
    } else {
      const [[room]] = await conn.query(`
        SELECT rls.eight_hour_light, rls.light_state_since
        FROM ferret_qr005 f
        LEFT JOIN address a ON f.address_id = a.address_id
        LEFT JOIN room_light_schedule rls ON a.room_id = rls.room_id
        WHERE f.Ferret_QR005_id = ?`, [req.params.id]);
      const today = new Date().toISOString().slice(0, 10);
      await conn.query(
        "UPDATE ferret_qr005 SET light_mode = 'auto', eight_hour_light = ?, light_state_since = ? WHERE Ferret_QR005_id = ?",
        [room?.eight_hour_light ? 1 : 0, room?.light_state_since || today, req.params.id]
      );
    }
    await conn.commit();
    await log_activity(req.user.user_id, 'UPDATE', 'ferret_qr005', req.params.id,
      `Light cycle mode set to ${light_mode} for ferret #${req.params.id}`);
    res.json({ message: 'Light cycle updated' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Delete ferret (cleans up all dependent records first to avoid FK constraint errors)
app.delete('/api/ferrets/:id', authenticate, admin_only, async (req, res) => {
  const id = req.params.id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[ferret]] = await conn.query('SELECT ferret_name FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [id]);
    if (!ferret) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Ferret not found' }); }

    // Clear self-referencing parent links (in case this ferret is listed as another's mother/father)
    await conn.query('UPDATE ferret_qr005 SET mother_id = NULL WHERE mother_id = ?', [id]);
    await conn.query('UPDATE ferret_qr005 SET father_id = NULL WHERE father_id = ?', [id]);

    // Clear reproductive_event partner references
    await conn.query('UPDATE reproductive_event SET partner_id = NULL WHERE partner_id = ?', [id]);

    // Delete all dependent child records
<<<<<<< Updated upstream
    await conn.query('DELETE FROM assignments WHERE ferret_id = ?', [id]);
=======
>>>>>>> Stashed changes
    await conn.query('DELETE FROM ferret_location_history WHERE ferret_id = ?', [id]);
    await conn.query('DELETE FROM health_event WHERE ferret_id = ?', [id]);
    await conn.query('DELETE FROM litter_log WHERE Ferret_QR005_id = ?', [id]);
    await conn.query('DELETE FROM rfid_assignment WHERE ferret_id = ?', [id]);
    await conn.query('DELETE FROM vaccination_event WHERE ferret_id = ?', [id]);
    await conn.query('DELETE FROM distribution_event WHERE ferret_id = ?', [id]);
    await conn.query('DELETE FROM reproductive_event WHERE ferret_id = ?', [id]);
<<<<<<< Updated upstream
    try {
      await conn.query('DELETE FROM `estrus_&_mating_summary` WHERE Ferret_QR005_id = ?', [id]);
    } catch { /* table may not exist on every deployment — non-fatal */ }
=======
>>>>>>> Stashed changes

    await conn.query('DELETE FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [id]);

    await conn.commit();
    await log_activity(req.user.user_id, 'DELETE', 'ferret_qr005', id, `Deleted ferret: ${ferret.ferret_name} (#${id})`);
    res.json({ message: 'Ferret deleted' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Ferret activity history
app.get('/api/ferrets/:id/history', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT al.log_id, al.action, al.table_name, al.details, al.created_at, u.username
      FROM activity_log al
      JOIN users u ON al.user_id = u.user_id
      WHERE al.record_id = ? AND al.table_name IN ('ferret_qr005','health_event','vaccination_event','litter_log','medical_info')
      ORDER BY al.created_at DESC
      LIMIT 200
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Health Events ────────────────────────────────────────────────────────────
app.get('/api/ferrets/:id/health', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM health_event WHERE ferret_id = ? ORDER BY event_date DESC', [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/health-events', authenticate, require_perm('write'), async (req, res) => {
  const { ferret_id, event_type, weight, event_date, event_time, notes } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const weightVal = (event_type === 'weight' && weight != null) ? parseFloat(weight) : null;
    if (event_type === 'weight' && (isNaN(weightVal) || weightVal < 0 || weightVal > 9999.99)) {
      await conn.rollback(); conn.release();
      return res.status(400).json({ error: 'Weight must be between 0 and 9999.99 grams' });
    }
    const timeLabel = event_time ? ` at ${event_time}` : '';
    const fullNotes = notes ? `[${event_date}${timeLabel}] ${notes}` : (event_time ? `[${event_date}${timeLabel}]` : null);
    const [r] = await conn.query(
      'INSERT INTO health_event (ferret_id, event_type, weight, event_date, notes, recorded_by) VALUES (?,?,?,?,?,?)',
      [ferret_id, event_type, weightVal, event_date, fullNotes, req.user.username]
    );
    if (event_type === 'weight' && weightVal != null) {
      await conn.query('UPDATE ferret_qr005 SET weight = ? WHERE Ferret_QR005_id = ?', [Math.round(weightVal), ferret_id]);
    }
    await conn.commit();
    await log_activity(req.user.user_id, 'CREATE', 'health_event', ferret_id, `${event_type} for ferret #${ferret_id}`);
    res.json({ id: r.insertId, message: 'Health event recorded' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Edit a health event — primarily for correcting event_date entry errors,
// but also allows fixing weight/notes. Restricted to admin/research/maternity.
app.put('/api/health-events/:id', authenticate, require_perm('update'), async (req, res) => {
  const { event_date, weight, notes } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[existing]] = await conn.query('SELECT * FROM health_event WHERE health_event_id = ?', [req.params.id]);
    if (!existing) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Health event not found' }); }

    const sets = [], vals = [];
    if (event_date !== undefined && event_date) { sets.push('event_date = ?'); vals.push(event_date); }
    if (notes !== undefined) { sets.push('notes = ?'); vals.push(notes || null); }

    let weightVal = existing.weight;
    if (weight !== undefined && existing.event_type === 'weight') {
      weightVal = parseFloat(weight);
      if (isNaN(weightVal) || weightVal < 0 || weightVal > 9999.99) {
        await conn.rollback(); conn.release();
        return res.status(400).json({ error: 'Weight must be between 0 and 9999.99 grams' });
      }
      sets.push('weight = ?'); vals.push(weightVal);
    }
    if (!sets.length) { await conn.rollback(); conn.release(); return res.status(400).json({ error: 'Nothing to update' }); }

    vals.push(req.params.id);
    await conn.query(`UPDATE health_event SET ${sets.join(', ')} WHERE health_event_id = ?`, vals);

    // Keep ferret_qr005.weight in sync if this was (or still is) the most
    // recent weight entry for the ferret.
    if (existing.event_type === 'weight') {
      const [[latest]] = await conn.query(
        `SELECT health_event_id, weight FROM health_event WHERE ferret_id = ? AND event_type = 'weight'
         ORDER BY event_date DESC, health_event_id DESC LIMIT 1`,
        [existing.ferret_id]
      );
      if (latest && latest.health_event_id == req.params.id) {
        await conn.query('UPDATE ferret_qr005 SET weight = ? WHERE Ferret_QR005_id = ?', [Math.round(weightVal), existing.ferret_id]);
      }
    }

    await conn.commit();
    await log_activity(req.user.user_id, 'UPDATE', 'health_event', req.params.id,
      `Edited health event #${req.params.id} for ferret #${existing.ferret_id}`);
    res.json({ message: 'Health event updated' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Delete a health event — restricted to admin/research/maternity.
app.delete('/api/health-events/:id', authenticate, require_perm('update'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[existing]] = await conn.query('SELECT * FROM health_event WHERE health_event_id = ?', [req.params.id]);
    if (!existing) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Health event not found' }); }

    await conn.query('DELETE FROM health_event WHERE health_event_id = ?', [req.params.id]);

    // If the deleted row was a weight entry, resync ferret_qr005.weight to
    // whatever is now the most recent remaining weight entry (if any).
    if (existing.event_type === 'weight') {
      const [[latest]] = await conn.query(
        `SELECT weight FROM health_event WHERE ferret_id = ? AND event_type = 'weight'
         ORDER BY event_date DESC, health_event_id DESC LIMIT 1`,
        [existing.ferret_id]
      );
      if (latest) {
        await conn.query('UPDATE ferret_qr005 SET weight = ? WHERE Ferret_QR005_id = ?', [Math.round(latest.weight), existing.ferret_id]);
      }
    }

    await conn.commit();
    await log_activity(req.user.user_id, 'DELETE', 'health_event', req.params.id,
      `Deleted health event #${req.params.id} for ferret #${existing.ferret_id}`);
    res.json({ message: 'Health event deleted' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// ─── Vaccinations ─────────────────────────────────────────────────────────────
app.get('/api/ferrets/:id/vaccinations', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM vaccination_event WHERE ferret_id = ? ORDER BY vaccination_date DESC', [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vaccinations', authenticate, async (req, res) => {
  if (!['admin', 'maternity', 'research'].includes(req.user.role))
    return res.status(403).json({ error: 'Only admin, research, and maternity can record vaccinations' });
  const { ferret_id, vaccine_type, vaccination_date, expiration_date, notes, next_rabies_due, administered_by } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      'INSERT INTO vaccination_event (ferret_id, vaccine_type, vaccination_date, expiration_date, notes, recorded_by, administered_by) VALUES (?,?,?,?,?,?,?)',
      [ferret_id, vaccine_type, vaccination_date, expiration_date || null, notes || null, req.user.username, administered_by || null]
    );
    if (vaccine_type === 'rabies' && next_rabies_due) {
      await conn.query('UPDATE ferret_qr005 SET next_rabies_vaccine_due = ? WHERE Ferret_QR005_id = ?', [next_rabies_due, ferret_id]);
    }
    await conn.commit();
    await log_activity(req.user.user_id, 'CREATE', 'vaccination_event', ferret_id, `${vaccine_type} vaccine for ferret #${ferret_id}`);
    res.json({ id: r.insertId, message: 'Vaccination recorded' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// ─── Medical Info ─────────────────────────────────────────────────────────────
app.put('/api/ferrets/:id/medical', authenticate, require_perm('update'), async (req, res) => {
  const { castrated_or_spayed, castration_or_spay_date, last_exam_date, performed_by, exam_log, orders, treatments } = req.body;
  try {
    const [[ferret]] = await pool.query('SELECT medical_info_id FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]);
    if (!ferret) return res.status(404).json({ error: 'Ferret not found' });
    const sets = [], vals = [];
    if (castrated_or_spayed !== undefined) { sets.push('castrated_or_spayed = ?'); vals.push(castrated_or_spayed); }
    if (castration_or_spay_date !== undefined) { sets.push('castration_or_spay_date = ?'); vals.push(castration_or_spay_date || null); }
    if (last_exam_date !== undefined) { sets.push('last_exam_date = ?'); vals.push(last_exam_date || null); }
    if (performed_by !== undefined) { sets.push('performed_by = ?'); vals.push(performed_by || null); }
    if (exam_log !== undefined) { sets.push('exam_log = ?'); vals.push(exam_log || null); }
    if (orders !== undefined) { sets.push('orders = ?'); vals.push(orders || null); }
    if (treatments !== undefined) { sets.push('treatments = ?'); vals.push(treatments || null); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(ferret.medical_info_id);
    await pool.query(`UPDATE medical_info SET ${sets.join(', ')} WHERE medical_info_id = ?`, vals);
    await log_activity(req.user.user_id, 'UPDATE', 'medical_info', req.params.id, `Medical info updated for ferret #${req.params.id}`);
    res.json({ message: 'Medical info updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Exam / Health Check Notes (full dated history) ───────────────────────────
app.get('/api/ferrets/:id/exam-notes', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM exam_note WHERE ferret_id = ? ORDER BY exam_date DESC, exam_note_id DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ferrets/:id/exam-notes', authenticate, require_perm('update'), async (req, res) => {
  const { exam_date, weight_grams, status, notes, performed_by } = req.body;
  if (!exam_date) return res.status(400).json({ error: 'exam_date is required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[ferret]] = await conn.query(
      'SELECT medical_info_id, ferret_name FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]
    );
    if (!ferret) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Ferret not found' }); }

    const wt = (weight_grams != null && weight_grams !== '') ? parseInt(weight_grams) : null;

    const [r] = await conn.query(
      'INSERT INTO exam_note (ferret_id, exam_date, weight_grams, status, notes, performed_by, recorded_by) VALUES (?,?,?,?,?,?,?)',
      [req.params.id, exam_date, wt, status || null, notes || null, performed_by || null, req.user.username]
    );

    // Keep medical_info's "current status" fields synced to the latest note
    await conn.query(
      'UPDATE medical_info SET last_exam_date = ?, performed_by = ?, exam_log = ? WHERE medical_info_id = ?',
      [exam_date, performed_by || null, notes || null, ferret.medical_info_id]
    );

    if (wt != null && !isNaN(wt)) {
      await conn.query('UPDATE ferret_qr005 SET weight = ? WHERE Ferret_QR005_id = ?', [wt, req.params.id]);
    }

    await conn.commit();
    await log_activity(req.user.user_id, 'EXAM_NOTE', 'exam_note', req.params.id,
      `Exam note recorded for ${ferret.ferret_name} on ${exam_date}`);
    res.json({ id: r.insertId, message: 'Exam note recorded' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

app.post('/api/ferrets/:id/procedure', authenticate, require_perm('update'), async (req, res) => {
  const { procedure_name, procedure_date, performed_by, notes } = req.body;
  if (!procedure_name || !procedure_date) return res.status(400).json({ error: 'procedure_name and procedure_date are required' });
  try {
    const [[ferret]] = await pool.query('SELECT medical_info_id FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]);
    if (!ferret) return res.status(404).json({ error: 'Ferret not found' });
    const [[mi]] = await pool.query('SELECT surgical_procedure_log FROM medical_info WHERE medical_info_id = ?', [ferret.medical_info_id]);
    const entry = `[${procedure_date}] ${procedure_name}${performed_by ? ' — ' + performed_by : ''}${notes ? ': ' + notes : ''}`;
    const updated = mi.surgical_procedure_log ? mi.surgical_procedure_log + '\n' + entry : entry;
    await pool.query('UPDATE medical_info SET surgical_procedure_log = ? WHERE medical_info_id = ?', [updated, ferret.medical_info_id]);
    await log_activity(req.user.user_id, 'PROCEDURE', 'medical_info', req.params.id, `Logged procedure for ferret #${req.params.id}: ${procedure_name}`);
    res.json({ message: 'Procedure logged' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Litter Logs ──────────────────────────────────────────────────────────────
// All litters (for the Litters page)
app.get('/api/litters', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ll.*, f.ferret_name AS jill_name, f.Ferret_QR005_id AS ferret_id
      FROM litter_log ll
      JOIN ferret_qr005 f ON ll.Ferret_QR005_id = f.Ferret_QR005_id
      ORDER BY ll.litter_date DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Litters for a specific ferret
app.get('/api/ferrets/:id/litters', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM litter_log WHERE Ferret_QR005_id = ? ORDER BY litter_date DESC', [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Litters a male ferret helped produce — litter_log.father is a free-text
// field (no father_id column exists), so we match it against this ferret's
// current name. Renaming a ferret after litters are logged would break the
// match for those older rows; that's a pre-existing data-model limitation.
app.get('/api/ferrets/:id/litters-as-father', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [[ferret]] = await pool.query('SELECT ferret_name FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]);
    if (!ferret) return res.status(404).json({ error: 'Ferret not found' });
    const [rows] = await pool.query(`
      SELECT ll.*, f.ferret_name AS jill_name, f.Ferret_QR005_id AS ferret_id
      FROM litter_log ll
      JOIN ferret_qr005 f ON ll.Ferret_QR005_id = f.Ferret_QR005_id
      WHERE ll.father = ?
      ORDER BY ll.litter_date DESC
    `, [ferret.ferret_name]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create litter
app.post('/api/litters', authenticate, async (req, res) => {
  if (!['admin', 'maternity', 'research'].includes(req.user.role))
    return res.status(403).json({ error: 'Only admin, research, and maternity can add litter records' });
  const { Ferret_QR005_id, litter_id, litter_date, kit_count, stillborn, father, mother, anomalies_and_notes } = req.body;
  const kc = kit_count || null;
  const sb = stillborn || null;
  // Stillborn kits are never individuated, so they shouldn't count toward
  // the number of kits left to create — seed surviving_litter_count now.
  const survivingCount = kc != null ? Math.max(0, kc - (sb || 0)) : null;
  try {
    const [r] = await pool.query(
      `INSERT INTO litter_log (Ferret_QR005_id, litter_id, litter_date, kit_count, stillborn,
        surviving_litter_count, father, mother, anomalies_and_notes, created, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,CURDATE(),?)`,
      [Ferret_QR005_id, litter_id || null, litter_date, kc,
        sb, survivingCount, father || null, mother || null,
        anomalies_and_notes || null, req.user.username]
    );
    await log_activity(req.user.user_id, 'CREATE', 'litter_log', Ferret_QR005_id, `Litter recorded for ferret #${Ferret_QR005_id} — ${kit_count || 0} kits`);
    res.json({ id: r.insertId, message: 'Litter recorded' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update litter
app.put('/api/litters/:id', authenticate, require_perm('update'), async (req, res) => {
  const allowed = ['litter_id', 'litter_date', 'kit_count', 'stillborn', 'infant_deaths', 'surviving_litter_count', 'father', 'mother', 'anomalies_and_notes'];
  const sets = [], vals = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(req.body[key]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  try {
    // If kit_count/stillborn changed but surviving_litter_count wasn't explicitly
    // sent, recompute it so stillborn kits keep being excluded from the create count.
    if ((req.body.kit_count !== undefined || req.body.stillborn !== undefined) && req.body.surviving_litter_count === undefined) {
      const [[current]] = await pool.query('SELECT kit_count, stillborn, infant_deaths FROM litter_log WHERE litter_log_id = ?', [req.params.id]);
      if (current) {
        const kc = req.body.kit_count !== undefined ? req.body.kit_count : current.kit_count;
        const sb = req.body.stillborn !== undefined ? req.body.stillborn : current.stillborn;
        if (kc != null) {
          const surviving = Math.max(0, kc - (sb || 0) - (current.infant_deaths || 0));
          sets.push('surviving_litter_count = ?'); vals.push(surviving);
        }
      }
    }
    vals.push(req.params.id);
    await pool.query(`UPDATE litter_log SET ${sets.join(', ')} WHERE litter_log_id = ?`, vals);
    res.json({ message: 'Litter updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create ferrets from a litter
app.post('/api/litters/:id/create-ferrets', authenticate, async (req, res) => {
  if (!['admin', 'maternity', 'research'].includes(req.user.role))
    return res.status(403).json({ error: 'Only admin, research, and maternity can create ferrets from litters' });
  const { kits } = req.body; // Array of { ferret_name, sex, weight, animal_id }
  if (!Array.isArray(kits) || !kits.length) return res.status(400).json({ error: 'kits array is required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Get litter info
    const [[litter]] = await conn.query(`
      SELECT ll.*, f.ferret_name AS mother_name, f.address_id, f.supplier_id
      FROM litter_log ll
      JOIN ferret_qr005 f ON ll.Ferret_QR005_id = f.Ferret_QR005_id
      WHERE ll.litter_log_id = ?
    `, [req.params.id]);
    if (!litter) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Litter not found' }); }

    const created = [];
    for (const kit of kits) {
      const [mi] = await conn.query('INSERT INTO medical_info (castrated_or_spayed) VALUES (?)', ['n']);
      const [ec] = await conn.query('INSERT INTO estrus_check_log () VALUES ()');
      const [fm] = await conn.query('INSERT INTO females_to_mate () VALUES ()');
      const [hl] = await conn.query('INSERT INTO health_log () VALUES ()');

      const [r] = await conn.query(`
        INSERT INTO ferret_qr005
          (ferret_name, animal_id, birth_date, weight, address_id,
           medical_info_id, estrus_check_log_id, females_to_mate_id, health_log_id,
           supplier_id, mother_name, father_name, litter_id, litter_date,
           created_by, dead, sex)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'0',?)
      `, [
        kit.ferret_name, kit.animal_id || null, litter.litter_date, kit.weight || 0,
        litter.address_id, mi.insertId, ec.insertId, fm.insertId, hl.insertId,
        litter.supplier_id, litter.mother_name || null, litter.father || null,
        litter.litter_id || null, litter.litter_date,
        req.user.username, kit.sex || null
      ]);
      created.push(r.insertId);
      await log_activity(req.user.user_id, 'CREATE', 'ferret_qr005', r.insertId, `Created from litter #${req.params.id}: ${kit.ferret_name}`);
    }

    // Update individuals_created count on litter
    await conn.query('UPDATE litter_log SET individuals_created = ? WHERE litter_log_id = ?', [created.length, req.params.id]);
    await conn.commit();
    res.json({ created_ids: created, message: `${created.length} ferret(s) created from litter` });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// ─── Litter Kit Deaths (pre-ID kit deaths) ────────────────────────────────────
app.get('/api/litters/:id/kit-deaths', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM litter_kit_death WHERE litter_log_id = ? ORDER BY death_date DESC, kit_death_id DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/litters/:id/kit-deaths', authenticate, async (req, res) => {
  if (!['admin', 'maternity', 'research'].includes(req.user.role))
    return res.status(403).json({ error: 'Only admin, research, and maternity can log kit deaths' });
  const { death_date, cause_category, notes, treatments } = req.body;
  const VALID_CAUSES = ['mother_ate', 'fell_from_cage', 'crushed', 'failure_to_thrive', 'unknown', 'other'];
  if (!death_date) return res.status(400).json({ error: 'death_date is required' });
  if (!VALID_CAUSES.includes(cause_category)) return res.status(400).json({ error: 'Invalid cause_category' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[litter]] = await conn.query('SELECT * FROM litter_log WHERE litter_log_id = ?', [req.params.id]);
    if (!litter) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Litter not found' }); }

    const [r] = await conn.query(
      'INSERT INTO litter_kit_death (litter_log_id, death_date, cause_category, notes, treatments, recorded_by) VALUES (?,?,?,?,?,?)',
      [req.params.id, death_date, cause_category, notes || null, treatments || null, req.user.username]
    );

    // Keep infant_deaths / surviving_litter_count in sync with the death log
    const newInfantDeaths = (litter.infant_deaths || 0) + 1;
    const surviving = litter.kit_count != null
      ? Math.max(0, litter.kit_count - (litter.stillborn || 0) - newInfantDeaths)
      : null;
    await conn.query(
      'UPDATE litter_log SET infant_deaths = ?, surviving_litter_count = ? WHERE litter_log_id = ?',
      [newInfantDeaths, surviving, req.params.id]
    );

    await conn.commit();
    await log_activity(req.user.user_id, 'KIT_DEATH', 'litter_kit_death', r.insertId,
      `Kit death logged for litter #${req.params.id}: ${cause_category}`);
    res.json({ id: r.insertId, message: 'Kit death recorded' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

app.delete('/api/litters/:id/kit-deaths/:deathId', authenticate, admin_only, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[litter]] = await conn.query('SELECT * FROM litter_log WHERE litter_log_id = ?', [req.params.id]);
    if (!litter) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Litter not found' }); }
    const [result] = await conn.query(
      'DELETE FROM litter_kit_death WHERE kit_death_id = ? AND litter_log_id = ?',
      [req.params.deathId, req.params.id]
    );
    if (!result.affectedRows) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Kit death record not found' }); }

    const newInfantDeaths = Math.max(0, (litter.infant_deaths || 0) - 1);
    const surviving = litter.kit_count != null
      ? Math.max(0, litter.kit_count - (litter.stillborn || 0) - newInfantDeaths)
      : null;
    await conn.query(
      'UPDATE litter_log SET infant_deaths = ?, surviving_litter_count = ? WHERE litter_log_id = ?',
      [newInfantDeaths, surviving, req.params.id]
    );

    await conn.commit();
    await log_activity(req.user.user_id, 'DELETE', 'litter_kit_death', req.params.deathId,
      `Kit death record deleted for litter #${req.params.id}`);
    res.json({ message: 'Kit death record deleted' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// ─── Litter Care Log (maternity: weighing, nest changes, supplemental feeding) ─
app.get('/api/litters/:id/care-events', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM litter_care_event WHERE litter_log_id = ? ORDER BY event_date DESC, care_event_id DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/litters/:id/care-events', authenticate, async (req, res) => {
  if (!['admin', 'maternity', 'research'].includes(req.user.role))
    return res.status(403).json({ error: 'Only admin, research, and maternity can log litter care events' });
  const { event_type, event_date, weight_grams, kit_count, feed_type, notes } = req.body;
  const VALID_TYPES = ['weight', 'nest_change', 'supplemental_feeding', 'feeding_check', 'other'];
  if (!VALID_TYPES.includes(event_type)) return res.status(400).json({ error: 'Invalid event_type' });
  if (!event_date) return res.status(400).json({ error: 'event_date is required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[litter]] = await conn.query('SELECT * FROM litter_log WHERE litter_log_id = ?', [req.params.id]);
    if (!litter) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Litter not found' }); }

    const wt = (weight_grams != null && weight_grams !== '') ? parseInt(weight_grams) : null;
    const kc = (kit_count != null && kit_count !== '') ? parseInt(kit_count) : null;

    const [r] = await conn.query(
      `INSERT INTO litter_care_event (litter_log_id, event_type, event_date, weight_grams, kit_count, feed_type, notes, recorded_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.params.id, event_type, event_date, wt, kc, feed_type || null, notes || null, req.user.username]
    );

    // Keep litter_log's summary fields in sync for at-a-glance display / growth-rate calc
    if (event_type === 'weight' && wt != null) {
      await conn.query(
        `UPDATE litter_log SET
           previous_weight_grams = last_weight_grams,
           previous_weigh_date   = last_weigh_date,
           last_weight_grams     = ?,
           last_weigh_date       = ?
         WHERE litter_log_id = ?`,
        [wt, event_date, req.params.id]
      );
    } else if (event_type === 'nest_change') {
      const entry = `[${event_date}] Nest/litter box changed${notes ? ' — ' + notes : ''}`;
      const updated = litter.nest_box_change_log ? litter.nest_box_change_log + '\n' + entry : entry;
      await conn.query(
        `UPDATE litter_log SET nest_litter_changed = ?, change_nest_litter_box = 1, nest_box_change_log = ?
         WHERE litter_log_id = ?`,
        [event_date, updated, req.params.id]
      );
    } else if (event_type === 'supplemental_feeding') {
      const entry = `[${event_date}] ${feed_type || 'Supplemental feeding'}${kc != null ? ' — ' + kc + ' kit(s)' : ''}${notes ? ': ' + notes : ''}`;
      const updated = litter.syringe_feeding_log ? litter.syringe_feeding_log + '\n' + entry : entry;
      await conn.query(
        `UPDATE litter_log SET support_feeding = 'y', support_feed_type = ?, syringe_feeding_log = ?
         WHERE litter_log_id = ?`,
        [feed_type || null, updated, req.params.id]
      );
    } else {
      const entry = `[${event_date}] ${event_type.replace('_', ' ')}${notes ? ' — ' + notes : ''}`;
      const updated = litter.event_history ? litter.event_history + '\n' + entry : entry;
      await conn.query('UPDATE litter_log SET event_history = ? WHERE litter_log_id = ?', [updated, req.params.id]);
    }

    await conn.commit();
    await log_activity(req.user.user_id, 'LITTER_CARE', 'litter_care_event', r.insertId,
      `${event_type} logged for litter #${req.params.id}`);
    res.json({ id: r.insertId, message: 'Care event recorded' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

app.delete('/api/litters/:id/care-events/:eventId', authenticate, admin_only, async (req, res) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM litter_care_event WHERE care_event_id = ? AND litter_log_id = ?',
      [req.params.eventId, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Care event not found' });
    await log_activity(req.user.user_id, 'DELETE', 'litter_care_event', req.params.eventId,
      `Care event deleted for litter #${req.params.id}`);
    res.json({ message: 'Care event deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Suppliers ────────────────────────────────────────────────────────────────
app.get('/api/suppliers', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, COUNT(f.Ferret_QR005_id) AS ferret_count
      FROM supplier s
      LEFT JOIN ferret_qr005 f ON s.supplier_id = f.supplier_id
      GROUP BY s.supplier_id
      ORDER BY s.supplier_name
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/suppliers', authenticate, admin_or_research, async (req, res) => {
  const { supplier_name, contact_info, supplier_address, supplier_phone_number } = req.body;
  if (!supplier_name) return res.status(400).json({ error: 'supplier_name is required' });
  try {
    const [r] = await pool.query(
      'INSERT INTO supplier (supplier_name, contact_info, supplier_address, supplier_phone_number) VALUES (?,?,?,?)',
      [supplier_name, contact_info || null, supplier_address || null,
        supplier_phone_number ? supplier_phone_number.toString().replace(/\D/g, '').substring(0, 15) : null]
    );
    await log_activity(req.user.user_id, 'CREATE', 'supplier', r.insertId, `Added supplier: ${supplier_name}`);
    res.json({ id: r.insertId, message: 'Supplier added' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/suppliers/:id', authenticate, admin_or_research, async (req, res) => {
  const { supplier_name, contact_info, supplier_address, supplier_phone_number } = req.body;
  const sets = [], vals = [];
  if (supplier_name !== undefined) { sets.push('supplier_name = ?'); vals.push(supplier_name); }
  if (contact_info !== undefined) { sets.push('contact_info = ?'); vals.push(contact_info || null); }
  if (supplier_address !== undefined) { sets.push('supplier_address = ?'); vals.push(supplier_address || null); }
  if (supplier_phone_number !== undefined) { sets.push('supplier_phone_number = ?'); vals.push(supplier_phone_number || null); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  try {
    await pool.query(`UPDATE supplier SET ${sets.join(', ')} WHERE supplier_id = ?`, vals);
    await log_activity(req.user.user_id, 'UPDATE', 'supplier', req.params.id, `Updated supplier #${req.params.id}`);
    res.json({ message: 'Supplier updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/suppliers/:id', authenticate, admin_only, async (req, res) => {
  try {
    await pool.query('DELETE FROM supplier WHERE supplier_id = ?', [req.params.id]);
    await log_activity(req.user.user_id, 'DELETE', 'supplier', req.params.id, `Deleted supplier #${req.params.id}`);
    res.json({ message: 'Supplier deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Addresses ────────────────────────────────────────────────────────────────
app.get('/api/addresses', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM address ORDER BY room_id, cage_address');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/addresses', authenticate, admin_or_research, async (req, res) => {
  const { room_id, room_name, cage_address, room_lighting, maintenance } = req.body;
  try {
    const [r] = await pool.query(
      'INSERT INTO address (room_id, room_name, cage_address, room_lighting, maintenance) VALUES (?,?,?,?,?)',
      [room_id, room_name || null, cage_address || null, room_lighting || null, maintenance || null]
    );
    res.json({ id: r.insertId, message: 'Address added' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/addresses/:id', authenticate, admin_only, async (req, res) => {
  try {
    // Block delete if any ferrets (including deceased/distributed) are still assigned here
    const [[{ cnt }]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM ferret_qr005 WHERE address_id = ?', [req.params.id]
    );
    if (cnt > 0)
      return res.status(400).json({ error: `Cannot delete — ${cnt} ferret(s) are still assigned to this location. Move or delete them first.` });
    const [[addr]] = await pool.query('SELECT room_id, cage_address FROM address WHERE address_id = ?', [req.params.id]);
    if (!addr) return res.status(404).json({ error: 'Location not found' });
    await pool.query('DELETE FROM address WHERE address_id = ?', [req.params.id]);
    await log_activity(req.user.user_id, 'DELETE_LOCATION', 'address', req.params.id,
      `Deleted Room ${addr.room_id} · Cage ${addr.cage_address || '?'}`);
    res.json({ message: 'Location deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/addresses/:id/ferrets', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.Ferret_QR005_id AS id, f.ferret_name AS name, f.animal_id,
             f.dead, f.sex, f.weight, f.birth_date, a.cage_address, a.room_id
      FROM ferret_qr005 f
      JOIN address a ON f.address_id = a.address_id
      WHERE f.address_id = ? AND (f.dead = '0' OR f.dead IS NULL) AND (f.distributed = 0 OR f.distributed IS NULL)
      ORDER BY f.ferret_name
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── User Management ──────────────────────────────────────────────────────────
app.get('/api/users', authenticate, admin_or_research, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT user_id, username, email, role, full_name, active, created_at, last_login FROM users ORDER BY username'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', authenticate, admin_only, async (req, res) => {
  const { username, password, email, role, full_name } = req.body;
  if (!username || !password || !email || !role)
    return res.status(400).json({ error: 'username, password, email, and role are required' });
  try {
    const hashed = await bcrypt.hash(password, 12);
    const [r] = await pool.query(
      'INSERT INTO users (username, password, email, role, full_name) VALUES (?,?,?,?,?)',
      [username, hashed, email, role, full_name || null]
    );
    await log_activity(req.user.user_id, 'CREATE_USER', 'users', r.insertId, `Created user: ${username} (${role})`);
    res.json({ id: r.insertId, message: 'User created' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', authenticate, admin_only, async (req, res) => {
  const { email, role, full_name, active, password } = req.body;
  const sets = [], vals = [];
  if (email !== undefined) { sets.push('email = ?'); vals.push(email); }
  if (role !== undefined) { sets.push('role = ?'); vals.push(role); }
  if (full_name !== undefined) { sets.push('full_name = ?'); vals.push(full_name); }
  if (active !== undefined) { sets.push('active = ?'); vals.push(active); }
  if (password) { sets.push('password = ?'); vals.push(await bcrypt.hash(password, 12)); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  try {
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE user_id = ?`, vals);
    await log_activity(req.user.user_id, 'UPDATE_USER', 'users', req.params.id, 'User updated');
    res.json({ message: 'User updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Activity Log ─────────────────────────────────────────────────────────────
app.get('/api/activity-log', authenticate, admin_only, async (req, res) => {
  try {
    const PAGE_SIZE = 100;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const user_id = req.query.user_id || null;
    const date_from = req.query.date_from || null;
    const date_to = req.query.date_to || null;

    const where = []; const params = [];
    if (user_id) { where.push('al.user_id = ?'); params.push(user_id); }
    if (date_from) { where.push('DATE(al.created_at) >= ?'); params.push(date_from); }
    if (date_to) { where.push('DATE(al.created_at) <= ?'); params.push(date_to); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM activity_log al ' + whereClause, params
    );

    const offset = (page - 1) * PAGE_SIZE;
    const [rows] = await pool.query(
      'SELECT al.*, u.username FROM activity_log al JOIN users u ON al.user_id = u.user_id ' +
      whereClause + ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?',
      [...params, PAGE_SIZE, offset]
    );

    res.json({ rows, total, page, page_size: PAGE_SIZE, pages: Math.ceil(total / PAGE_SIZE) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Reports ──────────────────────────────────────────────────────────────────
// All report endpoints are restricted to admin/research (sensitive data:
// death causes, kit mortality). Reproductive-status data reuses the existing
// GET /api/females/estrus endpoint on the frontend rather than duplicating it.

// Active ferret count per room
app.get('/api/reports/ferrets-by-room', authenticate, admin_or_research, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT room_id, MAX(room_name) AS room_name, COUNT(Ferret_QR005_id) AS ferret_count
      FROM (
        SELECT a.room_id, a.room_name, f.Ferret_QR005_id
        FROM address a
        LEFT JOIN ferret_qr005 f ON f.address_id = a.address_id
          AND (f.dead = '0' OR f.dead IS NULL) AND (f.distributed = 0 OR f.distributed IS NULL)
        WHERE a.room_id IS NOT NULL AND a.room_id > 0
      ) t
      GROUP BY room_id
      ORDER BY room_id
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Deaths within an optional date range — name, age in weeks (computed client-side
// from birth_date/death_date), date of death, and cause_of_death as the notes field
app.get('/api/reports/deaths', authenticate, admin_or_research, async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const where = ["f.dead = '1'"];
    const params = [];
    if (date_from) { where.push('f.death_date >= ?'); params.push(date_from); }
    if (date_to) { where.push('f.death_date <= ?'); params.push(date_to); }
    const [rows] = await pool.query(`
      SELECT f.Ferret_QR005_id AS id, f.ferret_name AS name, f.animal_id,
             f.birth_date, f.death_date, mi.cause_of_death,
             a.room_id, a.cage_address
      FROM ferret_qr005 f
      LEFT JOIN medical_info mi ON f.medical_info_id = mi.medical_info_id
      LEFT JOIN address a ON f.address_id = a.address_id
      WHERE ${where.join(' AND ')}
      ORDER BY f.death_date DESC
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Infant mortality — post-birth kit deaths (litter_kit_death, filtered by
// death_date) plus stillborn counts (litter_log.stillborn, filtered by
// litter_date, since a stillborn kit has no separate death_date of its own)
app.get('/api/reports/infant-mortality', authenticate, admin_or_research, async (req, res) => {
  try {
    const { date_from, date_to } = req.query;

    const kdWhere = []; const kdParams = [];
    if (date_from) { kdWhere.push('kd.death_date >= ?'); kdParams.push(date_from); }
    if (date_to) { kdWhere.push('kd.death_date <= ?'); kdParams.push(date_to); }
    const kdWhereClause = kdWhere.length ? 'WHERE ' + kdWhere.join(' AND ') : '';

    const [kit_deaths] = await pool.query(`
      SELECT kd.kit_death_id, kd.death_date, kd.cause_category, kd.notes, kd.treatments,
             ll.litter_id, ll.litter_date, f.ferret_name AS jill_name
      FROM litter_kit_death kd
      JOIN litter_log ll ON kd.litter_log_id = ll.litter_log_id
      JOIN ferret_qr005 f ON ll.Ferret_QR005_id = f.Ferret_QR005_id
      ${kdWhereClause}
      ORDER BY kd.death_date DESC
    `, kdParams);

    const slWhere = ['ll.stillborn > 0']; const slParams = [];
    if (date_from) { slWhere.push('ll.litter_date >= ?'); slParams.push(date_from); }
    if (date_to) { slWhere.push('ll.litter_date <= ?'); slParams.push(date_to); }

    const [stillborns] = await pool.query(`
      SELECT ll.litter_log_id, ll.litter_id, ll.litter_date, ll.stillborn, f.ferret_name AS jill_name
      FROM litter_log ll
      JOIN ferret_qr005 f ON ll.Ferret_QR005_id = f.Ferret_QR005_id
      WHERE ${slWhere.join(' AND ')}
      ORDER BY ll.litter_date DESC
    `, slParams);

    res.json({ kit_deaths, stillborns });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🐾 SanusBio running → http://localhost:${PORT}`);
  console.log(`   Roles: admin > research > maternity > caretaker > cleaner\n`);
});
// ─── RFID ─────────────────────────────────────────────────────────────────────

// Lookup ferret by RFID chip value.
// All 15 digits are still stored internally (rfid_assignment.rfid), but a person only
// needs to enter/scan the last 6 digits to find the ferret — we match on that suffix so
// a full 15-digit scan (USB wedge / NFC) and a manually-typed 6-digit lookup both work.
app.get('/api/rfid/lookup/:rfid', authenticate, require_perm('read'), async (req, res) => {
  const input = req.params.rfid.trim();
  if (input.length < 6) return res.status(400).json({ error: 'Please enter at least the last 6 digits of the RFID chip.' });
  try {
    const [rows] = await pool.query(`
      SELECT ra.rfid, ra.assigned_date, ra.reason, ra.notes,
             f.Ferret_QR005_id AS id, f.ferret_name AS name, f.animal_id,
             f.birth_date, f.death_date, f.dead, f.sex, f.weight, f.color,
             f.description, f.photo_url, f.distributed, f.next_rabies_vaccine_due,
             a.cage_address, a.room_id, a.room_name, a.room_lighting,
             s.supplier_name
      FROM rfid_assignment ra
      JOIN ferret_qr005 f ON ra.ferret_id = f.Ferret_QR005_id
      LEFT JOIN address  a ON f.address_id  = a.address_id
      LEFT JOIN supplier s ON f.supplier_id = s.supplier_id
      WHERE RIGHT(ra.rfid, 6) = RIGHT(?, 6) AND ra.unassigned_date IS NULL
    `, [input]);
    if (!rows.length) return res.status(404).json({ error: 'unassigned' });
    const distinctFerretIds = [...new Set(rows.map(r => r.id))];
    if (distinctFerretIds.length > 1) {
      return res.status(409).json({ error: 'Multiple active chips share those last 6 digits. Please enter more digits of the RFID chip.' });
    }
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/ferrets/:id/rfid', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM rfid_assignment WHERE ferret_id = ? ORDER BY assigned_date DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Assign a new RFID chip to a ferret (unassigns any currently active chip first)
app.post('/api/ferrets/:id/rfid', authenticate, require_perm('update'), async (req, res) => {
  const { rfid, reason, notes } = req.body;
  if (!rfid || !rfid.trim()) return res.status(400).json({ error: 'rfid value is required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Unassign any chip currently active on this ferret
    await conn.query(
      `UPDATE rfid_assignment SET unassigned_date = CURDATE()
       WHERE ferret_id = ? AND unassigned_date IS NULL`,
      [req.params.id]
    );
    // Also unassign this chip from any other ferret it may still be assigned to
    // (handles reuse after a ferret dies without explicitly unassigning)
    await conn.query(
      `UPDATE rfid_assignment SET unassigned_date = CURDATE()
       WHERE rfid = ? AND unassigned_date IS NULL AND ferret_id != ?`,
      [rfid.trim(), req.params.id]
    );
    // Assign to this ferret
    const [r] = await conn.query(
      `INSERT INTO rfid_assignment (rfid, ferret_id, assigned_date, reason, notes)
       VALUES (?, ?, CURDATE(), ?, ?)`,
      [rfid.trim(), req.params.id, reason || null, notes || null]
    );
    await conn.commit();
    await log_activity(req.user.user_id, 'RFID_ASSIGN', 'rfid_assignment', req.params.id,
      `RFID ${rfid.trim()} assigned to ferret #${req.params.id}`);
    res.json({ id: r.insertId, message: 'RFID assigned' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Unassign the active RFID chip from a ferret
app.put('/api/ferrets/:id/rfid/unassign', authenticate, require_perm('update'), async (req, res) => {
  const { reason } = req.body;
  try {
    const [result] = await pool.query(
      `UPDATE rfid_assignment SET unassigned_date = CURDATE(), reason = COALESCE(?, reason)
       WHERE ferret_id = ? AND unassigned_date IS NULL`,
      [reason || null, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'No active RFID found for this ferret' });
    await log_activity(req.user.user_id, 'RFID_UNASSIGN', 'rfid_assignment', req.params.id,
      `RFID unassigned from ferret #${req.params.id}`);
    res.json({ message: 'RFID unassigned' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Cleaning Reports ─────────────────────────────────────────────────────────

// Plain list of distinct room IDs — used by the Cleaning Reports "what
// room(s) did you clean" picker and the report-history room filter. This
// route was missing entirely (app-cleaning.js has called it since it was
// written), which 404'd and — because loadCrHistory() awaits it before
// fetching /cleaning-reports — silently aborted the history load too.
app.get('/api/rooms', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT DISTINCT room_id FROM address WHERE room_id IS NOT NULL AND room_id > 0 ORDER BY room_id'
    );
    res.json(rows.map(r => r.room_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Room Light Schedule ──────────────────────────────────────────────────────
app.get('/api/rooms/light-schedule', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT a.room_id, a.room_name, COALESCE(rls.eight_hour_light,0) AS eight_hour_light,
             rls.light_state_since
      FROM address a
      LEFT JOIN room_light_schedule rls ON a.room_id = rls.room_id
      WHERE a.room_id IS NOT NULL AND a.room_id > 0
      ORDER BY a.room_id
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/rooms/:room_id/light', authenticate, require_perm('update'), async (req, res) => {
  const { eight_hour_light } = req.body;
  const roomId = parseInt(req.params.room_id);
  if (!roomId) return res.status(400).json({ error: 'Invalid room_id' });
  const newVal = eight_hour_light ? 1 : 0;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[existing]] = await conn.query(
      'SELECT eight_hour_light FROM room_light_schedule WHERE room_id = ?', [roomId]
    );
    // Only reset the "since" date when the state actually flips — repeated
    // saves of the same value shouldn't restart any ferret's duration clock.
    const stateChanged = !existing || existing.eight_hour_light != newVal;
    if (stateChanged) {
      await conn.query(
        `INSERT INTO room_light_schedule (room_id, eight_hour_light, light_state_since) VALUES (?, ?, CURDATE())
         ON DUPLICATE KEY UPDATE eight_hour_light = VALUES(eight_hour_light), light_state_since = CURDATE()`,
        [roomId, newVal]
      );
      // Cascade to every auto-mode ferret currently housed in this room —
      // flipping the room's actual light schedule is itself a trigger event
      // (e.g. to induce estrus) even if no ferret physically moves.
      await conn.query(`
        UPDATE ferret_qr005 f
        JOIN address a ON f.address_id = a.address_id
        SET f.eight_hour_light = ?, f.light_state_since = CURDATE()
        WHERE a.room_id = ? AND f.light_mode = 'auto'
      `, [newVal, roomId]);
    }
    await conn.commit();
    await log_activity(req.user.user_id, 'UPDATE', 'room_light_schedule', roomId,
      `Room ${roomId} 8-hour light schedule ${newVal ? 'enabled' : 'disabled'}${stateChanged ? ' — synced to auto-mode ferrets in room' : ''}`);
    res.json({ message: 'Room light schedule updated' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// ─── Care Schedule Settings (nail trim / bath interval, weight alert thresholds) ─
app.get('/api/care-schedule', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [[settings]] = await pool.query('SELECT * FROM care_schedule_settings WHERE id = 1');
    res.json(settings || { nail_trim_interval_days: 180, bath_interval_days: 180, weight_warn_days: 30, weight_critical_days: 45 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/care-schedule', authenticate, admin_or_research, async (req, res) => {
  const { nail_trim_interval_days, bath_interval_days, weight_warn_days, weight_critical_days } = req.body;
  const sets = [], vals = [];
  if (nail_trim_interval_days !== undefined) { sets.push('nail_trim_interval_days = ?'); vals.push(parseInt(nail_trim_interval_days)); }
  if (bath_interval_days !== undefined) { sets.push('bath_interval_days = ?'); vals.push(parseInt(bath_interval_days)); }
  if (weight_warn_days !== undefined) { sets.push('weight_warn_days = ?'); vals.push(parseInt(weight_warn_days)); }
  if (weight_critical_days !== undefined) { sets.push('weight_critical_days = ?'); vals.push(parseInt(weight_critical_days)); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  try {
    await pool.query(
      `INSERT INTO care_schedule_settings (id) VALUES (1) ON DUPLICATE KEY UPDATE ${sets.join(', ')}`,
      vals
    );
    await log_activity(req.user.user_id, 'UPDATE', 'care_schedule_settings', 1, 'Care schedule settings updated');
    res.json({ message: 'Care schedule settings updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Submit a cleaning report (any authenticated user)
app.post('/api/cleaning-reports', authenticate, async (req, res) => {
  const {
    rooms_cleaned, inside_cage_cleaning, tray_cleaning,
    sweeping_mopping, food_water_check, had_issues,
    issue_description, signature_data, reporter_name
  } = req.body;
  if (!rooms_cleaned || !rooms_cleaned.length)
    return res.status(400).json({ error: 'At least one room must be selected' });
  if (!inside_cage_cleaning || !tray_cleaning || !sweeping_mopping || !food_water_check)
    return res.status(400).json({ error: 'All required checkboxes must be confirmed' });
  if (!signature_data)
    return res.status(400).json({ error: 'Signature is required' });
  const displayName = reporter_name?.trim() || req.user.full_name || req.user.username;
  if (!displayName) return res.status(400).json({ error: 'Name is required' });
  try {
    const roomStr = Array.isArray(rooms_cleaned) ? rooms_cleaned.join(',') : rooms_cleaned;
    const [r] = await pool.query(
      `INSERT INTO room_cleaning_report
        (reported_by_user_id, reported_by_name, rooms_cleaned,
         inside_cage_cleaning, tray_cleaning, sweeping_mopping, food_water_check,
         had_issues, issue_description, signature_data)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [req.user.user_id, displayName, roomStr,
      inside_cage_cleaning ? 1 : 0, tray_cleaning ? 1 : 0,
      sweeping_mopping ? 1 : 0, food_water_check ? 1 : 0,
      had_issues ? 1 : 0, issue_description || null, signature_data]
    );
    await log_activity(req.user.user_id, 'CLEANING_REPORT', 'room_cleaning_report', r.insertId,
      `Room(s) ${roomStr} cleaned by ${displayName}`);
    res.json({ id: r.insertId, message: 'Cleaning report submitted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get cleaning reports (admin/research can view)
app.get('/api/cleaning-reports', authenticate, async (req, res) => {
  if (!['admin', 'research'].includes(req.user.role))
    return res.status(403).json({ error: 'Admin or Research access required' });
  try {
    const limit = parseInt(req.query.limit) || 100;
    const room = req.query.room || null;
    let q = `SELECT report_id, reported_by_name, rooms_cleaned,
               inside_cage_cleaning, tray_cleaning, sweeping_mopping,
               food_water_check, had_issues, issue_description, submitted_at
             FROM room_cleaning_report`;
    const params = [];
    if (room) { q += ` WHERE FIND_IN_SET(?, rooms_cleaned)`; params.push(room); }
    q += ` ORDER BY submitted_at DESC LIMIT ?`;
    params.push(limit);
    const [rows] = await pool.query(q, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get single cleaning report (with signature) for admin
app.get('/api/cleaning-reports/:id', authenticate, async (req, res) => {
  if (!['admin', 'research'].includes(req.user.role))
    return res.status(403).json({ error: 'Admin or Research access required' });
  try {
    const [[row]] = await pool.query(
      'SELECT * FROM room_cleaning_report WHERE report_id = ?', [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Report not found' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});// ─── Distributors ─────────────────────────────────────────────────────────────

// List all distributors
app.get('/api/distributors', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT d.*,
             COUNT(de.distribution_id)          AS distribution_count,
             SUM(de.price)                       AS total_value,
             MAX(de.distribution_date)           AS last_distribution_date
      FROM distributor d
      LEFT JOIN distribution_event de ON d.distributor_id = de.distributor_id
      GROUP BY d.distributor_id
      ORDER BY d.distributor_name
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create distributor
app.post('/api/distributors', authenticate, admin_or_research, async (req, res) => {
  const { distributor_name, contact_info, address, phone, notes } = req.body;
  if (!distributor_name) return res.status(400).json({ error: 'distributor_name is required' });
  try {
    const [r] = await pool.query(
      'INSERT INTO distributor (distributor_name, contact_info, address, phone, notes) VALUES (?,?,?,?,?)',
      [distributor_name, contact_info || null, address || null, phone || null, notes || null]
    );
    await log_activity(req.user.user_id, 'CREATE', 'distributor', r.insertId, `Added distributor: ${distributor_name}`);
    res.json({ id: r.insertId, message: 'Distributor added' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'A distributor with that name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// Update distributor
app.put('/api/distributors/:id', authenticate, admin_or_research, async (req, res) => {
  const { distributor_name, contact_info, address, phone, notes } = req.body;
  const sets = [], vals = [];
  if (distributor_name !== undefined) { sets.push('distributor_name = ?'); vals.push(distributor_name); }
  if (contact_info !== undefined) { sets.push('contact_info = ?'); vals.push(contact_info || null); }
  if (address !== undefined) { sets.push('address = ?'); vals.push(address || null); }
  if (phone !== undefined) { sets.push('phone = ?'); vals.push(phone || null); }
  if (notes !== undefined) { sets.push('notes = ?'); vals.push(notes || null); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  try {
    await pool.query(`UPDATE distributor SET ${sets.join(', ')} WHERE distributor_id = ?`, vals);
    await log_activity(req.user.user_id, 'UPDATE', 'distributor', req.params.id, `Updated distributor #${req.params.id}`);
    res.json({ message: 'Distributor updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete distributor (only if no distribution events reference it)
app.delete('/api/distributors/:id', authenticate, admin_only, async (req, res) => {
  try {
    const [[{ cnt }]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM distribution_event WHERE distributor_id = ?', [req.params.id]
    );
    if (cnt > 0) return res.status(400).json({ error: `Cannot delete — ${cnt} distribution record(s) reference this distributor` });
    await pool.query('DELETE FROM distributor WHERE distributor_id = ?', [req.params.id]);
    await log_activity(req.user.user_id, 'DELETE', 'distributor', req.params.id, `Deleted distributor #${req.params.id}`);
    res.json({ message: 'Distributor deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get ferrets distributed to a specific distributor
app.get('/api/distributors/:id/ferrets', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT de.distribution_id, de.distribution_date, de.price, de.notes AS dist_notes,
             de.recorded_by, de.created_at AS dist_created_at,
             f.Ferret_QR005_id AS ferret_id, f.ferret_name, f.animal_id,
             f.birth_date, f.sex, f.weight, f.photo_url, f.dead
      FROM distribution_event de
      JOIN ferret_qr005 f ON de.ferret_id = f.Ferret_QR005_id
      WHERE de.distributor_id = ?
      ORDER BY de.distribution_date DESC, f.ferret_name
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Distribution Events ──────────────────────────────────────────────────────

// Distribute a ferret
app.post('/api/ferrets/:id/distribute', authenticate, require_perm('update'), async (req, res) => {
  const { distributor_id, distribution_date, price, notes } = req.body;
  if (!distributor_id) return res.status(400).json({ error: 'distributor_id is required' });
  if (!distribution_date) return res.status(400).json({ error: 'distribution_date is required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Verify ferret exists and isn't already distributed
    const [[ferret]] = await conn.query(
      'SELECT ferret_name, distributed FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]
    );
    if (!ferret) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Ferret not found' }); }
    if (ferret.distributed) { await conn.rollback(); conn.release(); return res.status(400).json({ error: 'This ferret has already been distributed' }); }

    // Verify distributor exists
    const [[dist]] = await conn.query('SELECT distributor_name FROM distributor WHERE distributor_id = ?', [distributor_id]);
    if (!dist) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Distributor not found' }); }

    // Record distribution event
    const [r] = await conn.query(
      `INSERT INTO distribution_event (ferret_id, distributor_id, distribution_date, price, notes, recorded_by)
       VALUES (?,?,?,?,?,?)`,
      [req.params.id, distributor_id, distribution_date,
      price != null ? parseFloat(price) : null, notes || null, req.user.username]
    );

    // Mark ferret as distributed and set distributor reference
    await conn.query(
      'UPDATE ferret_qr005 SET distributed = 1, distributor_id = ? WHERE Ferret_QR005_id = ?',
      [distributor_id, req.params.id]
    );

    await conn.commit();
    await log_activity(req.user.user_id, 'DISTRIBUTE', 'ferret_qr005', req.params.id,
      `${ferret.ferret_name} distributed to ${dist.distributor_name} on ${distribution_date}`);
    res.json({ id: r.insertId, message: 'Ferret distributed successfully' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Undo a distribution (admin only)
app.put('/api/ferrets/:id/distribute/undo', authenticate, admin_only, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[ferret]] = await conn.query(
      'SELECT ferret_name FROM ferret_qr005 WHERE Ferret_QR005_id = ? AND distributed = 1', [req.params.id]
    );
    if (!ferret) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'No active distribution found for this ferret' }); }
    // Remove most recent distribution event
    await conn.query(
      `DELETE FROM distribution_event WHERE ferret_id = ?
       ORDER BY distribution_date DESC, distribution_id DESC LIMIT 1`, [req.params.id]
    );
    // Check if any other events remain; if not, clear flags
    const [[{ remaining }]] = await conn.query(
      'SELECT COUNT(*) AS remaining FROM distribution_event WHERE ferret_id = ?', [req.params.id]
    );
    if (!remaining) {
      await conn.query(
        'UPDATE ferret_qr005 SET distributed = 0, distributor_id = NULL WHERE Ferret_QR005_id = ?', [req.params.id]
      );
    }
    await conn.commit();
    await log_activity(req.user.user_id, 'DISTRIBUTE_UNDO', 'ferret_qr005', req.params.id,
      `Distribution undone for ${ferret.ferret_name}`);
    res.json({ message: 'Distribution reversed' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Get distribution history for a single ferret
app.get('/api/ferrets/:id/distribution', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT de.*, d.distributor_name, d.address AS distributor_address
      FROM distribution_event de
      JOIN distributor d ON de.distributor_id = d.distributor_id
      WHERE de.ferret_id = ?
      ORDER BY de.distribution_date DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Reproductive Events ──────────────────────────────────────────────────────

// Derive current female status from most recent reproductive event
function deriveStatus(events) {
  if (!events.length) return 'baseline';
  const last = events[0]; // already sorted DESC
  if (last.event_type === 'no_litter') return 'baseline';
  if (last.event_type === 'weaned') return 'baseline';
  return last.event_type; // estrus | mated | littered
}

// ─── Mating History (works from either the female's or the male's page) ─────
app.get('/api/ferrets/:id/matings', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [[ferret]] = await pool.query('SELECT sex FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]);
    if (!ferret) return res.status(404).json({ error: 'Ferret not found' });
    const whereClause = ferret.sex === 'male'
      ? 're.partner_id = ? AND re.event_type = \'mated\''
      : 're.ferret_id = ? AND re.event_type = \'mated\'';
    const [rows] = await pool.query(`
      SELECT re.event_id, re.event_date, re.pulled_date, re.notes, re.recorded_by,
             re.ferret_id AS female_id, f.ferret_name AS female_name,
             re.partner_id AS male_id, m.ferret_name AS male_name,
             DATE_ADD(re.event_date, INTERVAL 42 DAY) AS expected_litter_start,
             CASE WHEN re.pulled_date IS NOT NULL THEN DATE_ADD(re.pulled_date, INTERVAL 42 DAY) ELSE NULL END AS expected_litter_end
      FROM reproductive_event re
      JOIN ferret_qr005 f ON re.ferret_id = f.Ferret_QR005_id
      LEFT JOIN ferret_qr005 m ON re.partner_id = m.Ferret_QR005_id
      WHERE ${whereClause}
      ORDER BY re.event_date DESC, re.event_id DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ferrets/:id/matings', authenticate, require_perm('update'), async (req, res) => {
  const { partner_id, event_date, pulled_date, notes } = req.body;
  if (!partner_id || !event_date) return res.status(400).json({ error: 'partner_id and event_date are required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[current]] = await conn.query('SELECT ferret_name, sex FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]);
    const [[partner]] = await conn.query('SELECT ferret_name, sex FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [partner_id]);
    if (!current || !partner) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Ferret not found' }); }
    if (!current.sex || !partner.sex || current.sex === partner.sex) {
      await conn.rollback(); conn.release();
      return res.status(400).json({ error: 'A mating requires one male and one female ferret with sex set' });
    }
    const femaleId = current.sex === 'female' ? req.params.id : partner_id;
    const maleId   = current.sex === 'male'   ? req.params.id : partner_id;

    const [r] = await conn.query(
      'INSERT INTO reproductive_event (ferret_id, event_type, event_date, pulled_date, partner_id, notes, recorded_by) VALUES (?,?,?,?,?,?,?)',
      [femaleId, 'mated', event_date, pulled_date || null, maleId, notes || null, req.user.username]
    );
    const [events] = await conn.query(
      'SELECT event_type FROM reproductive_event WHERE ferret_id = ? ORDER BY event_date DESC, event_id DESC',
      [femaleId]
    );
    await conn.query('UPDATE ferret_qr005 SET female_status = ? WHERE Ferret_QR005_id = ?', [deriveStatus(events), femaleId]);

    await conn.commit();
    await log_activity(req.user.user_id, 'MATING', 'reproductive_event', r.insertId,
      `Mating recorded between ${current.ferret_name} and ${partner.ferret_name}`);
    res.json({ id: r.insertId, message: 'Mating recorded' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Get all reproductive events for a ferret
app.get('/api/ferrets/:id/reproductive', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT re.*,
             p.ferret_name AS partner_name,
             DATE_ADD(re.event_date, INTERVAL 42 DAY) AS expected_litter_start,
             CASE WHEN re.pulled_date IS NOT NULL THEN DATE_ADD(re.pulled_date, INTERVAL 42 DAY) ELSE NULL END AS expected_litter_end
      FROM reproductive_event re
      LEFT JOIN ferret_qr005 p ON re.partner_id = p.Ferret_QR005_id
      WHERE re.ferret_id = ?
      ORDER BY re.event_date DESC, re.event_id DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Record a reproductive event (updates female_status automatically)
app.post('/api/ferrets/:id/reproductive', authenticate, require_perm('update'), async (req, res) => {
  const { event_type, event_date, partner_id, pulled_date, notes } = req.body;
  const VALID = ['estrus', 'mated', 'littered', 'weaned', 'no_litter'];
  if (!VALID.includes(event_type)) return res.status(400).json({ error: 'Invalid event_type' });
  if (!event_date) return res.status(400).json({ error: 'event_date is required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Verify ferret is female
    const [[ferret]] = await conn.query(
      'SELECT ferret_name, sex FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]
    );
    if (!ferret) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'Ferret not found' }); }
    if (ferret.sex !== 'female') { await conn.rollback(); conn.release(); return res.status(400).json({ error: 'Reproductive events can only be recorded for female ferrets' }); }

    const [r] = await conn.query(
      'INSERT INTO reproductive_event (ferret_id, event_type, event_date, pulled_date, partner_id, notes, recorded_by) VALUES (?,?,?,?,?,?,?)',
      [req.params.id, event_type, event_date, event_type === 'mated' ? (pulled_date || null) : null, partner_id || null, notes || null, req.user.username]
    );

    // Recompute status from all events
    const [events] = await conn.query(
      'SELECT event_type FROM reproductive_event WHERE ferret_id = ? ORDER BY event_date DESC, event_id DESC',
      [req.params.id]
    );
    const newStatus = deriveStatus(events);
    await conn.query(
      'UPDATE ferret_qr005 SET female_status = ? WHERE Ferret_QR005_id = ?',
      [newStatus, req.params.id]
    );

    await conn.commit();
    await log_activity(req.user.user_id, 'REPRO_EVENT', 'reproductive_event', req.params.id,
      `${event_type} recorded for ${ferret.ferret_name}`);
    res.json({ id: r.insertId, status: newStatus, message: 'Reproductive event recorded' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Set/update the date a mated female was pulled/separated from the male —
// recorded after the fact once staff separate the pair. Used with the
// mating date to compute an expected-litter date RANGE (~6wk gestation).
app.put('/api/ferrets/:id/reproductive/:eventId/pulled-date', authenticate, require_perm('update'), async (req, res) => {
  const { pulled_date } = req.body;
  try {
    const [[event]] = await pool.query(
      'SELECT event_type FROM reproductive_event WHERE event_id = ? AND ferret_id = ?',
      [req.params.eventId, req.params.id]
    );
    if (!event) return res.status(404).json({ error: 'Reproductive event not found' });
    if (event.event_type !== 'mated') return res.status(400).json({ error: 'Pulled date only applies to mated events' });
    await pool.query('UPDATE reproductive_event SET pulled_date = ? WHERE event_id = ?', [pulled_date || null, req.params.eventId]);
    await log_activity(req.user.user_id, 'UPDATE', 'reproductive_event', req.params.eventId,
      `Pulled date ${pulled_date ? 'set to ' + pulled_date : 'cleared'} for reproductive event #${req.params.eventId}`);
    res.json({ message: 'Pulled date updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete a reproductive event (admin only — with status recompute)
app.delete('/api/ferrets/:id/reproductive/:eid', authenticate, admin_only, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM reproductive_event WHERE event_id = ? AND ferret_id = ?',
      [req.params.eid, req.params.id]);
    const [events] = await conn.query(
      'SELECT event_type FROM reproductive_event WHERE ferret_id = ? ORDER BY event_date DESC, event_id DESC',
      [req.params.id]
    );
    const newStatus = deriveStatus(events);
    await conn.query(
      'UPDATE ferret_qr005 SET female_status = ? WHERE Ferret_QR005_id = ?',
      [newStatus === 'baseline' ? null : newStatus, req.params.id]
    );
    await conn.commit();
    res.json({ status: newStatus, message: 'Event deleted' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// ─── Reproductive Event Photo ─────────────────────────────────────────────────
const reproUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `repro-${req.params.id}-${req.params.eventId}-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

app.post('/api/ferrets/:id/reproductive/:eventId/photo', authenticate, require_perm('update'), reproUpload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const [[event]] = await pool.query(
      'SELECT photo_url FROM reproductive_event WHERE event_id = ? AND ferret_id = ?',
      [req.params.eventId, req.params.id]
    );
    if (!event) return res.status(404).json({ error: 'Reproductive event not found' });
    if (event.photo_url?.startsWith('/uploads/')) {
      const p = path.join(__dirname, event.photo_url);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const photoUrl = `/uploads/${req.file.filename}`;
    await pool.query('UPDATE reproductive_event SET photo_url = ? WHERE event_id = ?', [photoUrl, req.params.eventId]);
    await log_activity(req.user.user_id, 'PHOTO_UPLOAD', 'reproductive_event', req.params.eventId,
      `Photo added to reproductive event #${req.params.eventId}`);
    res.json({ photo_url: photoUrl, message: 'Photo uploaded' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

<<<<<<< Updated upstream
// All females currently in estrus (for estrus board)
=======
// All females currently on the Reproductive Status Board
// Latest event drives status. no_litter and weaned = off the board (baseline).
>>>>>>> Stashed changes
app.get('/api/females/estrus', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.Ferret_QR005_id AS id, f.ferret_name AS name, f.animal_id,
<<<<<<< Updated upstream
             f.birth_date, f.weight, f.color, f.photo_url,
             a.room_id, a.room_name, a.cage_address, a.room_lighting,
=======
             f.birth_date, f.weight, f.color, f.photo_url, f.female_status,
             a.room_id, a.room_name, a.cage_address, a.room_lighting,
             re.event_id AS status_event_id,
>>>>>>> Stashed changes
             re.event_type AS status,
             re.event_date AS status_since,
             re.pulled_date,
             re.notes AS status_notes,
             DATE_ADD(re.event_date, INTERVAL 42 DAY) AS expected_litter_start,
             CASE WHEN re.event_type = 'mated' AND re.pulled_date IS NOT NULL
                  THEN DATE_ADD(re.pulled_date, INTERVAL 42 DAY) ELSE NULL END AS expected_litter_end
      FROM ferret_qr005 f
      LEFT JOIN address a ON f.address_id = a.address_id
      JOIN reproductive_event re ON re.event_id = (
        SELECT r2.event_id FROM reproductive_event r2
        WHERE r2.ferret_id = f.Ferret_QR005_id
        ORDER BY r2.event_date DESC, r2.event_id DESC LIMIT 1
      )
      WHERE f.sex = 'female'
        AND (f.dead = '0' OR f.dead IS NULL)
        AND (f.distributed = 0 OR f.distributed IS NULL)
        AND (f.breeding_retired = 0 OR f.breeding_retired IS NULL)
<<<<<<< Updated upstream
        AND re.event_type <> 'no_litter'
      ORDER BY
        FIELD(re.event_type, 'estrus', 'mated', 'littered', 'weaned'),
=======
        AND re.event_type NOT IN ('no_litter', 'weaned')
      ORDER BY
        FIELD(re.event_type, 'estrus', 'mated', 'littered'),
>>>>>>> Stashed changes
        re.event_date ASC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

<<<<<<< Updated upstream
=======
// Quick action: mated (or estrus) female produced no litter → back to baseline
app.post('/api/ferrets/:id/no-litter', authenticate, require_perm('update'), async (req, res) => {
  const event_date = req.body.event_date || new Date().toISOString().slice(0, 10);
  const notes = req.body.notes || 'No litter — returned to baseline';
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[ferret]] = await conn.query(
      'SELECT ferret_name, sex FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]
    );
    if (!ferret) { await conn.rollback(); return res.status(404).json({ error: 'Ferret not found' }); }
    if (ferret.sex !== 'female') { await conn.rollback(); return res.status(400).json({ error: 'Only females' }); }

    const [r] = await conn.query(
      `INSERT INTO reproductive_event (ferret_id, event_type, event_date, notes, recorded_by)
       VALUES (?,'no_litter',?,?,?)`,
      [req.params.id, event_date, notes, req.user.username]
    );
    const [events] = await conn.query(
      'SELECT event_type FROM reproductive_event WHERE ferret_id = ? ORDER BY event_date DESC, event_id DESC',
      [req.params.id]
    );
    const newStatus = deriveStatus(events);
    await conn.query(
      'UPDATE ferret_qr005 SET female_status = ? WHERE Ferret_QR005_id = ?',
      [newStatus === 'baseline' ? null : newStatus, req.params.id]
    );
    await conn.commit();
    await log_activity(req.user.user_id, 'REPRO_EVENT', 'reproductive_event', r.insertId,
      `No litter / return to baseline: ${ferret.ferret_name}`);
    res.json({ id: r.insertId, status: newStatus, message: 'Returned to baseline' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

>>>>>>> Stashed changes
// Females who died while active on the Reproductive Status Board (estrus/mated/littered/weaned)
app.get('/api/females/died-on-board', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.Ferret_QR005_id AS id, f.ferret_name AS name, f.animal_id,
             f.birth_date, f.death_date, f.death_female_status,
             a.room_id, a.room_name, a.cage_address
      FROM ferret_qr005 f
      LEFT JOIN address a ON f.address_id = a.address_id
      WHERE f.sex = 'female' AND f.death_female_status IS NOT NULL
      ORDER BY f.death_date DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update mating restriction for a ferret
app.put('/api/ferrets/:id/mating-restriction', authenticate, require_perm('update'), async (req, res) => {
  const { mating_restriction_flags, mating_restriction } = req.body;
  try {
    const flagsStr = Array.isArray(mating_restriction_flags)
      ? mating_restriction_flags.join(',')
      : (mating_restriction_flags || null);
    await pool.query(
      'UPDATE ferret_qr005 SET mating_restriction_flags = ?, mating_restriction = ? WHERE Ferret_QR005_id = ?',
      [flagsStr || null, mating_restriction || null, req.params.id]
    );
    await log_activity(req.user.user_id, 'UPDATE', 'ferret_qr005', req.params.id,
      `Mating restriction updated for ferret #${req.params.id}`);
    res.json({ message: 'Mating restriction updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Toggle breeding-retired status (excludes female from Reproductive Status Board)
app.put('/api/ferrets/:id/breeding-retired', authenticate, require_perm('update'), async (req, res) => {
  const { breeding_retired } = req.body;
  try {
    const [[ferret]] = await pool.query('SELECT ferret_name, sex FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]);
    if (!ferret) return res.status(404).json({ error: 'Ferret not found' });
    await pool.query('UPDATE ferret_qr005 SET breeding_retired = ? WHERE Ferret_QR005_id = ?', [breeding_retired ? 1 : 0, req.params.id]);
    await log_activity(req.user.user_id, 'UPDATE', 'ferret_qr005', req.params.id,
      `${breeding_retired ? 'Retired from breeding' : 'Reinstated to breeding tracking'}: ${ferret.ferret_name}`);
    res.json({ message: 'Breeding retired status updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// All distribution events (for the Distribution page overview)
app.get('/api/distribution-events', authenticate, require_perm('read'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const distributor_id = req.query.distributor_id || null;
    let q = `
      SELECT de.distribution_id, de.distribution_date, de.price, de.notes AS dist_notes,
             de.recorded_by, de.created_at,
             f.Ferret_QR005_id AS ferret_id, f.ferret_name, f.animal_id, f.sex, f.birth_date,
             d.distributor_id, d.distributor_name
      FROM distribution_event de
      JOIN ferret_qr005 f  ON de.ferret_id      = f.Ferret_QR005_id
      JOIN distributor  d  ON de.distributor_id = d.distributor_id
    `;
    const params = [];
    if (distributor_id) { q += ' WHERE de.distributor_id = ?'; params.push(distributor_id); }
    q += ' ORDER BY de.distribution_date DESC, f.ferret_name LIMIT ?';
    params.push(limit);
    const [rows] = await pool.query(q, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});