import express from 'express'
import QRCode from 'qrcode'
import { billPayment } from 'promptparse/generate'
import { createSession, getSessionStatus, matchPayment } from '../services/paymentService.js'

const router = express.Router()

const BILLER_ID = process.env.BILLER_ID || '010753600010286'
const STORE_ID = process.env.STORE_ID || '014000008781403'

// สร้าง payment session + QR code
router.post('/api/payment/create', async (req, res) => {
  try {
    const { discordUserId, amount } = req.body

    if (!discordUserId || !amount) {
      return res.status(400).json({ error: 'discordUserId and amount are required' })
    }

    // สร้าง session (สุ่มสตางค์ + บันทึก DB)
    const session = await createSession(discordUserId, Number(amount))

    // สร้าง QR จากยอดที่สุ่มแล้ว
    const payload = billPayment({
      billerId: BILLER_ID,
      amount: session.displayAmount,
      ref1: STORE_ID,
      ref2: discordUserId,
    })
    const qrDataUrl = await QRCode.toDataURL(payload)

    res.json({
      sessionId: session.sessionId,
      amount: session.displayAmount,
      qr: qrDataUrl,
    })
  } catch (error) {
    console.error('Payment create error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// เช็คสถานะ session (client poll)
router.get('/api/payment/status/:id', async (req, res) => {
  try {
    const session = await getSessionStatus(req.params.id)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }
    res.json({
      sessionId: session.id,
      status: session.status,
      amount: (session.amount / 100).toFixed(2),
    })
  } catch (error) {
    console.error('Payment status error:', error.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Webhook รับ notification จาก Tasker (SCB Easy)
router.post('/api/payment/webhook', async (req, res) => {
  try {
    const { text } = req.body
    console.log('Webhook Received:', req.body)

    if (!text) {
      return res.status(200).send('No text')
    }

    const result = await matchPayment(text)
    if (result) {
      console.log('Payment matched:', result)
    } else {
      console.log('No matching pending session for this amount')
    }

    res.status(200).send('OK')
  } catch (error) {
    console.error('Webhook error:', error.message)
    res.status(200).send('Error')
  }
})

export default router
