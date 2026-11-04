import mysql from 'mysql2/promise';
import { config } from '../config/config.js';

async function columnExists(conn, table, column) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [config.mysql.database, table, column]
  );
  return cols.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [indexes] = await conn.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [config.mysql.database, table, indexName]
  );
  return indexes.length > 0;
}

async function runOptimizationMigration() {
  console.log('🚀 Running TaskPulse DB Optimization & Structural Enhancement Migration...');
  const conn = await mysql.createConnection(config.mysql);

  const appliedChanges = [];

  try {
    // -------------------------------------------------------------
    // 1. USERS TABLE
    // -------------------------------------------------------------
    console.log('\n--- 1. Optimizing users table ---');
    if (!await columnExists(conn, 'users', 'is_online')) {
      await conn.query(`ALTER TABLE users ADD COLUMN is_online BOOLEAN DEFAULT FALSE`);
      appliedChanges.push('users: added is_online column');
    }
    if (!await columnExists(conn, 'users', 'last_seen_at')) {
      await conn.query(`ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMP NULL`);
      appliedChanges.push('users: added last_seen_at column');
    }
    if (!await columnExists(conn, 'users', 'push_token')) {
      await conn.query(`ALTER TABLE users ADD COLUMN push_token VARCHAR(255) NULL`);
      appliedChanges.push('users: added push_token column');
    }
    if (!await columnExists(conn, 'users', 'settings')) {
      await conn.query(`ALTER TABLE users ADD COLUMN settings JSON NULL`);
      appliedChanges.push('users: added settings column');
    }

    if (!await indexExists(conn, 'users', 'idx_users_role')) {
      await conn.query(`ALTER TABLE users ADD INDEX idx_users_role (role)`);
      appliedChanges.push('users: added index idx_users_role');
    }
    if (!await indexExists(conn, 'users', 'idx_users_dept')) {
      await conn.query(`ALTER TABLE users ADD INDEX idx_users_dept (department)`);
      appliedChanges.push('users: added index idx_users_dept');
    }
    if (!await indexExists(conn, 'users', 'idx_users_status')) {
      await conn.query(`ALTER TABLE users ADD INDEX idx_users_status (status)`);
      appliedChanges.push('users: added index idx_users_status');
    }
    if (!await indexExists(conn, 'users', 'idx_users_presence')) {
      await conn.query(`ALTER TABLE users ADD INDEX idx_users_presence (is_online, last_seen_at)`);
      appliedChanges.push('users: added compound index idx_users_presence');
    }

    // -------------------------------------------------------------
    // 2. CHAT CHANNELS TABLE
    // -------------------------------------------------------------
    console.log('\n--- 2. Optimizing chat_channels table ---');
    if (!await columnExists(conn, 'chat_channels', 'avatar')) {
      await conn.query(`ALTER TABLE chat_channels ADD COLUMN avatar TEXT NULL`);
      appliedChanges.push('chat_channels: added avatar column');
    }
    if (!await indexExists(conn, 'chat_channels', 'idx_channels_last_msg')) {
      await conn.query(`ALTER TABLE chat_channels ADD INDEX idx_channels_last_msg (last_message_at DESC)`);
      appliedChanges.push('chat_channels: added index idx_channels_last_msg');
    }
    if (!await indexExists(conn, 'chat_channels', 'idx_channels_created_by')) {
      await conn.query(`ALTER TABLE chat_channels ADD INDEX idx_channels_created_by (created_by)`);
      appliedChanges.push('chat_channels: added index idx_channels_created_by');
    }

    // -------------------------------------------------------------
    // 3. CHAT MESSAGES TABLE
    // -------------------------------------------------------------
    console.log('\n--- 3. Optimizing chat_messages table ---');
    if (!await columnExists(conn, 'chat_messages', 'deleted_at')) {
      await conn.query(`ALTER TABLE chat_messages ADD COLUMN deleted_at TIMESTAMP NULL`);
      appliedChanges.push('chat_messages: added deleted_at column');
    }
    if (!await indexExists(conn, 'chat_messages', 'idx_chat_channel_del_time')) {
      await conn.query(`ALTER TABLE chat_messages ADD INDEX idx_chat_channel_del_time (channel_id, is_deleted, created_at DESC)`);
      appliedChanges.push('chat_messages: added composite index idx_chat_channel_del_time');
    }
    if (!await indexExists(conn, 'chat_messages', 'idx_chat_reply')) {
      await conn.query(`ALTER TABLE chat_messages ADD INDEX idx_chat_reply (reply_to_message_id)`);
      appliedChanges.push('chat_messages: added index idx_chat_reply');
    }
    if (!await indexExists(conn, 'chat_messages', 'idx_chat_task')) {
      await conn.query(`ALTER TABLE chat_messages ADD INDEX idx_chat_task (task_id)`);
      appliedChanges.push('chat_messages: added index idx_chat_task');
    }
    if (!await indexExists(conn, 'chat_messages', 'idx_chat_sender_time')) {
      await conn.query(`ALTER TABLE chat_messages ADD INDEX idx_chat_sender_time (sender_id, created_at DESC)`);
      appliedChanges.push('chat_messages: added index idx_chat_sender_time');
    }

    // -------------------------------------------------------------
    // 4. CHAT MESSAGE RECEIPTS TABLE
    // -------------------------------------------------------------
    console.log('\n--- 4. Optimizing chat_message_receipts table ---');
    if (!await indexExists(conn, 'chat_message_receipts', 'idx_receipt_msg_status')) {
      await conn.query(`ALTER TABLE chat_message_receipts ADD INDEX idx_receipt_msg_status (message_id, status)`);
      appliedChanges.push('chat_message_receipts: added index idx_receipt_msg_status');
    }

    // -------------------------------------------------------------
    // 5. TASKS TABLE
    // -------------------------------------------------------------
    console.log('\n--- 5. Optimizing tasks table ---');
    if (!await indexExists(conn, 'tasks', 'idx_tasks_assignee_status')) {
      await conn.query(`ALTER TABLE tasks ADD INDEX idx_tasks_assignee_status (assignee_id, status)`);
      appliedChanges.push('tasks: added index idx_tasks_assignee_status');
    }
    if (!await indexExists(conn, 'tasks', 'idx_tasks_creator_status')) {
      await conn.query(`ALTER TABLE tasks ADD INDEX idx_tasks_creator_status (creator_id, status)`);
      appliedChanges.push('tasks: added index idx_tasks_creator_status');
    }
    if (!await indexExists(conn, 'tasks', 'idx_tasks_due_date')) {
      await conn.query(`ALTER TABLE tasks ADD INDEX idx_tasks_due_date (due_date)`);
      appliedChanges.push('tasks: added index idx_tasks_due_date');
    }
    if (!await indexExists(conn, 'tasks', 'idx_tasks_dept')) {
      await conn.query(`ALTER TABLE tasks ADD INDEX idx_tasks_dept (department)`);
      appliedChanges.push('tasks: added index idx_tasks_dept');
    }
    if (!await indexExists(conn, 'tasks', 'idx_tasks_priority')) {
      await conn.query(`ALTER TABLE tasks ADD INDEX idx_tasks_priority (priority)`);
      appliedChanges.push('tasks: added index idx_tasks_priority');
    }

    // -------------------------------------------------------------
    // 6. LEAVES TABLE
    // -------------------------------------------------------------
    console.log('\n--- 6. Optimizing leaves table ---');
    if (!await indexExists(conn, 'leaves', 'idx_leaves_user')) {
      await conn.query(`ALTER TABLE leaves ADD INDEX idx_leaves_user (user_id, status)`);
      appliedChanges.push('leaves: added index idx_leaves_user');
    }
    if (!await indexExists(conn, 'leaves', 'idx_leaves_manager')) {
      await conn.query(`ALTER TABLE leaves ADD INDEX idx_leaves_manager (manager_id, status)`);
      appliedChanges.push('leaves: added index idx_leaves_manager');
    }

    console.log('\n✅ All migrations applied successfully!');
    console.log(`Total modifications: ${appliedChanges.length}`);
    console.table(appliedChanges.map((change, index) => ({ index: index + 1, change })));

  } catch (err) {
    console.error('❌ Migration Error:', err);
    throw err;
  } finally {
    await conn.end();
  }
}

runOptimizationMigration().catch(err => {
  console.error('Fatal migration failure:', err);
  process.exit(1);
});
