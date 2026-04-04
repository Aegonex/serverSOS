import express from 'express'
import jwt from 'jsonwebtoken'
import db from '../lib/db.js'

const router = express.Router()

// === LOGIN (ไม่ต้อง auth) ===

router.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body

  if (
    username !== process.env.ADMIN_USERNAME ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' })
  }

  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  })

  res.json({ token, username })
})

// === AUTH MIDDLEWARE ===
// รองรับทั้ง JWT และ API Key

router.use('/api/admin', (req, res, next) => {
  const auth = req.headers['authorization']
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // เช็ค API Key ก่อน (ยังใช้ได้เหมือนเดิม เช่น Postman)
  if (token === process.env.ADMIN_API_KEY) {
    return next()
  }

  // เช็ค JWT
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (decoded.role !== 'admin') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    next()
  } catch {
    return res.status(401).json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' })
  }
})

// === TIER ===

// ดึง tier ทั้งหมด
router.get('/api/admin/tiers', async (req, res) => {
  try {
    const [tiers] = await db.query('SELECT * FROM Tier')
    res.json(tiers)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// สร้าง tier ใหม่
router.post('/api/admin/tiers', async (req, res) => {
  try {
    const { name, color, dropRate, pityThreshold } = req.body
    const [result] = await db.query(
      'INSERT INTO Tier (name, color, dropRate, pityThreshold) VALUES (?, ?, ?, ?)',
      [name, color, dropRate, pityThreshold || null]
    )
    res.json({ id: result.insertId, name, color, dropRate, pityThreshold })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// แก้ไข tier
router.put('/api/admin/tiers/:id', async (req, res) => {
  try {
    const { name, color, dropRate, pityThreshold } = req.body
    await db.query(
      'UPDATE Tier SET name = ?, color = ?, dropRate = ?, pityThreshold = ? WHERE id = ?',
      [name, color, dropRate, pityThreshold || null, req.params.id]
    )
    res.json({ message: 'Updated' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ลบ tier (ลบ roles + ประวัติที่เกี่ยวข้องด้วย)
router.delete('/api/admin/tiers/:id', async (req, res) => {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // ดึง role ids ที่อยู่ใน tier นี้
    const [roles] = await conn.query('SELECT id FROM Role WHERE tierId = ?', [req.params.id])
    const roleIds = roles.map(r => r.id)

    if (roleIds.length > 0) {
      // ลบประวัติการสุ่มที่อ้าง roles เหล่านี้
      await conn.query('DELETE FROM UserRoll WHERE roleId IN (?)', [roleIds])
      // ลบ roles
      await conn.query('DELETE FROM Role WHERE tierId = ?', [req.params.id])
    }

    // ลบ pity ที่อ้าง tier นี้
    await conn.query('DELETE FROM UserPity WHERE tierId = ?', [req.params.id])
    // ลบ tier
    await conn.query('DELETE FROM Tier WHERE id = ?', [req.params.id])

    await conn.commit()
    res.json({ message: 'Deleted' })
  } catch (err) {
    await conn.rollback()
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  } finally {
    conn.release()
  }
})

// === ROLE ===

// ดึง role ทั้งหมด
router.get('/api/admin/roles', async (req, res) => {
  try {
    const [roles] = await db.query(
      `SELECT r.*, t.name as tierName, t.color as tierColor
       FROM Role r
       JOIN Tier t ON r.tierId = t.id`
    )
    res.json(roles)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// สร้าง role ใหม่
router.post('/api/admin/roles', async (req, res) => {
  try {
    const { name, discordRoleId, tierId, imageUrl } = req.body
    const [result] = await db.query(
      'INSERT INTO Role (name, discordRoleId, tierId, imageUrl, isActive) VALUES (?, ?, ?, ?, 1)',
      [name, discordRoleId, tierId, imageUrl || null]
    )
    res.json({ id: result.insertId, name, discordRoleId, tierId, imageUrl })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// แก้ไข role
router.put('/api/admin/roles/:id', async (req, res) => {
  try {
    const { name, discordRoleId, tierId, imageUrl, isActive } = req.body
    await db.query(
      'UPDATE Role SET name = ?, discordRoleId = ?, tierId = ?, imageUrl = ?, isActive = ? WHERE id = ?',
      [name, discordRoleId, tierId, imageUrl || null, isActive, req.params.id]
    )
    res.json({ message: 'Updated' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ลบ role (ลบประวัติการสุ่มที่เกี่ยวข้องด้วย)
router.delete('/api/admin/roles/:id', async (req, res) => {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // ลบประวัติการสุ่มที่อ้าง role นี้
    await conn.query('DELETE FROM UserRoll WHERE roleId = ?', [req.params.id])
    // ลบ role
    await conn.query('DELETE FROM Role WHERE id = ?', [req.params.id])

    await conn.commit()
    res.json({ message: 'Deleted' })
  } catch (err) {
    await conn.rollback()
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  } finally {
    conn.release()
  }
})

// === USER ===

// ดึง user ทั้งหมด
router.get('/api/admin/users', async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT discordUserId, username, balance, freeRollQuota, freeRollsUsedToday, lastFreeRollDate, createdAt FROM User ORDER BY createdAt DESC'
    )
    res.json(users)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// === BALANCE ===

// เติมเงินให้ user (admin)
router.post('/api/admin/balance', async (req, res) => {
  try {
    const { discordUserId, amount } = req.body
    if (!discordUserId || !amount) {
      return res.status(400).json({ error: 'discordUserId and amount are required' })
    }
    await db.query(
      `INSERT INTO User (discordUserId, username, balance, createdAt)
       VALUES (?, '', ?, NOW())
       ON DUPLICATE KEY UPDATE balance = balance + ?`,
      [discordUserId, amount, amount]
    )
    const [rows] = await db.query(
      'SELECT balance FROM User WHERE discordUserId = ?',
      [discordUserId]
    )
    res.json({ discordUserId, balance: rows[0].balance })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// === QUOTA ===

// เพิ่มโควต้าสุ่มฟรีให้ user
router.post('/api/admin/quota', async (req, res) => {
  try {
    const { discordUserId, amount } = req.body
    if (!discordUserId || !amount) {
      return res.status(400).json({ error: 'discordUserId and amount are required' })
    }
    await db.query(
      'UPDATE User SET freeRollQuota = freeRollQuota + ? WHERE discordUserId = ?',
      [Number(amount), discordUserId]
    )
    const [rows] = await db.query(
      'SELECT freeRollQuota FROM User WHERE discordUserId = ?',
      [discordUserId]
    )
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }
    res.json({ discordUserId, freeRollQuota: rows[0].freeRollQuota })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ตั้งโควต้าสุ่มฟรีตรงๆ
router.put('/api/admin/quota', async (req, res) => {
  try {
    const { discordUserId, quota } = req.body
    if (!discordUserId || quota == null) {
      return res.status(400).json({ error: 'discordUserId and quota are required' })
    }
    await db.query(
      'UPDATE User SET freeRollQuota = ? WHERE discordUserId = ?',
      [Number(quota), discordUserId]
    )
    res.json({ discordUserId, freeRollQuota: Number(quota) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ดึงค่า default quota
router.get('/api/admin/settings', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT value FROM Settings WHERE `key` = 'DEFAULT_DAILY_QUOTA'"
    )
    const quota = rows.length > 0 ? Number(rows[0].value) : 2
    res.json({ defaultDailyQuota: quota })
  } catch (err) {
    // ถ้าตาราง Settings ยังไม่มี ส่งค่าเริ่มต้น
    res.json({ defaultDailyQuota: 2 })
  }
})

// ตั้งค่า default quota
router.put('/api/admin/settings', async (req, res) => {
  try {
    const { defaultDailyQuota } = req.body
    if (defaultDailyQuota == null) {
      return res.status(400).json({ error: 'defaultDailyQuota is required' })
    }
    await db.query(
      "INSERT INTO Settings (`key`, value) VALUES ('DEFAULT_DAILY_QUOTA', ?) ON DUPLICATE KEY UPDATE value = ?",
      [String(defaultDailyQuota), String(defaultDailyQuota)]
    )
    res.json({ defaultDailyQuota: Number(defaultDailyQuota) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// === PAYMENTS ===

// ดึง payment sessions ทั้งหมด
router.get('/api/admin/payments', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ps.id, ps.user_id, ps.amount, ps.status, ps.created_at, ps.updated_at,
              u.username
       FROM payment_sessions ps
       LEFT JOIN User u ON ps.user_id = u.discordUserId COLLATE utf8mb4_0900_ai_ci
       ORDER BY ps.created_at DESC
       LIMIT 500`
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ดึงสรุปข้อมูล dashboard
router.get('/api/admin/dashboard', async (req, res) => {
  try {
    const [[userCount]] = await db.query('SELECT COUNT(*) as count FROM User')
    const [[todayRolls]] = await db.query(
      'SELECT COUNT(*) as count FROM UserRoll WHERE DATE(rolledAt) = CURDATE()'
    )
    const [[totalTopUp]] = await db.query(
      "SELECT COALESCE(SUM(amount), 0) as total FROM payment_sessions WHERE status = 'success'"
    )
    const [[pendingPayments]] = await db.query(
      "SELECT COUNT(*) as count FROM payment_sessions WHERE status = 'pending'"
    )

    res.json({
      userCount: userCount.count,
      todayRolls: todayRolls.count,
      totalTopUp: Math.floor(totalTopUp.total / 100), // สตางค์ → บาท
      pendingPayments: pendingPayments.count,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ตั้งค่า balance ตรงๆ
router.put('/api/admin/balance', async (req, res) => {
  try {
    const { discordUserId, balance } = req.body
    if (!discordUserId || balance == null) {
      return res.status(400).json({ error: 'discordUserId and balance are required' })
    }
    await db.query(
      'UPDATE User SET balance = ? WHERE discordUserId = ?',
      [Number(balance), discordUserId]
    )
    res.json({ discordUserId, balance: Number(balance) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
