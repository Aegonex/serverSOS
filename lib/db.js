import dotenv from 'dotenv'
dotenv.config({ path: '../.env' })
import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  timezone: '+07:00',
})

pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+07:00'")
})

export default pool
