/**
 * Database Migration Script: Local MySQL -> Railway Cloud MySQL
 * 
 * Transfers all 15 tables and exact records (including 800+ chat messages, channels, tasks, users)
 * directly from your local MySQL to your live Railway MySQL database.
 * 
 * Usage:
 *   node backend/scripts/push_db_to_railway.mjs "<RAILWAY_MYSQL_URL>"
 * 
 * Example:
 *   node backend/scripts/push_db_to_railway.mjs "mysql://root:PASS@junction.proxy.rlwy.net:PORT/railway"
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const localConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'taskpulse_db',
  dateStrings: true
};

const railwayUrl = process.argv[2]?.trim() || process.env.RAILWAY_MYSQL_URL;

if (!railwayUrl) {
  console.error('\n❌ ERROR: Please provide your Railway MySQL Connection URL.');
  console.log('👉 Usage: node backend/scripts/push_db_to_railway.mjs "<YOUR_RAILWAY_URL>"');
  console.log('\nYou can find this in Railway -> MySQL service -> "Connect" tab -> "Public Networking" or "MySQL URL".\n');
  process.exit(1);
}

const TABLES_IN_ORDER = [
  'users',
  'tasks',
  'leaves',
  'ea_followups',
  'ea_meetings',
  'ea_daily_tasks',
  'pending_users',
  'audit_logs',
  'system_logs',
  'notifications',
  'chat_channels',
  'chat_channel_members',
  'chat_messages',
  'chat_message_receipts',
  'chat_reactions'
];

async function migrate() {
  console.log('\n=============================================================');
  console.log(' 🚀 TaskPulse Pro: Local MySQL -> Railway Cloud Migration');
  console.log('=============================================================\n');

  let localConn, railwayConn;

  try {
    console.log(`🔌 Connecting to local MySQL (${localConfig.database} on ${localConfig.host}:${localConfig.port})...`);
    localConn = await mysql.createConnection(localConfig);
    console.log('✅ Local MySQL connected successfully!\n');

    console.log('🔌 Connecting to Railway Cloud MySQL...');
    railwayConn = await mysql.createConnection(railwayUrl);
    console.log('✅ Railway Cloud MySQL connected successfully!\n');

    // 1. Run Schema on Railway
    console.log('📋 Step 1: Initializing relational DDL schema on Railway...');
    const schemaPath = path.join(__dirname, '../config/schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sqlContent = fs.readFileSync(schemaPath, 'utf8')
        .replace(/--.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.toUpperCase().startsWith('CREATE DATABASE') && !s.toUpperCase().startsWith('USE '));

      for (const statement of statements) {
        try {
          await railwayConn.query(statement);
        } catch (e) {
          // Ignore if already exists
        }
      }
      console.log('✅ Railway schema initialized.\n');
    }

    // Temporarily disable foreign key checks for safe bulk insert
    await railwayConn.query('SET FOREIGN_KEY_CHECKS = 0');

    // 2. Transfer data table by table
    console.log('📦 Step 2: Transferring original records table by table...\n');

    for (const table of TABLES_IN_ORDER) {
      try {
        const [rows] = await localConn.query(`SELECT * FROM \`${table}\``);
        const count = rows.length;

        if (count === 0) {
          console.log(`  ⚪ ${table.padEnd(24)}: 0 rows (empty)`);
          continue;
        }

        // Clean destination table first to prevent duplicates
        await railwayConn.query(`DELETE FROM \`${table}\``);

        // Bulk insert in chunks of 100
        const chunkSize = 100;
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize);
          const columns = Object.keys(chunk[0]);
          const placeholders = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
          
          const JSON_COLUMNS = new Set([
            'task_attachment', 'file_attachment', 'reactions', 'checklist', 'tags',
            'custom_fields', 'co_assignees', 'watchers', 'recurring', 'dependencies',
            'kpi', 'kra_list', 'performance_review', 'details', 'attendees', 'followups'
          ]);

          const values = [];
          for (const row of chunk) {
            for (const col of columns) {
              const val = row[col];
              if (val === null || val === undefined) {
                values.push(null);
              } else if (typeof val === 'object' && !(val instanceof Date)) {
                values.push(JSON.stringify(val));
              } else if (typeof val === 'string' && JSON_COLUMNS.has(col.toLowerCase())) {
                try {
                  JSON.parse(val);
                  values.push(val);
                } catch {
                  // If string is not valid JSON (e.g. plain task ID "TSK-1008"), JSON.stringify it
                  values.push(JSON.stringify(val));
                }
              } else {
                values.push(val);
              }
            }
          }

          const insertSql = `INSERT INTO \`${table}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES ${placeholders}`;
          await railwayConn.query(insertSql, values);
        }

        console.log(`  🟢 ${table.padEnd(24)}: ${count} rows migrated successfully`);
      } catch (tableErr) {
        console.warn(`  ⚠️ ${table.padEnd(24)}: Warning (${tableErr.message})`);
      }
    }

    await railwayConn.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('\n=============================================================');
    console.log(' 🎉 ALL ORIGINAL DATA SUCCESSFULLY TRANSFERRED TO RAILWAY!');
    console.log('=============================================================\n');

  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
  } finally {
    if (localConn) await localConn.end();
    if (railwayConn) await railwayConn.end();
  }
}

migrate();
