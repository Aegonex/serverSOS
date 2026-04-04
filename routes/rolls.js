import express from 'express'
import {
  checkFreeRoll,
  performRoll,
  getAllActiveRoles,
  getBalance,
  getRollHistory,
} from '../services/rollService.js'

const router = express.Router()

// เช็คว่าวันนี้สุ่มฟรีได้ไหม
router.get('/api/rolls/available', async (req, res) => {
  try {
    const { discordUserId } = req.query

    if (!discordUserId) {
      return res.status(400).json({ error: 'discordUserId is required' })
    }

    const { canRoll, remaining, total } = await checkFreeRoll(discordUserId)
    res.json({ canRoll, remaining, total })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// กดสุ่มยศ
router.post('/api/rolls', async (req, res) => {
  try {
    const { discordUserId, username, rollType = 'free', guildId } = req.body

    if (!discordUserId) {
      return res.status(400).json({ error: 'discordUserId is required' })
    }

    // ถ้าเป็น free ต้องเช็คโควต้าก่อน
    if (rollType === 'free') {
      const { canRoll } = await checkFreeRoll(discordUserId)
      if (!canRoll) {
        return res.status(403).json({ error: 'Already used free roll today' })
      }
    }

    const result = await performRoll(discordUserId, rollType, username, guildId)
    res.json(result)
  } catch (err) {
    if (err.message === 'Insufficient balance') {
      return res.status(403).json({ error: 'Insufficient balance' })
    }
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/api/rolls/history', async (req, res) => {
  try {
    const { discordUserId, limit } = req.query

    if (!discordUserId) {
      return res.status(400).json({ error: 'discordUserId is required' })
    }

    const history = await getRollHistory(discordUserId, Math.min(Number(limit) || 1000, 1000))
    res.json(history)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// เช็คยอดเงิน
router.get('/api/balance', async (req, res) => {
  try {
    const { discordUserId } = req.query
    if (!discordUserId) {
      return res.status(400).json({ error: 'discordUserId is required' })
    }
    const balance = await getBalance(discordUserId)
    res.json({ balance })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ดึง role ทั้งหมดที่ active (สำหรับ animation)
router.get('/api/roles', async (req, res) => {
  try {
    const roles = await getAllActiveRoles()
    res.json(roles)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
