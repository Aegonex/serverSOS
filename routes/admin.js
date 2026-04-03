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
      'SELECT discordUserId, username, balance, lastFreeRollDate, createdAt FROM User ORDER BY createdAt DESC'
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

export default router
