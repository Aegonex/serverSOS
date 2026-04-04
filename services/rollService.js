import db from '../lib/db.js'
import { assignRole } from './discordService.js'

const ROLL_COST = 10 // ราคาสุ่มแบบ paid (บาท)

const FALLBACK_QUOTA = 2 // ค่า fallback ถ้าอ่าน DB ไม่ได้

async function getDefaultQuota() {
  try {
    const [rows] = await db.query("SELECT value FROM Settings WHERE `key` = 'DEFAULT_DAILY_QUOTA'")
    return rows.length > 0 ? Number(rows[0].value) : FALLBACK_QUOTA
  } catch {
    return FALLBACK_QUOTA
  }
}

// เช็คว่า user สุ่มฟรีได้อีกกี่ครั้งวันนี้
export async function checkFreeRoll(discordUserId) {
  const defaultQuota = await getDefaultQuota()

  const [rows] = await db.query(
    'SELECT lastFreeRollDate, freeRollQuota, freeRollsUsedToday FROM User WHERE discordUserId = ?',
    [discordUserId]
  )

  // user ใหม่ยังไม่มีในระบบ = สุ่มได้
  if (rows.length === 0) return { canRoll: true, remaining: defaultQuota, total: defaultQuota }

  const user = rows[0]
  const quota = user.freeRollQuota || defaultQuota

  // เช็คว่าวันใหม่หรือยัง ถ้าวันใหม่ reset usedToday
  const today = new Date().toDateString()
  const lastRoll = user.lastFreeRollDate ? new Date(user.lastFreeRollDate).toDateString() : null
  const usedToday = (lastRoll === today) ? (user.freeRollsUsedToday || 0) : 0

  const remaining = Math.max(0, quota - usedToday)
  return { canRoll: remaining > 0, remaining, total: quota }
}

// เช็คยอดเงินของ user
export async function getBalance(discordUserId) {
  const [rows] = await db.query(
    'SELECT balance FROM User WHERE discordUserId = ?',
    [discordUserId]
  )
  if (rows.length === 0) return 0
  return rows[0].balance
}

export async function getRollHistory(discordUserId, limit = 1000) {
  const [rows] = await db.query(
    `SELECT
        ur.id,
        ur.rollType,
        ur.rolledAt,
        r.id AS roleId,
        r.name AS roleName,
        r.imageUrl,
        t.id AS tierId,
        t.name AS tierName,
        t.color AS tierColor
     FROM UserRoll ur
     JOIN Role r ON ur.roleId = r.id
     JOIN Tier t ON r.tierId = t.id
     WHERE ur.discordUserId = ?
     ORDER BY ur.rolledAt DESC
     LIMIT ?`,
    [discordUserId, Number(limit)]
  )

  return rows.map((row) => ({
    id: row.id,
    rollType: row.rollType,
    rolledAt: row.rolledAt,
    role: {
      id: row.roleId,
      name: row.roleName,
      imageUrl: row.imageUrl,
    },
    tier: {
      id: row.tierId,
      name: row.tierName,
      color: row.tierColor,
    },
  }))
}

// สุ่มยศ
export async function performRoll(discordUserId, rollType = 'free', username = '', guildId = null) {
  // เช็คเงินถ้าเป็น paid
  if (rollType === 'paid') {
    const balance = await getBalance(discordUserId)
    if (balance < ROLL_COST) {
      throw new Error('Insufficient balance')
    }
  }

  // 1. ดึง tiers ทั้งหมด
  const [tiers] = await db.query('SELECT * FROM Tier')

  // 2. ดึง roles ที่ active แยกตาม tier
  const [roles] = await db.query('SELECT * FROM Role WHERE isActive = 1')

  // จับคู่ roles เข้ากับ tier
  const availableTiers = tiers
    .map(tier => ({
      ...tier,
      roles: roles.filter(r => r.tierId === tier.id),
    }))
    .filter(t => t.roles.length > 0)

  if (availableTiers.length === 0) throw new Error('No roles available')

  // 3. ดึง pity ของ user
  const [userPity] = await db.query(
    'SELECT * FROM UserPity WHERE discordUserId = ?',
    [discordUserId]
  )

  // 4. เช็ค pity — ถ้า tier ไหนถึง threshold → การันตี tier นั้น
  let selectedTier = null

  for (const tier of availableTiers) {
    if (!tier.pityThreshold) continue
    const pity = userPity.find(p => p.tierId === tier.id)
    if (pity && pity.counter >= tier.pityThreshold) {
      selectedTier = tier
      break
    }
  }

  // 5. ถ้ายังไม่ถึง pity → สุ่มตาม dropRate
  if (!selectedTier) {
    selectedTier = rollTierByRate(availableTiers)
  }

  // 6. สุ่ม role จาก tier ที่ได้
  const tierRoles = selectedTier.roles
  const selectedRole = tierRoles[Math.floor(Math.random() * tierRoles.length)]

  // 7. บันทึกทุกอย่างใน transaction
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // สร้าง user ถ้ายังไม่มี
    await conn.query(
      `INSERT INTO User (discordUserId, username, freeRollQuota, createdAt)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         username = IF(? != '', ?, username)`,
      [discordUserId, username, await getDefaultQuota(), username, username]
    )

    // อัพเดท free roll tracking
    if (rollType === 'free') {
      const now = new Date()
      // เช็คว่าวันใหม่ไหม ถ้าวันใหม่ reset freeRollsUsedToday = 1 ถ้าวันเดิม +1
      await conn.query(
        `UPDATE User SET
           freeRollsUsedToday = IF(DATE(lastFreeRollDate) = CURDATE(), freeRollsUsedToday + 1, 1),
           lastFreeRollDate = ?
         WHERE discordUserId = ?`,
        [now, discordUserId]
      )
    }

    // หักเงินถ้าเป็น paid
    if (rollType === 'paid') {
      await conn.query(
        'UPDATE User SET balance = balance - ? WHERE discordUserId = ?',
        [ROLL_COST, discordUserId]
      )
    }

    // บันทึกประวัติการสุ่ม
    await conn.query(
      'INSERT INTO UserRoll (discordUserId, roleId, rollType, rolledAt) VALUES (?, ?, ?, NOW())',
      [discordUserId, selectedRole.id, rollType]
    )

    // อัพเดท pity: tier ที่ได้ reset = 0, tier อื่น +1
    for (const tier of availableTiers) {
      if (!tier.pityThreshold) continue

      const isWonTier = tier.id === selectedTier.id

      if (isWonTier) {
        await conn.query(
          `INSERT INTO UserPity (discordUserId, tierId, counter)
           VALUES (?, ?, 0)
           ON DUPLICATE KEY UPDATE counter = 0`,
          [discordUserId, tier.id]
        )
      } else {
        await conn.query(
          `INSERT INTO UserPity (discordUserId, tierId, counter)
           VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE counter = counter + 1`,
          [discordUserId, tier.id]
        )
      }
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  // แปะยศใน Discord (ไม่ block ผลลัพธ์ ถ้า fail แค่ log)
  if (guildId && selectedRole.discordRoleId) {
    assignRole(guildId, discordUserId, selectedRole.discordRoleId).catch((err) => {
      console.error('Failed to assign Discord role:', err.message)
    })
  }

  return {
    role: selectedRole,
    tier: {
      id: selectedTier.id,
      name: selectedTier.name,
      color: selectedTier.color,
    },
  }
}

// สุ่ม tier ตาม dropRate
function rollTierByRate(tiers) {
  const rand = Math.random() * 100
  let cumulative = 0

  for (const tier of tiers) {
    cumulative += Number(tier.dropRate)
    if (rand < cumulative) return tier
  }

  // fallback: ถ้า dropRate รวมไม่ถึง 100 → ให้ตัวสุดท้าย
  return tiers[tiers.length - 1]
}

// ดึง roles ทั้งหมดที่ active (สำหรับ animation ฝั่ง client)
export async function getAllActiveRoles() {
  const [roles] = await db.query(
    `SELECT r.*, t.name as tierName, t.color as tierColor
     FROM Role r
     JOIN Tier t ON r.tierId = t.id
     WHERE r.isActive = 1`
  )
  return roles
}
