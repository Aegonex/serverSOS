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

const app = express();
const port = process.env.PORT || 3001;
const clientDistDir = fileURLToPath(new URL("../client-react/dist", import.meta.url));
const clientIndexFile = path.join(clientDistDir, "index.html");
const adminDistDir = fileURLToPath(new URL("../admin-panel/dist", import.meta.url));
const adminIndexFile = path.join(adminDistDir, "index.html");

// Allow express to parse JSON bodies
app.use(express.json());
app.use(morgan('dev'))

app.use("/", AuthActivity)
app.use("/", RollRoutes)
app.use("/", AdminRoutes)

app.get("/admin", (_req, res) => {
  res.sendFile(adminIndexFile)
})

app.use("/admin", express.static(adminDistDir))

app.get(/^\/admin\/(?!assets\/|favicon\.svg$|icons\.svg$).*/, (_req, res) => {
  res.sendFile(adminIndexFile)
})

app.use(express.static(clientDistDir))

app.get(/^\/(?!api(?:\/|$)|admin(?:\/|$)).*/, (_req, res) => {
  res.sendFile(clientIndexFile)
})

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
