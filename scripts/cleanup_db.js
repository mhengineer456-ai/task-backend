import mysql from 'mysql2/promise';
import { config } from '../config/config.js';

async function clean() {
  const conn = await mysql.createConnection(config.mysql);
  
  // 1. Add password column to users if missing
  const [cols] = await conn.query("SHOW COLUMNS FROM users LIKE 'password'");
  if (cols.length === 0) {
    await conn.query("ALTER TABLE users ADD COLUMN password VARCHAR(255) DEFAULT NULL");
    console.log("✅ Added password column to users table");
  } else {
    console.log("ℹ️ password column already exists");
  }

  // 2. Clear all mock tables
  await conn.query("DELETE FROM chat_messages");
  await conn.query("DELETE FROM ea_daily_tasks");
  await conn.query("DELETE FROM ea_meetings");
  await conn.query("DELETE FROM ea_followups");
  await conn.query("DELETE FROM leaves");
  await conn.query("DELETE FROM tasks");
  await conn.query("DELETE FROM pending_users");
  await conn.query("DELETE FROM users");

  console.log("✅ Cleared all mock data from MySQL");

  const [u] = await conn.query("SELECT COUNT(*) as c FROM users");
  console.log("Total users in DB now:", u[0].c);

  await conn.end();
}

clean().catch(err => {
  console.error("Cleanup error:", err);
  process.exit(1);
});
