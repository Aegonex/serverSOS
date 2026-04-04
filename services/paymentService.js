import db from '../lib/db.js'

const SESSION_TIMEOUT_MINUTES = 10

// สุ่มสตางค์ .01-.99 แล้วเช็คว่าไม่ซ้ำกับ pending ที่มีอยู่
async function randomizeAmount(baseAmount) {
  const [pending] = await db.query(
    "SELECT amount FROM payment_sessions WHERE status = 'pending' AND created_at >= NOW() - INTERVAL ? MINUTE",
    [SESSION_TIMEOUT_MINUTES]
  )
  const usedAmounts = new Set(pending.map(r => r.amount))

  // baseAmount มาเป็นบาท (int) → แปลงเป็นสตางค์
  const baseSatang = baseAmount * 100

  let attempts = 0
  while (attempts < 99) {
    const randSatang = Math.floor(Math.random() * 99) + 1 // 1-99
    const finalAmount = baseSatang + randSatang
    if (!usedAmounts.has(finalAmount)) {
      return finalAmount
    }
    attempts++
  }

  throw new Error('ไม่สามารถสุ่มยอดที่ไม่ซ้ำได้ กรุณาลองใหม่')
}

// สร้าง payment session
export async function createSession(userId, baseAmount) {
  const amount = await randomizeAmount(baseAmount)

  const [result] = await db.query(
    'INSERT INTO payment_sessions (user_id, amount) VALUES (?, ?)',
    [userId, amount]
  )

  return {
    sessionId: result.insertId,
    amount, // หน่วยสตางค์
    displayAmount: (amount / 100).toFixed(2), // เช่น "150.37"
  }
}

// เช็คสถานะ session
export async function getSessionStatus(sessionId) {
  const [rows] = await db.query(
    'SELECT id, user_id, amount, status, created_at FROM payment_sessions WHERE id = ?',
    [sessionId]
  )
  if (rows.length === 0) return null
  return rows[0]
}

// Webhook: match ยอดเงินกับ pending session
export async function matchPayment(amountText) {
  // parse ยอดจาก text เช่น "1.10" → 110 สตางค์
  const match = amountText.match(/([\d,]+\.?\d*)\s*บาท/)
  if (!match) return null

  const parsed = parseFloat(match[1].replace(/,/g, ''))
  const amountSatang = Math.round(parsed * 100)

  // หา pending session ที่ยอดตรงและยังไม่เกิน 10 นาที
  const [rows] = await db.query(
    `SELECT id, user_id, amount FROM payment_sessions
     WHERE status = 'pending'
       AND amount = ?
       AND created_at >= NOW() - INTERVAL ? MINUTE
     ORDER BY created_at ASC
     LIMIT 1`,
    [amountSatang, SESSION_TIMEOUT_MINUTES]
  )

  if (rows.length === 0) return null

  const session = rows[0]

  // Transaction: update session เป็น success + เพิ่ม balance ให้ user
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    await conn.query(
      "UPDATE payment_sessions SET status = 'success' WHERE id = ?",
      [session.id]
    )

    // เพิ่ม balance (แปลงกลับเป็นบาท โดยปัดเศษสตางค์ทิ้ง)
    const balanceToAdd = Math.floor(session.amount / 100)
    await conn.query(
      'UPDATE User SET balance = balance + ? WHERE discordUserId = ?',
      [balanceToAdd, session.user_id]
    )

    await conn.commit()
    return { sessionId: session.id, userId: session.user_id, balanceAdded: balanceToAdd }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

// Sweep: เปลี่ยน pending ที่เกิน 10 นาทีเป็น deny
export async function sweepExpiredSessions() {
  const [result] = await db.query(
    `UPDATE payment_sessions SET status = 'deny'
     WHERE status = 'pending'
       AND created_at < NOW() - INTERVAL ? MINUTE`,
    [SESSION_TIMEOUT_MINUTES]
  )
  return result.affectedRows
}
