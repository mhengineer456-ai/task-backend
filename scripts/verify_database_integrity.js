import mysql from 'mysql2/promise';
import { config } from '../config/config.js';

async function verifyIntegrity() {
  console.log('🔍 [Stage 6 Verification] Testing Database Integrity & Performance Execution Plans...\n');
  const conn = await mysql.createConnection(config.mysql);

  try {
    // 1. Table Count Verification
    console.log('--- 1. Table Record Verification ---');
    const expectedCounts = {
      users: 5,
      tasks: 16,
      chat_messages: 845,
      chat_channels: 16,
      chat_channel_members: 43,
      chat_reactions: 4,
      call_logs: 18,
      notifications: 16,
      ea_daily_tasks: 18,
      ea_followups: 3,
      system_logs: 10092
    };

    let allCountsMatched = true;
    const countResults = [];

    for (const [table, minExpected] of Object.entries(expectedCounts)) {
      const [rows] = await conn.query(`SELECT COUNT(*) as c FROM \`${table}\``);
      const actual = rows[0].c;
      const pass = actual >= minExpected;
      if (!pass) allCountsMatched = false;
      countResults.push({
        table,
        baseline: minExpected,
        current: actual,
        status: pass ? '✅ SAFE (NO DATA LOSS)' : '❌ LOSS DETECTED'
      });
    }
    console.table(countResults);

    // 2. Optimized Indexes Verification
    console.log('\n--- 2. Optimized Indexes Verification ---');
    const requiredIndexes = [
      { table: 'users', index: 'idx_users_presence' },
      { table: 'users', index: 'idx_users_role' },
      { table: 'users', index: 'idx_users_dept' },
      { table: 'users', index: 'idx_users_status' },
      { table: 'chat_channels', index: 'idx_channels_last_msg' },
      { table: 'chat_channels', index: 'idx_channels_created_by' },
      { table: 'chat_messages', index: 'idx_chat_channel_del_time' },
      { table: 'chat_messages', index: 'idx_chat_reply' },
      { table: 'chat_messages', index: 'idx_chat_task' },
      { table: 'chat_message_receipts', index: 'idx_receipt_msg_status' },
      { table: 'tasks', index: 'idx_tasks_assignee_status' },
      { table: 'tasks', index: 'idx_tasks_creator_status' },
      { table: 'tasks', index: 'idx_tasks_due_date' },
      { table: 'tasks', index: 'idx_tasks_dept' },
      { table: 'tasks', index: 'idx_tasks_priority' },
      { table: 'leaves', index: 'idx_leaves_user' },
      { table: 'leaves', index: 'idx_leaves_manager' }
    ];

    const indexResults = [];
    for (const item of requiredIndexes) {
      const [stat] = await conn.query(
        `SELECT INDEX_NAME FROM information_schema.STATISTICS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [config.mysql.database, item.table, item.index]
      );
      const exists = stat.length > 0;
      indexResults.push({
        table: item.table,
        index: item.index,
        active: exists ? '✅ ACTIVE' : '❌ MISSING'
      });
    }
    console.table(indexResults);

    // 3. EXPLAIN Query Performance Optimization Verification
    console.log('\n--- 3. Query Execution Plan (EXPLAIN) Verification ---');

    // 3a. Message retrieval query
    const [msgExplain] = await conn.query(
      `EXPLAIN SELECT id, text, created_at 
       FROM chat_messages 
       WHERE channel_id = 'chan-general' AND is_deleted = 0 
       ORDER BY created_at DESC 
       LIMIT 30`
    );
    console.log('Query: Chat Messages Retrieval');
    console.log(`  Used Key: ${msgExplain[0].key || 'NONE'}`);
    console.log(`  Ref / Rows Examined: ${msgExplain[0].rows}`);
    console.log(`  Extra: ${msgExplain[0].Extra}`);

    // 3b. Task retrieval query
    const [taskExplain] = await conn.query(
      `EXPLAIN SELECT id, title, status 
       FROM tasks 
       WHERE assignee_id = 'u-alex' AND status = 'Assigned'`
    );
    console.log('\nQuery: Task Retrieval by Assignee & Status');
    console.log(`  Used Key: ${taskExplain[0].key || 'NONE'}`);
    console.log(`  Ref / Rows Examined: ${taskExplain[0].rows}`);

    // 3c. Recent channels query
    const [chanExplain] = await conn.query(
      `EXPLAIN SELECT id, name, last_message_at 
       FROM chat_channels 
       ORDER BY last_message_at DESC 
       LIMIT 10`
    );
    console.log('\nQuery: Active Channels Order by Last Message');
    console.log(`  Used Key: ${chanExplain[0].key || 'NONE'}`);
    console.log(`  Ref / Rows Examined: ${chanExplain[0].rows}`);

    console.log('\n🎉 [Stage 6] Database Integrity & Optimization Verification COMPLETE!');
  } finally {
    await conn.end();
  }
}

verifyIntegrity().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
