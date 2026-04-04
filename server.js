process.env.TZ = 'Asia/Bangkok'

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import AuthActivity from './routes/auth.js'
import RollRoutes from './routes/rolls.js'
import AdminRoutes from './routes/admin.js'
import PaymentRoutes from './routes/payment.js'
import { sweepExpiredSessions } from './services/paymentService.js'

const app = express();
const port = process.env.PORT || 3001;
const adminDistDir = fileURLToPath(new URL("./admindist", import.meta.url));
const adminIndexFile = path.join(adminDistDir, "index.html");

// Allow express to parse JSON bodies
app.use(express.json());
app.use(morgan('dev'))

app.use("/", AuthActivity)
app.use("/", RollRoutes)
app.use("/", AdminRoutes)
app.use("/", PaymentRoutes)

app.get("/admin", (_req, res) => {
  res.sendFile(adminIndexFile)
})

app.use("/admin", express.static(adminDistDir))

app.get(/^\/admin\/(?!assets\/|favicon\.svg$|icons\.svg$).*/, (_req, res) => {
  res.sendFile(adminIndexFile)
})

// Sweep expired payment sessions ทุก 1 นาที
setInterval(async () => {
  try {
    const denied = await sweepExpiredSessions()
    if (denied > 0) console.log(`Swept ${denied} expired payment session(s)`)
  } catch (err) {
    console.error('Sweep error:', err.message)
  }
}, 60_000)

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
