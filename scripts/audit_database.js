import mysql from 'mysql2/promise';
import { config } from '../config/config.js';

async function auditDatabase() {
  console.log(`🔍 [Audit] Connecting to ${config.mysql.host}:${config.mysql.port}, db: ${config.mysql.database}...`);
  const pool = mysql.createPool(config.mysql);

  try {
    const [tables] = await pool.query(`
      SELECT 
        TABLE_NAME, 
        TABLE_ROWS, 
        DATA_LENGTH, 
        INDEX_LENGTH, 
        TABLE_COLLATION, 
        ENGINE
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME ASC
    `, [config.mysql.database]);

    console.log(`\n========================================================`);
    console.log(`📊 DATABASE AUDIT: ${config.mysql.database}`);
    console.log(`Total Tables Found: ${tables.length}`);
    console.log(`========================================================\n`);

    const fullAudit = [];

    for (const t of tables) {
      const tableName = t.TABLE_NAME;

      // Actual row count
      let exactRows = 0;
      try {
        const [rc] = await pool.query(`SELECT COUNT(*) as cnt FROM \`${tableName}\``);
        exactRows = rc[0].cnt;
      } catch (e) {
        exactRows = t.TABLE_ROWS;
      }

      // Columns
      const [columns] = await pool.query(`
        SELECT 
          COLUMN_NAME, 
          COLUMN_TYPE, 
          IS_NULLABLE, 
          COLUMN_DEFAULT, 
          COLUMN_KEY, 
          EXTRA,
          COLLATION_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION ASC
      `, [config.mysql.database, tableName]);

      // Indexes
      const [indexes] = await pool.query(`
        SELECT 
          INDEX_NAME, 
          NON_UNIQUE, 
          COLUMN_NAME, 
          SEQ_IN_INDEX, 
          CARDINALITY, 
          INDEX_TYPE
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX ASC
      `, [config.mysql.database, tableName]);

      // Foreign Keys
      const [fks] = await pool.query(`
        SELECT 
          CONSTRAINT_NAME, 
          COLUMN_NAME, 
          REFERENCED_TABLE_NAME, 
          REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? 
          AND TABLE_NAME = ? 
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `, [config.mysql.database, tableName]);

      fullAudit.push({
        table: tableName,
        engine: t.ENGINE,
        collation: t.TABLE_COLLATION,
        rows: exactRows,
        dataSizeKB: Math.round(t.DATA_LENGTH / 1024),
        indexSizeKB: Math.round(t.INDEX_LENGTH / 1024),
        columns,
        indexes,
        foreignKeys: fks
      });

      console.log(`📌 Table: ${tableName} (${exactRows} rows, ${(t.DATA_LENGTH / 1024).toFixed(1)} KB)`);
      console.log(`   Columns: ${columns.map(c => `${c.COLUMN_NAME} [${c.COLUMN_TYPE}${c.COLUMN_KEY ? ` KEY:${c.COLUMN_KEY}` : ''}]`).join(', ')}`);
      
      const indexGroups = {};
      for (const idx of indexes) {
        if (!indexGroups[idx.INDEX_NAME]) indexGroups[idx.INDEX_NAME] = { nonUnique: idx.NON_UNIQUE === 1, cols: [] };
        indexGroups[idx.INDEX_NAME].cols.push(idx.COLUMN_NAME);
      }
      console.log(`   Indexes: ${Object.entries(indexGroups).map(([name, data]) => `${name}(${data.cols.join(',')})${data.nonUnique ? '' : ' UNIQUE'}`).join(', ')}`);
      if (fks.length > 0) {
        console.log(`   Foreign Keys: ${fks.map(f => `${f.COLUMN_NAME} -> ${f.REFERENCED_TABLE_NAME}.${f.REFERENCED_COLUMN_NAME}`).join(', ')}`);
      } else {
        console.log(`   Foreign Keys: (None defined in DDL)`);
      }
      console.log('---');
    }

    console.log(`\nAudit completed successfully.`);
  } catch (err) {
    console.error('Audit failed:', err);
  } finally {
    await pool.end();
  }
}

auditDatabase();
