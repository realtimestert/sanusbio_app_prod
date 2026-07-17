// SanusBio v1.9.2 | 2026-07-17 | server.js
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
    const [[{ overdue }]] = await pool.query("SELECT COUNT(*) as overdue FROM assignments WHERE completed=0 AND due_date < CURDATE()");
    const [[{ vacc_due }]] = await pool.query("SELECT COUNT(*) as vacc_due FROM ferret_qr005 WHERE next_rabies_vaccine_due <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND (dead='0' OR dead IS NULL)");
    const [[{ litters_this_month }]] = await pool.query("SELECT COUNT(*) as litters_this_month FROM litter_log WHERE litter_date >= DATE_FORMAT(CURDATE(),'%Y-%m-01')");
    const [recent_activity] = await pool.query(`
      SELECT al.action, al.details, al.created_at, u.username
      FROM activity_log al JOIN users u ON al.user_id = u.user_id
      ORDER BY al.created_at DESC LIMIT 10
    `);
    res.json({ total, overdue, vacc_due, litters_this_month, recent_activity });
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
              COALESCE(rls.eight_hour_light, 0) AS eight_hour_light,
              f.distributed, f.distributor_id, f.female_status, f.breeding_retired,
              a.cage_address, a.room_id, a.room_name, a.room_lighting,
              s.supplier_name,
              d.distributor_name,
              de.distribution_date
        FROM ferret_qr005 f
        LEFT JOIN address     a ON f.address_id     = a.address_id
        LEFT JOIN supplier    s ON f.supplier_id    = s.supplier_id
        LEFT JOIN distributor d ON f.distributor_id = d.distributor_id
        LEFT JOIN room_light_schedule rls ON a.room_id = rls.room_id
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
               f.next_rabies_vaccine_due, f.sex, 0 AS eight_hour_light,
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
    await conn.query(
      "UPDATE ferret_qr005 SET dead = '1', death_date = ? WHERE Ferret_QR005_id = ?",
      [death_date || null, req.params.id]
    );
    const [[ferret]] = await conn.query(
      'SELECT medical_info_id, ferret_name FROM ferret_qr005 WHERE Ferret_QR005_id = ?',
      [req.params.id]
    );
    if (ferret) {
      await conn.query(
        "UPDATE medical_info SET cause_of_death = ?, date_of_death = ?, dead = 'y' WHERE medical_info_id = ?",
        [cause_of_death || null, death_date || null, ferret.medical_info_id]
      );
    }
    await conn.commit();
    await log_activity(req.user.user_id, 'UPDATE', 'ferret_qr005', req.params.id,
      `Marked deceased: ferret #${req.params.id}${cause_of_death ? ' — ' + cause_of_death : ''}`);
    res.json({ message: 'Ferret marked as deceased' });
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
  const { address_id, position } = req.body;
  if (!address_id) return res.status(400).json({ error: 'address_id required' });
  try {
    const [[ferret]] = await pool.query(
      'SELECT dead, distributed FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]
    );
    if (!ferret) return res.status(404).json({ error: 'Ferret not found' });
    if (ferret.dead === '1') return res.status(400).json({ error: 'Cannot change location of a deceased ferret' });
    if (ferret.distributed) return res.status(400).json({ error: 'Cannot change location of a distributed ferret' });
    await pool.query('UPDATE ferret_qr005 SET address_id = ? WHERE Ferret_QR005_id = ?', [address_id, req.params.id]);
    if (position !== undefined) {
      await pool.query('UPDATE address SET room_lighting = ? WHERE address_id = ?', [position || null, address_id]);
    }
    await log_activity(req.user.user_id, 'MOVE', 'ferret_qr005', req.params.id, `Moved ferret #${req.params.id} to address #${address_id}${position ? ' · ' + position : ''}`);
    res.json({ message: 'Location updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    await conn.query('DELETE FROM assignments WHERE ferret_id = ?', [id]);
    await conn.query('DELETE FROM ferret_location_history WHERE ferret_id = ?', [id]);
    await conn.query('DELETE FROM health_event WHERE ferret_id = ?', [id]);
    await conn.query('DELETE FROM litter_log WHERE Ferret_QR005_id = ?', [id]);
    await conn.query('DELETE FROM rfid_assignment WHERE ferret_id = ?', [id]);
    await conn.query('DELETE FROM vaccination_event WHERE ferret_id = ?', [id]);
    await conn.query('DELETE FROM distribution_event WHERE ferret_id = ?', [id]);
    await conn.query('DELETE FROM reproductive_event WHERE ferret_id = ?', [id]);
    try {
      await conn.query('DELETE FROM `estrus_&_mating_summary` WHERE Ferret_QR005_id = ?', [id]);
    } catch { /* table may not exist on every deployment — non-fatal */ }

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
      WHERE al.record_id = ? AND al.table_name IN ('ferret_qr005','health_event','vaccination_event','litter_log','medical_info','assignments')
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

// Create litter
app.post('/api/litters', authenticate, async (req, res) => {
  if (!['admin', 'maternity', 'research'].includes(req.user.role))
    return res.status(403).json({ error: 'Only admin, research, and maternity can add litter records' });
  const { Ferret_QR005_id, litter_id, litter_date, kit_count, stillborn, father, mother, anomalies_and_notes } = req.body;
  try {
    const [r] = await pool.query(
      `INSERT INTO litter_log (Ferret_QR005_id, litter_id, litter_date, kit_count, stillborn,
        father, mother, anomalies_and_notes, created, created_by)
       VALUES (?,?,?,?,?,?,?,?,CURDATE(),?)`,
      [Ferret_QR005_id, litter_id || null, litter_date, kit_count || null,
        stillborn || null, father || null, mother || null,
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
  vals.push(req.params.id);
  try {
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

// ─── Assignments ──────────────────────────────────────────────────────────────
app.get('/api/assignments', authenticate, require_perm('read'), async (req, res) => {
  try {
    let q = `
      SELECT a.*,
             u.username AS assigned_username, u.full_name AS assigned_full_name,
             c.username AS creator_username,
             f.ferret_name
      FROM assignments a
      JOIN  users u ON a.assigned_to = u.user_id
      JOIN  users c ON a.created_by  = c.user_id
      LEFT JOIN ferret_qr005 f ON a.ferret_id = f.Ferret_QR005_id
    `;
    const params = [];
    if (!['admin', 'research'].includes(req.user.role)) {
      q += ` WHERE a.assigned_to = ? AND (a.completed = 0 OR a.completed_at > DATE_SUB(NOW(), INTERVAL 7 DAY))`;
      params.push(req.user.user_id);
    }
    q += ' ORDER BY a.completed ASC, a.due_date ASC';
    const [rows] = await pool.query(q, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/assignments', authenticate, admin_or_research, async (req, res) => {
  const { assigned_to, assignment_type, address_id, ferret_id, description, due_date } = req.body;
  try {
    const [r] = await pool.query(
      `INSERT INTO assignments (assigned_to, assignment_type, address_id, ferret_id, description, due_date, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [assigned_to, assignment_type, address_id || null, ferret_id || null, description || null, due_date, req.user.user_id]
    );
    await log_activity(req.user.user_id, 'CREATE', 'assignments', r.insertId, `Assigned to user #${assigned_to}`);
    res.json({ id: r.insertId, message: 'Assignment created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/assignments/:id/complete', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM assignments WHERE assignment_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Assignment not found' });
    if (req.user.role !== 'admin' && rows[0].assigned_to !== req.user.user_id)
      return res.status(403).json({ error: 'You can only complete your own assignments' });
    await pool.query('UPDATE assignments SET completed = 1, completed_at = NOW() WHERE assignment_id = ?', [req.params.id]);
    await log_activity(req.user.user_id, 'COMPLETE', 'assignments', req.params.id, 'Assignment marked complete');
    res.json({ message: 'Assignment completed' });
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

// ─── Room Light Schedule ──────────────────────────────────────────────────────
app.get('/api/rooms/light-schedule', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT a.room_id, a.room_name, COALESCE(rls.eight_hour_light,0) AS eight_hour_light
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
  try {
    await pool.query(
      `INSERT INTO room_light_schedule (room_id, eight_hour_light) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE eight_hour_light = VALUES(eight_hour_light)`,
      [roomId, eight_hour_light ? 1 : 0]
    );
    await log_activity(req.user.user_id, 'UPDATE', 'room_light_schedule', roomId,
      `Room ${roomId} 8-hour light schedule ${eight_hour_light ? 'enabled' : 'disabled'}`);
    res.json({ message: 'Room light schedule updated' });
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
      SELECT re.event_id, re.event_date, re.notes, re.recorded_by,
             re.ferret_id AS female_id, f.ferret_name AS female_name,
             re.partner_id AS male_id, m.ferret_name AS male_name
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
  const { partner_id, event_date, notes } = req.body;
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
      'INSERT INTO reproductive_event (ferret_id, event_type, event_date, partner_id, notes, recorded_by) VALUES (?,?,?,?,?,?)',
      [femaleId, 'mated', event_date, maleId, notes || null, req.user.username]
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
             p.ferret_name AS partner_name
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
  const { event_type, event_date, partner_id, notes } = req.body;
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
      'INSERT INTO reproductive_event (ferret_id, event_type, event_date, partner_id, notes, recorded_by) VALUES (?,?,?,?,?,?)',
      [req.params.id, event_type, event_date, partner_id || null, notes || null, req.user.username]
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

// All females currently in estrus (for estrus board)
app.get('/api/females/estrus', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.Ferret_QR005_id AS id, f.ferret_name AS name, f.animal_id,
             f.birth_date, f.weight, f.female_status, f.color, f.photo_url,
             a.room_id, a.room_name, a.cage_address, a.room_lighting,
             re.event_date AS status_since,
             re.notes AS status_notes
      FROM ferret_qr005 f
      LEFT JOIN address a ON f.address_id = a.address_id
      LEFT JOIN reproductive_event re ON re.ferret_id = f.Ferret_QR005_id
        AND re.event_id = (
          SELECT MAX(r2.event_id) FROM reproductive_event r2 WHERE r2.ferret_id = f.Ferret_QR005_id
        )
      WHERE f.sex = 'female'
        AND (f.dead = '0' OR f.dead IS NULL)
        AND (f.distributed = 0 OR f.distributed IS NULL)
        AND (f.breeding_retired = 0 OR f.breeding_retired IS NULL)
        AND f.female_status IS NOT NULL
        AND f.female_status <> 'baseline'
      ORDER BY
        FIELD(f.female_status, 'estrus', 'mated', 'littered', 'weaned', 'baseline'),
        re.event_date ASC
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