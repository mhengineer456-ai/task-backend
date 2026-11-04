import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pool = null;
let isMysqlConnected = false;

// Initialize MySQL Pool and Auto-Create Schema
export async function initDatabase() {
  try {
    // 1. Connect without DB first to ensure database existence (safe for local & managed cloud)
    try {
      const rootConn = await mysql.createConnection({
        host: config.mysql.host,
        port: config.mysql.port,
        user: config.mysql.user,
        password: config.mysql.password
      });

      await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${config.mysql.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`);
      await rootConn.end();
    } catch (createErr) {
      // In managed cloud databases (Railway/RDS), the database already exists and user may not have CREATE DATABASE privileges
      console.log('ℹ️ [MySQL Database] Using pre-provisioned cloud database');
    }

    // 2. Create Connection Pool for TaskPulse DB
    pool = mysql.createPool(config.mysql);

    // 3. Auto-Execute DDL Schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sqlContent = fs.readFileSync(schemaPath, 'utf8');

      // Strip SQL single-line comments and split by semicolon
      const cleanSql = sqlContent
        .replace(/--.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

      const statements = cleanSql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.toUpperCase().startsWith('CREATE DATABASE') && !s.toUpperCase().startsWith('USE '));

      for (const statement of statements) {
        try {
          await pool.query(statement);
        } catch (stmtErr) {
          if (!stmtErr.message.includes('DUPLICATE') && !stmtErr.message.includes('already exists')) {
            console.warn('Schema statement warning:', stmtErr.message);
          }
        }
      }
    }

    isMysqlConnected = true;
    console.log(`✅ [MySQL Database] Connected successfully to "${config.mysql.database}" on ${config.mysql.host}:${config.mysql.port}`);

    // 4. Run Relational Schema Migration & Column Enhancements
    await runAutoMigrations(pool);

    // 5. Auto-Seed Initial Data if Database is Fresh/Empty
    try {
      const [userCount] = await pool.query('SELECT COUNT(*) as c FROM users');
      if (userCount && userCount[0].c === 0) {
        console.log('🌱 [MySQL Database] Fresh database detected. Auto-seeding initial users, channels and tasks...');
        const { seedDatabase } = await import('./seed.js');
        await seedDatabase();
        console.log('✅ [MySQL Database] Auto-seed complete!');
      }
    } catch (seedCheckErr) {
      console.warn('⚠️ [MySQL Database] Auto-seed check warning:', seedCheckErr.message);
    }

  } catch (error) {
    isMysqlConnected = false;
    console.warn(`⚠️ [MySQL Database] Connection warning (${error.code || error.message}).`);
  }
}

async function runAutoMigrations(dbPool) {
  try {
    // --- Collation Alignment Check: ensure all tables use utf8mb4_0900_ai_ci to prevent collation mismatch errors ---
    try {
      const [mismatched] = await dbPool.query(`
        SELECT DISTINCT TABLE_NAME 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = ? 
          AND COLLATION_NAME IS NOT NULL 
          AND COLLATION_NAME != 'utf8mb4_0900_ai_ci'
      `, [config.mysql.database]);

      if (mismatched && mismatched.length > 0) {
        for (const row of mismatched) {
          await dbPool.query(`ALTER TABLE \`${row.TABLE_NAME}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
        }
        console.log(`✅ [MySQL Database] Aligned ${mismatched.length} tables to utf8mb4_0900_ai_ci collation.`);
      }
    } catch (colErr) {
      console.warn("⚠️ [MySQL Database] Collation alignment check warning:", colErr.message);
    }

    // --- Users Table Checks ---
    const [pwdCol] = await dbPool.query("SHOW COLUMNS FROM users LIKE 'password'");
    if (!pwdCol || pwdCol.length === 0) {
      await dbPool.query("ALTER TABLE users ADD COLUMN password VARCHAR(255) DEFAULT NULL");
    }
    const [onlineCol] = await dbPool.query("SHOW COLUMNS FROM users LIKE 'is_online'");
    if (!onlineCol || onlineCol.length === 0) {
      await dbPool.query("ALTER TABLE users ADD COLUMN is_online BOOLEAN DEFAULT FALSE");
    }
    const [lastSeenCol] = await dbPool.query("SHOW COLUMNS FROM users LIKE 'last_seen_at'");
    if (!lastSeenCol || lastSeenCol.length === 0) {
      await dbPool.query("ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMP NULL");
    }
    const [pushCol] = await dbPool.query("SHOW COLUMNS FROM users LIKE 'push_token'");
    if (!pushCol || pushCol.length === 0) {
      await dbPool.query("ALTER TABLE users ADD COLUMN push_token VARCHAR(255) NULL");
    }
    const [settCol] = await dbPool.query("SHOW COLUMNS FROM users LIKE 'settings'");
    if (!settCol || settCol.length === 0) {
      await dbPool.query("ALTER TABLE users ADD COLUMN settings JSON NULL");
    }

    // --- Tasks Table Checks ---
    const [progCol] = await dbPool.query("SHOW COLUMNS FROM tasks LIKE 'progress'");
    if (!progCol || progCol.length === 0) {
      await dbPool.query("ALTER TABLE tasks ADD COLUMN progress INT DEFAULT 0");
    }
    const [folCol] = await dbPool.query("SHOW COLUMNS FROM tasks LIKE 'followups'");
    if (!folCol || folCol.length === 0) {
      await dbPool.query("ALTER TABLE tasks ADD COLUMN followups JSON");
    }

    // --- Chat Channels Table Checks ---
    const [avatarCol] = await dbPool.query("SHOW COLUMNS FROM chat_channels LIKE 'avatar'");
    if (!avatarCol || avatarCol.length === 0) {
      await dbPool.query("ALTER TABLE chat_channels ADD COLUMN avatar TEXT NULL");
    }
    const [lastMsgCol] = await dbPool.query("SHOW COLUMNS FROM chat_channels LIKE 'last_message_id'");
    if (!lastMsgCol || lastMsgCol.length === 0) {
      await dbPool.query("ALTER TABLE chat_channels ADD COLUMN last_message_id VARCHAR(64) NULL");
    }
    const [lastMsgAtCol] = await dbPool.query("SHOW COLUMNS FROM chat_channels LIKE 'last_message_at'");
    if (!lastMsgAtCol || lastMsgAtCol.length === 0) {
      await dbPool.query("ALTER TABLE chat_channels ADD COLUMN last_message_at TIMESTAMP NULL");
    }
    const [descCol] = await dbPool.query("SHOW COLUMNS FROM chat_channels LIKE 'description'");
    if (!descCol || descCol.length === 0) {
      await dbPool.query("ALTER TABLE chat_channels ADD COLUMN description VARCHAR(255) NULL");
    }
    const [createdCol] = await dbPool.query("SHOW COLUMNS FROM chat_channels LIKE 'created_by'");
    if (!createdCol || createdCol.length === 0) {
      await dbPool.query("ALTER TABLE chat_channels ADD COLUMN created_by VARCHAR(64) NULL");
    }

    // --- Chat Messages Table Checks ---
    const [msgTypeCol] = await dbPool.query("SHOW COLUMNS FROM chat_messages LIKE 'message_type'");
    if (!msgTypeCol || msgTypeCol.length === 0) {
      await dbPool.query("ALTER TABLE chat_messages ADD COLUMN message_type VARCHAR(32) DEFAULT 'text'");
    }
    const [taskIdCol] = await dbPool.query("SHOW COLUMNS FROM chat_messages LIKE 'task_id'");
    if (!taskIdCol || taskIdCol.length === 0) {
      await dbPool.query("ALTER TABLE chat_messages ADD COLUMN task_id VARCHAR(64) NULL");
    }
    const [replyCol] = await dbPool.query("SHOW COLUMNS FROM chat_messages LIKE 'reply_to_message_id'");
    if (!replyCol || replyCol.length === 0) {
      await dbPool.query("ALTER TABLE chat_messages ADD COLUMN reply_to_message_id VARCHAR(64) NULL");
    }
    const [statusCol] = await dbPool.query("SHOW COLUMNS FROM chat_messages LIKE 'status'");
    if (!statusCol || statusCol.length === 0) {
      await dbPool.query("ALTER TABLE chat_messages ADD COLUMN status VARCHAR(32) DEFAULT 'sent'");
    }
    const [delCol] = await dbPool.query("SHOW COLUMNS FROM chat_messages LIKE 'is_deleted'");
    if (!delCol || delCol.length === 0) {
      await dbPool.query("ALTER TABLE chat_messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE");
    }
    const [delAtCol] = await dbPool.query("SHOW COLUMNS FROM chat_messages LIKE 'deleted_at'");
    if (!delAtCol || delAtCol.length === 0) {
      await dbPool.query("ALTER TABLE chat_messages ADD COLUMN deleted_at TIMESTAMP NULL");
    }

    // --- Backfill & Sync Chat Channel Members ---
    const [channels] = await dbPool.query("SELECT * FROM chat_channels");
    const [allUsers] = await dbPool.query("SELECT id FROM users");
    const userIds = (allUsers || []).map(u => u.id);

    for (const channel of (channels || [])) {
      let memberIds = [];
      if (channel.type === 'general' || channel.id === 'chan-general') {
        memberIds = userIds;
      } else if (channel.type === 'ai' || channel.id === 'chan-ai') {
        memberIds = userIds;
      } else {
        const parsed = typeof channel.participant_ids === 'string'
          ? JSON.parse(channel.participant_ids || '[]')
          : (channel.participant_ids || []);
        memberIds = Array.isArray(parsed) ? parsed : [];
      }

      for (const uid of memberIds) {
        if (!uid) continue;
        const memberKey = `mem-${channel.id}-${uid}`;
        await dbPool.query(
          `INSERT INTO chat_channel_members (id, channel_id, user_id, role, unread_count)
           VALUES (?, ?, ?, 'member', 0)
           ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
          [memberKey, channel.id, uid]
        ).catch(() => {});
      }

      // Update last_message_at on chat_channels from latest message in chat_messages
      const [latest] = await dbPool.query(
        "SELECT id, created_at FROM chat_messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1",
        [channel.id]
      );
      if (latest && latest.length > 0) {
        await dbPool.query(
          "UPDATE chat_channels SET last_message_id = ?, last_message_at = ? WHERE id = ?",
          [latest[0].id, latest[0].created_at, channel.id]
        );
      }
    }

    // --- Backfill chat_reactions from chat_messages.reactions if empty ---
    const [reactCount] = await dbPool.query("SELECT COUNT(*) as c FROM chat_reactions");
    if (reactCount && reactCount[0].c === 0) {
      const [msgsWithReactions] = await dbPool.query(
        "SELECT id, channel_id, reactions FROM chat_messages WHERE reactions IS NOT NULL AND reactions != '{}'"
      );
      for (const m of (msgsWithReactions || [])) {
        try {
          const rObj = typeof m.reactions === 'string' ? JSON.parse(m.reactions) : m.reactions;
          for (const [emoji, uList] of Object.entries(rObj || {})) {
            if (Array.isArray(uList)) {
              for (const uName of uList) {
                const reactionId = `react-${m.id}-${encodeURIComponent(emoji)}-${encodeURIComponent(uName)}`;
                await dbPool.query(
                  `INSERT IGNORE INTO chat_reactions (id, message_id, channel_id, user_id, user_name, emoji)
                   VALUES (?, ?, ?, ?, ?, ?)`,
                  [reactionId, m.id, m.channel_id, uName, uName, emoji]
                ).catch(() => {});
              }
            }
          }
        } catch (e) {}
      }
    }

    // --- User Statuses / Stories Table Creation ---
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS user_statuses (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        user_name VARCHAR(128) NOT NULL,
        user_avatar TEXT,
        type VARCHAR(32) NOT NULL DEFAULT 'text',
        content TEXT,
        media_url LONGTEXT,
        background_color VARCHAR(32) DEFAULT '#007AFF',
        text_color VARCHAR(32) DEFAULT '#FFFFFF',
        font_style VARCHAR(64) DEFAULT 'sans',
        privacy_type VARCHAR(32) DEFAULT 'contacts',
        privacy_users JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        is_deleted BOOLEAN DEFAULT FALSE,
        INDEX idx_status_user (user_id, created_at DESC),
        INDEX idx_status_expires (expires_at, is_deleted)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `).catch(() => {});

    // --- Status Views Table Creation ---
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS status_views (
        id VARCHAR(64) PRIMARY KEY,
        status_id VARCHAR(64) NOT NULL,
        viewer_id VARCHAR(64) NOT NULL,
        viewer_name VARCHAR(128) NOT NULL,
        viewer_avatar TEXT,
        viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_status_viewer (status_id, viewer_id),
        INDEX idx_view_status (status_id, viewed_at DESC),
        INDEX idx_view_viewer (viewer_id, viewed_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `).catch(() => {});

    // --- User Status Privacy Preferences Table Creation ---
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS user_status_privacy (
        user_id VARCHAR(64) PRIMARY KEY,
        privacy_type VARCHAR(32) DEFAULT 'contacts',
        excluded_users JSON,
        allowed_users JSON,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `).catch(() => {});

    // --- Call Logs & History Table Creation ---
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS call_logs (
        id VARCHAR(64) PRIMARY KEY,
        caller_id VARCHAR(64) NOT NULL,
        caller_name VARCHAR(128) NOT NULL,
        caller_avatar TEXT,
        receiver_id VARCHAR(64) NOT NULL,
        receiver_name VARCHAR(128) NOT NULL,
        receiver_avatar TEXT,
        call_type VARCHAR(32) NOT NULL DEFAULT 'voice',
        status VARCHAR(32) NOT NULL DEFAULT 'completed',
        duration_seconds INT DEFAULT 0,
        channel_id VARCHAR(64) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        summary TEXT DEFAULT NULL,
        action_items JSON DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_call_caller (caller_id, created_at DESC),
        INDEX idx_call_receiver (receiver_id, created_at DESC),
        INDEX idx_call_channel (channel_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `).catch(() => {});

    // Ensure columns exist on already-created tables
    await dbPool.query(`ALTER TABLE call_logs ADD COLUMN notes TEXT DEFAULT NULL`).catch(() => {});
    await dbPool.query(`ALTER TABLE call_logs ADD COLUMN summary TEXT DEFAULT NULL`).catch(() => {});
    await dbPool.query(`ALTER TABLE call_logs ADD COLUMN action_items JSON DEFAULT NULL`).catch(() => {});

    console.log("✅ [MySQL Database] Schema auto-migrations, statuses, calls, and chat partitions verified.");
  } catch (migErr) {
    console.warn("⚠️ [MySQL Database] Auto-migration warning:", migErr.message);
  }
}

// Helper Query Execution
export async function query(sql, params = []) {
  if (isMysqlConnected && pool) {
    try {
      const [results] = await pool.query(sql, params);
      return results;
    } catch (err) {
      console.error('MySQL Query Error:', err.message);
      throw err;
    }
  }
  return null;
}

export function isConnected() {
  return isMysqlConnected;
}

export default {
  initDatabase,
  query,
  isConnected
};
