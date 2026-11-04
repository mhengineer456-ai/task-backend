import mysql from 'mysql2/promise';
import { config } from '../config/config.js';

async function partitionPulseBotAi() {
  console.log('🚀 Starting PulseBot AI Per-User Chat Partitioning...');
  const conn = await mysql.createConnection(config.mysql);

  try {
    // 1. Get all users
    const [users] = await conn.query('SELECT id, name FROM users');
    console.log(`Found ${users.length} users in database.`);

    // 2. Ensure each user has a dedicated chan-ai-${user.id} channel
    for (const u of users) {
      const channelId = `chan-ai-${u.id}`;
      await conn.query(
        `INSERT INTO chat_channels (id, name, type, description, created_by, participant_ids, is_private)
         VALUES (?, '🤖 PulseBot AI Assistant', 'ai', 'Private AI Assistant Copilot powered by Gemini 2.5', ?, ?, 1)
         ON DUPLICATE KEY UPDATE name = '🤖 PulseBot AI Assistant', type = 'ai', is_private = 1`,
        [channelId, u.id, JSON.stringify([u.id])]
      );

      const memberId = `mem-${channelId}-${u.id}`;
      await conn.query(
        `INSERT INTO chat_channel_members (id, channel_id, user_id, role, unread_count)
         VALUES (?, ?, ?, 'owner', 0)
         ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
        [memberId, channelId, u.id]
      );
    }
    console.log('✅ Dedicated AI channels & memberships verified for all users.');

    // 3. Migrate historical chan-ai messages to respective user channels
    const [msgs] = await conn.query(
      "SELECT id, sender_id, is_ai, created_at FROM chat_messages WHERE channel_id = 'chan-ai' ORDER BY created_at ASC"
    );
    console.log(`Found ${msgs.length} historical messages in legacy 'chan-ai'.`);

    let currentUserId = null;
    let migratedCount = 0;
    const userMsgCounts = {};

    for (const msg of msgs) {
      if (!msg.is_ai && msg.sender_id && msg.sender_id !== 'pulse-bot') {
        let senderId = msg.sender_id;
        if (senderId === 'user-paras') senderId = 'usr-1791869100784';
        currentUserId = senderId;
      }

      if (currentUserId) {
        const targetChannelId = `chan-ai-${currentUserId}`;
        await conn.query(
          'UPDATE chat_messages SET channel_id = ? WHERE id = ?',
          [targetChannelId, msg.id]
        );
        migratedCount++;
        userMsgCounts[targetChannelId] = (userMsgCounts[targetChannelId] || 0) + 1;
      }
    }

    // 4. Update last_message metadata on each user's AI channel
    for (const u of users) {
      const channelId = `chan-ai-${u.id}`;
      const [latest] = await conn.query(
        'SELECT id, created_at FROM chat_messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1',
        [channelId]
      );
      if (latest && latest.length > 0) {
        await conn.query(
          'UPDATE chat_channels SET last_message_id = ?, last_message_at = ? WHERE id = ?',
          [latest[0].id, latest[0].created_at, channelId]
        );
      }
    }

    console.log(`\n✅ Successfully partitioned ${migratedCount} messages into private user AI channels!`);
    console.table(Object.entries(userMsgCounts).map(([channel, count]) => ({ channel, messages: count })));

  } catch (err) {
    console.error('❌ Partitioning failed:', err);
    throw err;
  } finally {
    await conn.end();
  }
}

partitionPulseBotAi().catch(err => {
  console.error('Fatal failure:', err);
  process.exit(1);
});
