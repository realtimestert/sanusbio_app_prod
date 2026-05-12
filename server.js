// SanusBio v1.0.1 | 2026-05-02
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const SECRET = process.env.JWT_SECRET || 'change-this-secret';

app.use(express.json());
app.use(cors());

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
//  admin     → full access (read, write, update, delete, manage_users)
//  research  → everything admin can do except manage users
//  maternity → read + write/update litter, estrus, health data; no delete
//  caretaker → read (own view) + write health events + complete own assignments
const PERMS = {
  admin: new Set(['read', 'write', 'update', 'delete', 'manage_users']),
  research: new Set(['read', 'write', 'update', 'delete']),
  maternity: new Set(['read', 'write', 'update']),
  caretaker: new Set(['read', 'write'])
};

function can(role, action) {
  return PERMS[role]?.has(action) ?? false;
}

// ─── Middleware ───────────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No authorization header' });
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function require_perm(action) {
  return (req, res, next) => {
    if (!can(req.user.role, action)) {
      return res.status(403).json({ error: `Role '${req.user.role}' cannot perform this action` });
    }
    next();
  };
}

function admin_only(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function admin_or_research(req, res, next) {
  if (!['admin', 'research'].includes(req.user.role)) return res.status(403).json({ error: 'Admin or Research access required' });
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
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE username = ? AND active = 1', [username]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid username or password' });
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });
    await pool.query('UPDATE users SET last_login = NOW() WHERE user_id = ?', [user.user_id]);
    const token = jwt.sign(
      { user_id: user.user_id, username: user.username, role: user.role, full_name: user.full_name },
      SECRET,
      { expiresIn: '8h' }
    );
    await log_activity(user.user_id, 'LOGIN', 'users', user.user_id, `${user.username} logged in`);
    res.json({
      token,
      user: { user_id: user.user_id, username: user.username, role: user.role, full_name: user.full_name }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', authenticate, (req, res) => res.json(req.user));

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
app.get('/api/dashboard', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [[{ total }]] = await pool.query("SELECT COUNT(*) as total FROM ferret_qr005 WHERE dead='0' OR dead IS NULL");
    const [[{ deceased }]] = await pool.query("SELECT COUNT(*) as deceased FROM ferret_qr005 WHERE dead='1'");
    const [[{ overdue }]] = await pool.query("SELECT COUNT(*) as overdue FROM assignments WHERE completed=0 AND due_date < CURDATE()");
    const [[{ vacc_due }]] = await pool.query("SELECT COUNT(*) as vacc_due FROM ferret_qr005 WHERE next_rabies_vaccine_due <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND (dead='0' OR dead IS NULL)");
    const [recent_activity] = await pool.query(`
      SELECT al.action, al.details, al.created_at, u.username
      FROM activity_log al JOIN users u ON al.user_id = u.user_id
      ORDER BY al.created_at DESC LIMIT 10
    `);
    res.json({ total, deceased, overdue, vacc_due, recent_activity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Ferrets ──────────────────────────────────────────────────────────────────
app.get('/api/ferrets', authenticate, require_perm('read'), async (req, res) => {
  try {
    const q = req.query.search ? `%${req.query.search}%` : '%';
    const [rows] = await pool.query(`
      SELECT f.Ferret_QR005_id AS id, f.ferret_name AS name, f.animal_id,
             f.birth_date, f.weight, f.dead, f.description, f.litter_id,
             f.photo_url, f.mother_name, f.father_name, f.acquisition_by,
             f.next_rabies_vaccine_due, f.sex,
             a.cage_address, a.room_id,
             s.supplier_name
      FROM ferret_qr005 f
      LEFT JOIN address a    ON f.address_id  = a.address_id
      LEFT JOIN supplier s   ON f.supplier_id = s.supplier_id
      WHERE f.ferret_name LIKE ? OR f.animal_id LIKE ?
      ORDER BY f.ferret_name
    `, [q, q]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ferrets/:id', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.*,
             a.cage_address, a.room_id, a.room_lighting, a.maintenance,
             s.supplier_name, s.contact_info, s.supplier_phone_number,
             mi.castrated_or_spayed, mi.castration_or_spay_date,
             mi.dead AS med_dead, mi.date_of_death, mi.cause_of_death,
             mi.treatments, mi.last_exam_date, mi.orders, mi.performed_by,
             mi.weight_loss_or_gain, mi.exam_log, mi.surgical_procedure_log,
             ecl.estrus_status, ecl.in_estrus, ecl.vulva_description,
             ecl.formed_observation, ecl.comments AS estrus_comments
      FROM ferret_qr005 f
      LEFT JOIN address         a   ON f.address_id          = a.address_id
      LEFT JOIN supplier        s   ON f.supplier_id         = s.supplier_id
      LEFT JOIN medical_info    mi  ON f.medical_info_id     = mi.medical_info_id
      LEFT JOIN estrus_check_log ecl ON f.estrus_check_log_id = ecl.estrus_check_log_id
      WHERE f.Ferret_QR005_id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Ferret not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create ferret — admin and maternity only; auto-creates required stub sub-records
app.post('/api/ferrets', authenticate, async (req, res) => {
  if (!['admin', 'maternity', 'research'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only admin, research, and maternity roles can add ferrets' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Stub records for required FKs (tables lack AUTO_INCREMENT in original schema — fixed by migrations.sql)
    const {
      ferret_name, animal_id, birth_date, weight = 0, description,
      address_id, supplier_id, mother_name, father_name,
      next_rabies_vaccine_due, acquisition_by, photo_url, sex,
      castrated_or_spayed, castration_or_spay_date
    } = req.body;

    const [mi] = await conn.query('INSERT INTO medical_info (castrated_or_spayed, castration_or_spay_date) VALUES (?,?)',
      [castrated_or_spayed || 'n', castration_or_spay_date || null]);
    const [ec] = await conn.query('INSERT INTO estrus_check_log () VALUES ()');
    const [fm] = await conn.query('INSERT INTO females_to_mate () VALUES ()');
    const [hl] = await conn.query('INSERT INTO health_log () VALUES ()');

    // If no address provided, find or create a default "Unassigned" address
    let resolved_address_id = address_id || null;
    if (!resolved_address_id) {
      const [[existing]] = await conn.query("SELECT address_id FROM address WHERE cage_address = 'N/A' LIMIT 1");
      if (existing) {
        resolved_address_id = existing.address_id;
      } else {
        const [newAddr] = await conn.query("INSERT INTO address (room_id, cage_address) VALUES (0, 'N/A')");
        resolved_address_id = newAddr.insertId;
      }
    }

    // If no supplier provided, find or create a default "Unknown" supplier
    let resolved_supplier_id = supplier_id || null;
    if (!resolved_supplier_id) {
      const [[existing]] = await conn.query("SELECT supplier_id FROM supplier WHERE supplier_name = 'Unknown' LIMIT 1");
      if (existing) {
        resolved_supplier_id = existing.supplier_id;
      } else {
        const [newSup] = await conn.query("INSERT INTO supplier (supplier_name) VALUES ('Unknown')");
        resolved_supplier_id = newSup.insertId;
      }
    }

    const [r] = await conn.query(`
      INSERT INTO ferret_qr005
        (ferret_name, animal_id, birth_date, weight, description, address_id,
         medical_info_id, estrus_check_log_id, females_to_mate_id, health_log_id,
         supplier_id, mother_name, father_name, next_rabies_vaccine_due,
         acquisition_by, photo_url, created_by, dead, sex)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'','0',?)
    `, [ferret_name, animal_id || null, birth_date, weight, description || null,
      resolved_address_id, mi.insertId, ec.insertId, fm.insertId, hl.insertId,
      resolved_supplier_id, mother_name || null, father_name || null,
      next_rabies_vaccine_due || null, acquisition_by || null, photo_url || null,
      sex || null]);

    await conn.commit();
    await log_activity(req.user.user_id, 'CREATE', 'ferret_qr005', r.insertId, `Created ferret: ${ferret_name}`);
    res.json({ id: r.insertId, message: 'Ferret created successfully' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Update ferret — admin and maternity only
app.put('/api/ferrets/:id', authenticate, require_perm('update'), async (req, res) => {
  const allowed = ['ferret_name', 'weight', 'description', 'dead', 'next_rabies_vaccine_due', 'photo_url', 'acquisition_by', 'sex'];
  const sets = [], vals = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(req.body[key]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'No valid fields provided' });
  vals.push(req.params.id);
  try {
    await pool.query(`UPDATE ferret_qr005 SET ${sets.join(', ')} WHERE Ferret_QR005_id = ?`, vals);
    await log_activity(req.user.user_id, 'UPDATE', 'ferret_qr005', req.params.id, `Updated ferret #${req.params.id}`);
    res.json({ message: 'Ferret updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change ferret location — any authenticated role
app.put('/api/ferrets/:id/location', authenticate, async (req, res) => {
  const { address_id } = req.body;
  if (!address_id) return res.status(400).json({ error: 'address_id required' });
  try {
    // Fetch ferret name + current address before moving
    const [[ferret]] = await pool.query(`
      SELECT f.ferret_name, a.room_id AS old_room, a.cage_address AS old_cage
      FROM ferret_qr005 f
      LEFT JOIN address a ON f.address_id = a.address_id
      WHERE f.Ferret_QR005_id = ?
    `, [req.params.id]);

    // Fetch the destination address
    const [[newAddr]] = await pool.query(
      'SELECT room_id, cage_address FROM address WHERE address_id = ?', [address_id]
    );

    await pool.query('UPDATE ferret_qr005 SET address_id = ? WHERE Ferret_QR005_id = ?', [address_id, req.params.id]);

    const fromLabel = ferret?.old_room != null
      ? `Room ${ferret.old_room}${ferret.old_cage ? ' - Cage ' + ferret.old_cage : ''}`
      : 'Unknown';
    const toLabel = newAddr
      ? `Room ${newAddr.room_id}${newAddr.cage_address ? ' - Cage ' + newAddr.cage_address : ''}`
      : `Address #${address_id}`;
    const ferretName = ferret?.ferret_name || `#${req.params.id}`;

    await log_activity(
      req.user.user_id, 'MOVE', 'ferret_qr005', req.params.id,
      `${ferretName} moved from ${fromLabel} to ${toLabel}`
    );
    res.json({ message: 'Location updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete ferret — admin only
app.delete('/api/ferrets/:id', authenticate, admin_only, async (req, res) => {
  try {
    await pool.query('DELETE FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]);
    await log_activity(req.user.user_id, 'DELETE', 'ferret_qr005', req.params.id, `Deleted ferret #${req.params.id}`);
    res.json({ message: 'Ferret deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health Events ────────────────────────────────────────────────────────────
app.get('/api/ferrets/:id/health', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM health_event WHERE ferret_id = ? ORDER BY event_date DESC', [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All roles except research can record health events
app.post('/api/health-events', authenticate, require_perm('write'), async (req, res) => {
  if (req.user.role === 'research') return res.status(403).json({ error: 'Research role is read-only' });
  const { ferret_id, event_type, weight, event_date, event_time, notes } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const weightVal = (event_type === 'weight' && weight != null) ? parseFloat(weight) : null;
    if (event_type === 'weight' && (isNaN(weightVal) || weightVal < 0 || weightVal > 9999.99)) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: 'Weight must be between 0 and 9999.99 grams' });
    }
    // Combine date + time for notes context; store event_date as the date
    const timeLabel = event_time ? ` at ${event_time}` : '';
    const fullNotes = notes ? `[${event_date}${timeLabel}] ${notes}` : (event_time ? `[${event_date}${timeLabel}]` : null);

    const [r] = await conn.query(
      'INSERT INTO health_event (ferret_id, event_type, weight, event_date, notes, recorded_by) VALUES (?,?,?,?,?,?)',
      [ferret_id, event_type, weightVal, event_date, fullNotes, req.user.username]
    );
    // Update ferret's current weight if this is a weight check
    if (event_type === 'weight' && weightVal != null) {
      await conn.query(
        'UPDATE ferret_qr005 SET weight = ? WHERE Ferret_QR005_id = ?',
        [Math.round(weightVal), ferret_id]
      );
    }
    await conn.commit();
    await log_activity(req.user.user_id, 'CREATE', 'health_event', r.insertId, `${event_type} for ferret #${ferret_id}`);
    res.json({ id: r.insertId, message: 'Health event recorded' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ─── Vaccinations ─────────────────────────────────────────────────────────────
app.get('/api/ferrets/:id/vaccinations', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM vaccination_event WHERE ferret_id = ? ORDER BY vaccination_date DESC', [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin and maternity can record vaccinations
app.post('/api/vaccinations', authenticate, async (req, res) => {
  if (!['admin', 'maternity', 'research'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only admin, research, and maternity can record vaccinations' });
  }
  const { ferret_id, vaccine_type, vaccination_date, expiration_date, notes, next_rabies_due } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      'INSERT INTO vaccination_event (ferret_id, vaccine_type, vaccination_date, expiration_date, notes, recorded_by) VALUES (?,?,?,?,?,?)',
      [ferret_id, vaccine_type, vaccination_date, expiration_date || null, notes || null, req.user.username]
    );
    // Update next rabies due date on the ferret if provided
    if (vaccine_type === 'rabies' && next_rabies_due) {
      await conn.query('UPDATE ferret_qr005 SET next_rabies_vaccine_due = ? WHERE Ferret_QR005_id = ?',
        [next_rabies_due, ferret_id]);
    }
    await conn.commit();
    res.json({ id: r.insertId, message: 'Vaccination recorded' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Update medical info — admin and maternity only
app.put('/api/ferrets/:id/medical', authenticate, require_perm('update'), async (req, res) => {
  const { castrated_or_spayed, castration_or_spay_date, last_exam_date,
    performed_by, exam_log, orders, treatments } = req.body;
  try {
    // Get the medical_info_id, name and animal_id for this ferret
    const [[ferret]] = await pool.query(
      'SELECT medical_info_id, ferret_name, animal_id FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]
    );
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
    await log_activity(req.user.user_id, 'UPDATE', 'medical_info', ferret.medical_info_id,
      `Medical info updated for ${ferret.ferret_name}${ferret.animal_id ? ' (ID: ' + ferret.animal_id + ')' : ''}`);
    res.json({ message: 'Medical info updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Log a surgical procedure — appends an entry to surgical_procedure_log
app.post('/api/ferrets/:id/procedure', authenticate, require_perm('update'), async (req, res) => {
  const { procedure_name, procedure_date, performed_by, notes } = req.body;
  if (!procedure_name || !procedure_date) {
    return res.status(400).json({ error: 'procedure_name and procedure_date are required' });
  }
  try {
    const [[ferret]] = await pool.query(
      'SELECT medical_info_id, ferret_name, animal_id FROM ferret_qr005 WHERE Ferret_QR005_id = ?', [req.params.id]
    );
    if (!ferret) return res.status(404).json({ error: 'Ferret not found' });

    const [[mi]] = await pool.query(
      'SELECT surgical_procedure_log FROM medical_info WHERE medical_info_id = ?', [ferret.medical_info_id]
    );
    const entry = `[${procedure_date}] ${procedure_name}${performed_by ? ' — ' + performed_by : ''}${notes ? ': ' + notes : ''}`;
    const updated = mi.surgical_procedure_log
      ? mi.surgical_procedure_log + '\n' + entry
      : entry;
    await pool.query(
      'UPDATE medical_info SET surgical_procedure_log = ? WHERE medical_info_id = ?',
      [updated, ferret.medical_info_id]
    );
    await log_activity(req.user.user_id, 'PROCEDURE', 'medical_info', ferret.medical_info_id,
      `Procedure logged for ${ferret.ferret_name}${ferret.animal_id ? ' (ID: ' + ferret.animal_id + ')' : ''}: ${procedure_name}`);
    res.json({ message: 'Procedure logged' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Ferret History (all roles) ───────────────────────────────────────────────
app.get('/api/ferrets/:id/history', authenticate, require_perm('read'), async (req, res) => {
  const ferretId = req.params.id;
  try {
    // Health events
    const [healthRows] = await pool.query(`
      SELECT
        'health' AS event_category,
        event_date AS event_date,
        created_at,
        event_type AS subtype,
        weight,
        notes,
        recorded_by AS actor
      FROM health_event
      WHERE ferret_id = ?
    `, [ferretId]);

    // Move events from activity log
    const [moveRows] = await pool.query(`
      SELECT
        'move' AS event_category,
        DATE(al.created_at) AS event_date,
        al.created_at,
        'location_change' AS subtype,
        NULL AS weight,
        details AS notes,
        u.username AS actor
      FROM activity_log al
      JOIN users u ON al.user_id = u.user_id
      WHERE al.action = 'MOVE' AND al.record_id = ?
    `, [ferretId]);

    // Mating records
    const [matingRows] = await pool.query(`
      SELECT
        'mating' AS event_category,
        COALESCE(last_mating_date, confirmed_estrus_start, created) AS event_date,
        NULL AS created_at,
        'mating' AS subtype,
        NULL AS weight,
        CONCAT_WS(' | ',
          IF(confirmed_estrus_start IS NOT NULL, CONCAT('Estrus: ', confirmed_estrus_start), NULL),
          IF(last_mating_date IS NOT NULL, CONCAT('Mated: ', last_mating_date), NULL),
          IF(male_cage_mates IS NOT NULL AND male_cage_mates != '', CONCAT('Male: ', male_cage_mates), NULL),
          IF(mating_history IS NOT NULL AND mating_history != '', mating_history, NULL)
        ) AS notes,
        created_by AS actor
      FROM \`estrus_&_mating_summary\`
      WHERE Ferret_QR005_id = ?
    `, [ferretId]);

    // Merge and sort descending by date
    const all = [...healthRows, ...moveRows, ...matingRows]
      .filter(e => e.event_date)
      .sort((a, b) => {
        const da = new Date(a.created_at || a.event_date);
        const db = new Date(b.created_at || b.event_date);
        return db - da;
      });

    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Litter Logs ──────────────────────────────────────────────────────────────
app.get('/api/ferrets/:id/litters', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM litter_log WHERE Ferret_QR005_id = ? ORDER BY litter_date DESC', [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/litters', authenticate, async (req, res) => {
  if (!['admin', 'maternity', 'research'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only admin, research, and maternity can add litter records' });
  }
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
    await log_activity(req.user.user_id, 'CREATE', 'litter_log', r.insertId, `Litter for ferret #${Ferret_QR005_id}`);
    res.json({ id: r.insertId, message: 'Litter recorded' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Assignments ──────────────────────────────────────────────────────────────
app.get('/api/assignments', authenticate, require_perm('read'), async (req, res) => {
  try {
    let q = `
      SELECT a.*,
             u.username  AS assigned_username, u.full_name AS assigned_full_name,
             c.username  AS creator_username,
             f.ferret_name
      FROM assignments a
      JOIN  users u ON a.assigned_to = u.user_id
      JOIN  users c ON a.created_by  = c.user_id
      LEFT JOIN ferret_qr005 f ON a.ferret_id = f.Ferret_QR005_id
    `;
    const params = [];
    if (roleIs('admin', 'research', req.user.role)) {
      // admin and research see all assignments
    } else {
      // other roles see only their own, and completed ones disappear after 1 week
      q += ` WHERE a.assigned_to = ?
             AND (a.completed = 0 OR a.completed_at > DATE_SUB(NOW(), INTERVAL 7 DAY))`;
      params.push(req.user.user_id);
    }
    q += ' ORDER BY a.completed ASC, a.due_date ASC';
    const [rows] = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Any user can complete their own assignment; admin can complete any
app.put('/api/assignments/:id/complete', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM assignments WHERE assignment_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Assignment not found' });
    if (req.user.role !== 'admin' && rows[0].assigned_to !== req.user.user_id) {
      return res.status(403).json({ error: 'You can only complete your own assignments' });
    }
    await pool.query(
      'UPDATE assignments SET completed = 1, completed_at = NOW() WHERE assignment_id = ?', [req.params.id]
    );
    await log_activity(req.user.user_id, 'COMPLETE', 'assignments', req.params.id, 'Assignment marked complete');
    res.json({ message: 'Assignment completed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Reference Data ───────────────────────────────────────────────────────────
app.get('/api/suppliers', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM supplier ORDER BY supplier_name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/suppliers', authenticate, admin_or_research, async (req, res) => {
  const { supplier_name, contact_info, supplier_address, supplier_phone_number } = req.body;
  try {
    const [r] = await pool.query(
      'INSERT INTO supplier (supplier_name, contact_info, supplier_address, supplier_phone_number) VALUES (?,?,?,?)',
      [supplier_name, contact_info || null, supplier_address || null,
        supplier_phone_number ? supplier_phone_number.toString().replace(/\D/g, '').substring(0, 15) : null]
    );
    res.json({ id: r.insertId, message: 'Supplier added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/addresses', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM address ORDER BY room_id, cage_address');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/addresses', authenticate, admin_or_research, async (req, res) => {
  const { room_id, cage_address, room_lighting, maintenance } = req.body;
  try {
    const [r] = await pool.query(
      'INSERT INTO address (room_id, cage_address, room_lighting, maintenance) VALUES (?,?,?,?)',
      [room_id, cage_address || null, room_lighting || null, maintenance || null]
    );
    res.json({ id: r.insertId, message: 'Address added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get ferrets for a specific address/room
app.get('/api/addresses/:id/ferrets', authenticate, require_perm('read'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.Ferret_QR005_id AS id, f.ferret_name AS name, f.animal_id,
             f.dead, f.sex, f.weight, f.birth_date, a.cage_address, a.room_id
      FROM ferret_qr005 f
      JOIN address a ON f.address_id = a.address_id
      WHERE f.address_id = ? AND (f.dead = '0' OR f.dead IS NULL)
      ORDER BY f.ferret_name
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── User Management (Admin Only) ─────────────────────────────────────────────
app.get('/api/users', authenticate, admin_or_research, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT user_id, username, email, role, full_name, active, created_at, last_login FROM users ORDER BY username'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authenticate, admin_only, async (req, res) => {
  const { username, password, email, role, full_name } = req.body;
  if (!username || !password || !email || !role) {
    return res.status(400).json({ error: 'username, password, email, and role are required' });
  }
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Activity Log (Admin Only) ────────────────────────────────────────────────
app.get('/api/activity-log', authenticate, admin_only, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT al.*, u.username
      FROM activity_log al JOIN users u ON al.user_id = u.user_id
      ORDER BY al.created_at DESC LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🐾 SanusBio running → http://localhost:${PORT}`);
  console.log(`   Roles: admin > research > maternity > caretaker\n`);
});