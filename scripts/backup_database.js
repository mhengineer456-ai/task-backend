import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runBackup() {
  console.log('🔄 Starting Database Safety Backup...');
  console.log(`Connecting to: ${config.mysql.host}:${config.mysql.port}, DB: ${config.mysql.database}`);

  const conn = await mysql.createConnection(config.mysql);

  try {
    const [tables] = await conn.query('SHOW TABLES');
    const tableKey = Object.keys(tables[0])[0];
    const tableNames = tables.map(t => t[tableKey]);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, '../data/backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupFilePath = path.join(backupDir, `backup_taskpulse_db_${timestamp}.sql`);
    const stream = fs.createWriteStream(backupFilePath, { encoding: 'utf8' });

    stream.write(`-- ========================================================\n`);
    stream.write(`-- TaskPulse DB Full Safety Backup\n`);
    stream.write(`-- Generated At: ${new Date().toISOString()}\n`);
    stream.write(`-- Database: ${config.mysql.database}\n`);
    stream.write(`-- ========================================================\n\n`);
    stream.write(`SET FOREIGN_KEY_CHECKS = 0;\n\n`);

    let totalRowsBackedUp = 0;
    const tableStats = [];

    for (const tableName of tableNames) {
      // 1. Get Create Table
      const [createTableResult] = await conn.query(`SHOW CREATE TABLE \`${tableName}\``);
      const createTableSql = createTableResult[0]['Create Table'];

      stream.write(`-- Table structure for: ${tableName}\n`);
      stream.write(`${createTableSql};\n\n`);

      // 2. Dump data
      const [rows] = await conn.query(`SELECT * FROM \`${tableName}\``);
      totalRowsBackedUp += rows.length;
      tableStats.push({ table: tableName, rows: rows.length });

      if (rows.length > 0) {
        stream.write(`-- Dumping data for: ${tableName} (${rows.length} rows)\n`);
        for (const row of rows) {
          const keys = Object.keys(row).map(k => `\`${k}\``).join(', ');
          const values = Object.values(row).map(val => {
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number' || typeof val === 'boolean') return val;
            if (val instanceof Date) return conn.escape(val.toISOString().slice(0, 19).replace('T', ' '));
            if (typeof val === 'object') return conn.escape(JSON.stringify(val));
            return conn.escape(val);
          }).join(', ');

          stream.write(`INSERT INTO \`${tableName}\` (${keys}) VALUES (${values});\n`);
        }
        stream.write('\n');
      }
    }

    stream.write(`SET FOREIGN_KEY_CHECKS = 1;\n`);
    stream.end();

    console.log(`\n✅ Backup successfully generated!`);
    console.log(`📁 File: ${backupFilePath}`);
    console.log(`📊 Total tables backed up: ${tableNames.length}`);
    console.log(`📊 Total records backed up: ${totalRowsBackedUp}`);
    console.table(tableStats);

    return backupFilePath;
  } finally {
    await conn.end();
  }
}

runBackup().catch(err => {
  console.error('❌ Backup failed:', err);
  process.exit(1);
});
