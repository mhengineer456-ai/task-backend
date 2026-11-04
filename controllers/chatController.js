import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, isConnected } from '../config/db.js';
import { config } from '../config/config.js';
import {
  broadcastChatMessage,
  broadcastReaction,
  broadcastChannelCreated,
  broadcastTaskCreated,
  broadcastNotification
} from '../socket.js';
import { logService } from '../services/logService.js';
import { generateJobOrderPdf, generatePartyReportPdf } from '../services/pdfService.js';
import { processUniversalQuery, loadFactorySheetsData } from '../services/aiQueryEngine.js';
import { buildAiAggregatedContext } from '../services/aiContextAggregator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getSheetsData = () => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../data/sheetsData.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
};

export const getChannels = async (req, res) => {
  try {
    const { userId } = req.query;

    if (isConnected()) {
      let rows = [];

      if (userId) {
        // High-performance relational query leveraging indexed chat_channel_members join
        rows = await query(`
          SELECT
            c.id, c.name, c.type, c.avatar, c.description, c.created_by, c.is_private,
            c.participant_ids, c.last_message_id, c.last_message_at, c.created_at,
            COALESCE(cm.unread_count, 0) as unread_count,
            cm.last_read_message_id, cm.is_muted, cm.is_pinned, cm.is_archived
          FROM chat_channels c
          LEFT JOIN chat_channel_members cm ON c.id = cm.channel_id AND cm.user_id = ?
          WHERE c.is_private = 0 OR cm.user_id = ? OR c.id = 'chan-ai' OR c.id = 'chan-general'
          ORDER BY COALESCE(cm.is_pinned, 0) DESC, COALESCE(c.last_message_at, c.created_at) DESC
        `, [userId, userId]);
      } else {
        rows = await query('SELECT * FROM chat_channels ORDER BY created_at ASC');
      }

      let allUsers = [];
      try {
        allUsers = await query('SELECT id, name, role, department, avatar FROM users');
      } catch (e) {}

      const formatted = (rows || []).map(c => {
        let participantIds = typeof c.participant_ids === 'string'
          ? JSON.parse(c.participant_ids || '[]')
          : (c.participant_ids || []);

        let targetUser = null;
        let roleBadge = c.type === 'ai' ? 'AI Assistant' : c.type === 'direct' ? 'Direct Message' : 'Team Channel';
        let avatar = c.avatar || '';

        if (c.type === 'direct' || (typeof c.id === 'string' && c.id.startsWith('dm-'))) {
          let otherId = null;
          if (userId) {
            otherId = participantIds.find(pid => String(pid) !== String(userId));
          }
          if (!otherId && typeof c.id === 'string' && c.id.startsWith('dm-')) {
            const parts = c.id.replace('dm-', '').split('-');
            otherId = parts.find(pid => String(pid) !== String(userId));
          }
          if (otherId) {
            targetUser = allUsers.find(u => String(u.id) === String(otherId));
            if (targetUser) {
              roleBadge = `${targetUser.role} • ${targetUser.department || 'Team'}`;
              avatar = targetUser.avatar || avatar;
            }
          }
        }

        return {
          ...c,
          name: (c.type === 'direct' && targetUser) ? targetUser.name : c.name,
          participantIds,
          isPrivate: Boolean(c.is_private),
          roleBadge: c.role_badge || roleBadge,
          avatar: (targetUser && targetUser.avatar) ? targetUser.avatar : avatar,
          targetUser,
          unreadCount: Number(c.unread_count || 0),
          isMuted: Boolean(c.is_muted),
          isPinned: Boolean(c.is_pinned),
          isArchived: Boolean(c.is_archived)
        };
      });

      return res.json({ success: true, channels: formatted });
    }

    res.json({ success: true, channels: [] });
  } catch (error) {
    console.error('Error in getChannels controller:', error);
    res.status(500).json({ success: false, error: 'Database fetch channels failed' });
  }
};

export const getMessagesByChannel = async (req, res) => {
  try {
    const { channelId } = req.params;
    const {
      limit = 30,
      before = null,
      days = null,
      userId = null
    } = req.query;

    const parsedLimit = Math.min(Math.max(Number(limit) || 30, 5), 100);

    if (isConnected()) {
      let rows = [];
      let hasMore = false;
      const targetDays = days !== null && days !== undefined && !isNaN(Number(days)) ? Number(days) : (before ? null : 3);

      if (before) {
        // SCROLL-UP PAGINATION: Fetch older messages strictly before the cursor timestamp
        const innerSql = `
          SELECT m.*, u.avatar AS user_avatar
          FROM chat_messages m
          LEFT JOIN users u ON m.sender_id = u.id
          WHERE m.channel_id = ? AND m.created_at < ?
          ORDER BY m.created_at DESC
          LIMIT ?
        `;
        const pagedRows = await query(innerSql, [channelId, before, parsedLimit]);
        // Reverse to chronological order (oldest to newest)
        rows = pagedRows.reverse();
      } else if (targetDays !== null && targetDays > 0) {
        // INITIAL OPEN (Default Last 3 Days like WhatsApp):
        // Fetch all messages within the last `targetDays` (default 3 days)
        const daysSql = `
          SELECT m.*, u.avatar AS user_avatar
          FROM chat_messages m
          LEFT JOIN users u ON m.sender_id = u.id
          WHERE m.channel_id = ? AND m.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          ORDER BY m.created_at ASC
          LIMIT 150
        `;
        rows = await query(daysSql, [channelId, targetDays]);

        // Fallback: If last 3 days has fewer than 15 messages (e.g. inactive or fresh chat),
        // fetch the latest parsedLimit messages so the user always sees recent context!
        if (rows.length < 15) {
          const fallbackSql = `
            SELECT * FROM (
              SELECT m.*, u.avatar AS user_avatar
              FROM chat_messages m
              LEFT JOIN users u ON m.sender_id = u.id
              WHERE m.channel_id = ?
              ORDER BY m.created_at DESC
              LIMIT ?
            ) AS sub ORDER BY sub.created_at ASC
          `;
          rows = await query(fallbackSql, [channelId, parsedLimit]);
        }
      } else {
        // Standard limit query
        const sql = `
          SELECT * FROM (
            SELECT m.*, u.avatar AS user_avatar
            FROM chat_messages m
            LEFT JOIN users u ON m.sender_id = u.id
            WHERE m.channel_id = ?
            ORDER BY m.created_at DESC
            LIMIT ?
          ) AS sub ORDER BY sub.created_at ASC
        `;
        rows = await query(sql, [channelId, parsedLimit]);
      }

      // Check if there are older messages available before the oldest message returned
      const oldestDate = rows.length > 0 ? rows[0].created_at : null;
      if (oldestDate) {
        const [olderCheck] = await query(
          'SELECT 1 FROM chat_messages WHERE channel_id = ? AND created_at < ? LIMIT 1',
          [channelId, oldestDate]
        );
        hasMore = Boolean(olderCheck);
      }

      // If userId is provided, mark unread count as 0 in chat_channel_members
      if (userId) {
        await query(
          'UPDATE chat_channel_members SET unread_count = 0, last_read_at = CURRENT_TIMESTAMP WHERE channel_id = ? AND user_id = ?',
          [channelId, userId]
        ).catch(() => {});
      }

      const formatted = (rows || []).map(m => ({
        ...m,
        senderId: m.sender_id || m.senderId,
        senderName: m.sender_name || m.senderName,
        senderRole: m.sender_role || m.senderRole,
        senderAvatar: m.user_avatar || m.sender_avatar || m.senderAvatar || '',
        imageUrl: m.image_url || m.imageUrl || null,
        audioUrl: m.audio_url || m.audioUrl || null,
        fileAttachment: typeof m.file_attachment === 'string' ? JSON.parse(m.file_attachment || 'null') : (m.file_attachment || null),
        pdfAttachment: (() => {
          try {
            const parsed = typeof m.file_attachment === 'string' ? JSON.parse(m.file_attachment) : m.file_attachment;
            return parsed?.downloadUrl ? parsed : (parsed?.pdfAttachment || null);
          } catch (e) { return null; }
        })(),
        imageAttachment: (() => {
          try {
            const parsed = typeof m.file_attachment === 'string' ? JSON.parse(m.file_attachment) : m.file_attachment;
            return parsed?.imageAttachment || (parsed?.url && parsed?.lotNumber ? parsed : null);
          } catch (e) { return null; }
        })(),
        imageGallery: (() => {
          try {
            const parsed = typeof m.file_attachment === 'string' ? JSON.parse(m.file_attachment) : m.file_attachment;
            return parsed?.imageGallery || null;
          } catch (e) { return null; }
        })(),
        trackingData: (() => {
          try {
            const parsed = typeof m.file_attachment === 'string' ? JSON.parse(m.file_attachment) : m.file_attachment;
            return parsed?.trackingData || null;
          } catch (e) { return null; }
        })(),
        reactions: typeof m.reactions === 'string' ? JSON.parse(m.reactions || '{}') : (m.reactions || {}),
        taskAttachment: (() => {
          if (!m.task_attachment) return null;
          if (typeof m.task_attachment === 'object') return m.task_attachment;
          try {
            return JSON.parse(m.task_attachment);
          } catch (e) {
            return m.task_attachment;
          }
        })(),
        isAi: Boolean(m.is_ai),
        timestamp: m.created_at || m.timestamp,
        status: m.status || 'sent'
      }));

      const seenIds = new Set();
      const dedupedMessages = [];
      for (const m of formatted) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          dedupedMessages.push(m);
        }
      }

      return res.json({
        success: true,
        messages: dedupedMessages,
        hasMore,
        oldestTimestamp: oldestDate,
        newestTimestamp: rows.length > 0 ? rows[rows.length - 1].created_at : null,
        count: dedupedMessages.length
      });
    }

    res.json({ success: true, messages: [], hasMore: false });
  } catch (error) {
    console.error('Error in getMessagesByChannel controller:', error);
    res.status(500).json({ success: false, error: 'Database fetch messages failed' });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const {
      channelId,
      senderId,
      senderName,
      senderRole,
      senderAvatar,
      text,
      imageUrl,
      audioUrl,
      fileAttachment,
      taskAttachment,
      replyToMessageId = null,
      isAi
    } = req.body;

    if (!channelId || !senderId || (!text && !imageUrl && !audioUrl && !fileAttachment && !taskAttachment)) {
      return res.status(400).json({ success: false, error: 'Channel ID, sender ID, and content (text, image, audio, or attachment) are required.' });
    }

    const messageId = req.body.id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const timestamp = req.body.timestamp || new Date().toISOString();
    const resolvedReplyId = replyToMessageId || req.body.reply_to_message_id || null;

    // Determine message type
    let messageType = 'text';
    if (audioUrl) messageType = 'audio';
    else if (imageUrl) messageType = 'image';
    else if (fileAttachment) messageType = 'document';
    else if (taskAttachment) messageType = 'task_ref';

    // Extract taskId for relational indexing
    let taskId = null;
    if (taskAttachment) {
      if (typeof taskAttachment === 'string') taskId = taskAttachment;
      else if (taskAttachment.id) taskId = taskAttachment.id;
    }

    let resolvedAvatar = senderAvatar || '';
    if (isConnected() && senderId && senderId !== 'system' && !isAi) {
      try {
        const uRows = await query('SELECT avatar FROM users WHERE id = ?', [senderId]);
        if (uRows && uRows[0] && uRows[0].avatar) {
          resolvedAvatar = uRows[0].avatar;
        }
      } catch (e) {}
    }

    const createdMessage = {
      id: messageId,
      channelId,
      senderId,
      senderName: senderName || 'User',
      senderRole: senderRole || 'Employee',
      senderAvatar: resolvedAvatar,
      messageType,
      text: text || '',
      imageUrl: imageUrl || null,
      audioUrl: audioUrl || null,
      fileAttachment: fileAttachment || null,
      reactions: {},
      taskAttachment: taskAttachment || null,
      taskId,
      replyToMessageId: resolvedReplyId,
      isAi: !!isAi,
      status: 'sent',
      timestamp
    };

    if (isConnected()) {
      // 1. Insert message with indexing columns
      await query(
        `INSERT INTO chat_messages (
          id, channel_id, sender_id, sender_name, sender_role, sender_avatar,
          message_type, text, image_url, audio_url, file_attachment, reactions,
          task_attachment, task_id, reply_to_message_id, is_ai, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          messageId,
          channelId,
          senderId,
          senderName || 'User',
          senderRole || 'Employee',
          resolvedAvatar,
          messageType,
          text || '',
          imageUrl || null,
          audioUrl || null,
          fileAttachment ? JSON.stringify(fileAttachment) : null,
          JSON.stringify({}),
          taskAttachment ? JSON.stringify(taskAttachment) : null,
          taskId,
          resolvedReplyId,
          isAi ? 1 : 0,
          'sent'
        ]
      );

      // 2. Update channel last_message metadata
      await query(
        'UPDATE chat_channels SET last_message_id = ?, last_message_at = CURRENT_TIMESTAMP WHERE id = ?',
        [messageId, channelId]
      ).catch(() => {});

      // 3. Update unread_count for other channel members
      await query(
        'UPDATE chat_channel_members SET unread_count = unread_count + 1 WHERE channel_id = ? AND user_id != ?',
        [channelId, senderId]
      ).catch(() => {});

      // 4. Ensure sender is registered in chat_channel_members and has unread_count = 0
      const memberKey = `mem-${channelId}-${senderId}`;
      await query(
        `INSERT INTO chat_channel_members (id, channel_id, user_id, role, unread_count, last_read_message_id, last_read_at)
         VALUES (?, ?, ?, 'member', 0, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE unread_count = 0, last_read_message_id = ?, last_read_at = CURRENT_TIMESTAMP`,
        [memberKey, channelId, senderId, messageId, messageId]
      ).catch(() => {});

      // 5. Enterprise system log entry
      logService.info('CHAT', messageType === 'audio' ? 'VOICE_NOTE_SENT' : 'MESSAGE_SENT', {
        userId: senderId,
        userName: senderName,
        userRole: senderRole,
        entityType: 'chat_message',
        entityId: messageId,
        details: { channelId, messageType, hasAttachment: !!fileAttachment || !!imageUrl, taskId }
      }).catch(() => {});
    }

    // Broadcast in real-time to channel and global activity
    broadcastChatMessage(channelId, createdMessage);

    return res.status(201).json({
      success: true,
      message: createdMessage
    });
  } catch (error) {
    console.error('Error in sendMessage controller:', error);
    res.status(500).json({ success: false, error: 'Message insertion failed' });
  }
};

export const toggleReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji, userId, userName } = req.body;

    if (!messageId || !emoji || !userId) {
      return res.status(400).json({ success: false, error: 'messageId, emoji, and userId are required.' });
    }

    if (isConnected()) {
      const rows = await query('SELECT * FROM chat_messages WHERE id = ?', [messageId]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Message not found' });
      }

      const msg = rows[0];
      const channelId = msg.channel_id;

      // 1. Normalized Atomic Reaction Table Operation
      const existingReaction = await query(
        'SELECT id FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
        [messageId, userId, emoji]
      );

      let reactionAction = 'ADDED';
      if (existingReaction && existingReaction.length > 0) {
        // Toggle OFF: delete
        await query('DELETE FROM chat_reactions WHERE id = ?', [existingReaction[0].id]);
        reactionAction = 'REMOVED';
      } else {
        // Toggle ON: insert
        const reactionId = `react-${messageId}-${encodeURIComponent(emoji)}-${encodeURIComponent(userId)}`;
        await query(
          `INSERT INTO chat_reactions (id, message_id, channel_id, user_id, user_name, emoji)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP`,
          [reactionId, messageId, channelId, userId, userName || userId, emoji]
        );
      }

      // 2. Re-aggregate reactions from normalized table for fast single-row cache
      const allReactions = await query(
        'SELECT emoji, user_name FROM chat_reactions WHERE message_id = ?',
        [messageId]
      );

      const reactions = {};
      (allReactions || []).forEach(r => {
        if (!reactions[r.emoji]) reactions[r.emoji] = [];
        reactions[r.emoji].push(r.user_name);
      });

      // Update cache on message row
      await query('UPDATE chat_messages SET reactions = ? WHERE id = ?', [JSON.stringify(reactions), messageId]);

      // 3. Log event
      logService.info('CHAT', `REACTION_${reactionAction}`, {
        userId,
        userName,
        entityType: 'chat_reaction',
        entityId: messageId,
        details: { channelId, emoji }
      }).catch(() => {});

      // 4. Broadcast reaction change live to all clients
      broadcastReaction(messageId, channelId, reactions);

      return res.json({ success: true, messageId, channelId, reactions });
    }

    res.json({ success: true, messageId, reactions: { [emoji]: [userName] } });
  } catch (error) {
    console.error('Error in toggleReaction controller:', error);
    res.status(500).json({ success: false, error: 'Reaction update failed' });
  }
};

export const createOrGetDirectChannel = async (req, res) => {
  try {
    const { currentUserId, targetUserId } = req.body;
    if (!currentUserId || !targetUserId) {
      return res.status(400).json({ success: false, error: 'Both currentUserId and targetUserId are required' });
    }

    const sorted = [currentUserId, targetUserId].sort();
    const channelId = `dm-${sorted.join('-')}`;

    if (isConnected()) {
      const userRows = await query('SELECT id, name, role, department, avatar FROM users WHERE id = ?', [targetUserId]);
      const targetUser = userRows && userRows[0] ? userRows[0] : { id: targetUserId, name: 'Team Member', role: 'Employee', department: 'Team' };

      const existing = await query('SELECT * FROM chat_channels WHERE id = ?', [channelId]);
      if (existing && existing.length > 0) {
        // Ensure both members exist in chat_channel_members
        for (const uid of [currentUserId, targetUserId]) {
          await query(
            `INSERT INTO chat_channel_members (id, channel_id, user_id, role)
             VALUES (?, ?, ?, 'member')
             ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
            [`mem-${channelId}-${uid}`, channelId, uid]
          ).catch(() => {});
        }

        return res.json({
          success: true,
          channel: {
            ...existing[0],
            name: targetUser.name,
            type: 'direct',
            roleBadge: `${targetUser.role} • ${targetUser.department || 'Team'}`,
            avatar: targetUser.avatar,
            participantIds: [currentUserId, targetUserId],
            isPrivate: true,
            targetUser
          }
        });
      }

      // Create new direct channel in chat_channels
      await query(
        `INSERT INTO chat_channels (id, name, type, created_by, participant_ids, is_private)
         VALUES (?, ?, 'direct', ?, ?, 1)`,
        [channelId, targetUser.name, currentUserId, JSON.stringify([currentUserId, targetUserId])]
      );

      // Create distinct member rows in chat_channel_members for both participants
      for (const uid of [currentUserId, targetUserId]) {
        await query(
          `INSERT INTO chat_channel_members (id, channel_id, user_id, role, unread_count)
           VALUES (?, ?, ?, 'member', 0)
           ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
          [`mem-${channelId}-${uid}`, channelId, uid]
        ).catch(() => {});
      }

      logService.info('CHAT', 'DIRECT_CHANNEL_CREATED', {
        userId: currentUserId,
        entityType: 'chat_channel',
        entityId: channelId,
        details: { targetUserId }
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        channel: {
          id: channelId,
          name: targetUser.name,
          type: 'direct',
          roleBadge: `${targetUser.role} • ${targetUser.department || 'Team'}`,
          avatar: targetUser.avatar,
          participantIds: [currentUserId, targetUserId],
          isPrivate: true,
          targetUser
        }
      });
    }

    res.json({ success: true, channel: { id: channelId, name: 'Direct Message', type: 'direct', participantIds: [currentUserId, targetUserId] } });
  } catch (error) {
    console.error('Error in createOrGetDirectChannel controller:', error);
    res.status(500).json({ success: false, error: 'Direct channel creation failed' });
  }
};

/**
 * Helper: Detects and processes AI Task Delegation with user tagging and EA follow-up
 */
async function processAiTaskDelegation({
  message = '',
  taggedUserId = null,
  requireEaFollowup = false,
  userId = 'usr-1',
  channelId = 'chan-ai'
}) {
  if (!isConnected()) return null;

  try {
    const rawMsg = (message || '').trim();
    if (!rawMsg) return null;

    const allUsers = await query('SELECT id, name, email, role, department, avatar FROM users').catch(() => []);
    if (!allUsers || allUsers.length === 0) return null;

    let targetUser = null;
    if (taggedUserId) {
      targetUser = allUsers.find(u => String(u.id) === String(taggedUserId));
    }

    // Check for @mention in text if taggedUserId was not explicitly set
    let cleanedMentionName = null;
    if (!targetUser) {
      const atMatch = rawMsg.match(/@([a-zA-Z0-9_\s]+?)(?:\s+|$|:|,)/);
      if (atMatch) {
        const candidate = atMatch[1].trim().toLowerCase();
        targetUser = allUsers.find(u => {
          const uName = (u.name || '').trim().toLowerCase();
          return uName === candidate || uName.startsWith(candidate) || candidate.startsWith(uName);
        });
        if (targetUser) {
          cleanedMentionName = atMatch[0];
        }
      }
    }

    // Only proceed if a user was tagged or @mentioned
    if (!targetUser) return null;

    const creatorUser = allUsers.find(u => String(u.id) === String(userId)) || {
      id: userId,
      name: 'Manager / Workspace User',
      role: 'Manager',
      department: 'Operations'
    };

    // Determine if EA follow-up was requested
    const isEa = Boolean(
      requireEaFollowup ||
      /\b(ea|executive\s*assistant|follow\s*up|followup|follow-up)\b/i.test(rawMsg)
    );

    // Clean task title
    let cleanTitle = rawMsg;
    if (cleanedMentionName) {
      cleanTitle = cleanTitle.replace(cleanedMentionName, '');
    }
    cleanTitle = cleanTitle
      .replace(/@\S+/g, '')
      .replace(/^(create\s*task|task|assign\s*task|assign\s*to\s*[^:]+:|please|kripya|assign)\s*/i, '')
      .replace(/\s*(with|and)\s*ea\s*follow\s*up.*$/i, '')
      .trim();

    if (!cleanTitle || cleanTitle.length < 3) {
      cleanTitle = `Task assigned to ${targetUser.name}: ${rawMsg.slice(0, 40)}`;
    }

    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

    const taskId = `TSK-${Math.floor(1000 + Math.random() * 9000)}`;
    const nowIso = new Date().toISOString();
    const dueDate = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 16);

    const taskRecord = {
      id: taskId,
      title: cleanTitle,
      description: rawMsg,
      category: 'Production & Operations',
      department: targetUser.department || creatorUser.department || 'Operations',
      project: 'Factory Suite Pro',
      assignee_id: targetUser.id,
      creator_id: creatorUser.id,
      priority: 'High',
      status: 'Assigned',
      start_date: nowIso.slice(0, 16),
      due_date: dueDate,
      estimated_hours: 4,
      tags: JSON.stringify(['AI-Delegated', ...(isEa ? ['EA-Followup'] : [])]),
      checklist: '[]',
      comments: '[]',
      activity_log: JSON.stringify([
        {
          id: `act-${Date.now()}`,
          timestamp: nowIso,
          userId: creatorUser.id,
          action: `Task created via AI Copilot by ${creatorUser.name} and assigned to ${targetUser.name}${isEa ? ' with EA follow-up' : ''}`
        }
      ]),
      progress: 0,
      followups: '[]'
    };

    // 1. Insert into tasks table
    await query(`
      INSERT INTO tasks (
        id, title, description, category, department, project, assignee_id,
        creator_id, priority, status, start_date, due_date, estimated_hours,
        tags, checklist, comments, activity_log, progress, followups
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      taskRecord.id, taskRecord.title, taskRecord.description, taskRecord.category,
      taskRecord.department, taskRecord.project, taskRecord.assignee_id, taskRecord.creator_id,
      taskRecord.priority, taskRecord.status, taskRecord.start_date, taskRecord.due_date,
      taskRecord.estimated_hours, taskRecord.tags, taskRecord.checklist, taskRecord.comments,
      taskRecord.activity_log, taskRecord.progress, taskRecord.followups
    ]);

    // 2. Broadcast task:created event
    broadcastTaskCreated({
      ...taskRecord,
      assigneeId: targetUser.id,
      creatorId: creatorUser.id,
      assigneeName: targetUser.name,
      creatorName: creatorUser.name,
      tags: ['AI-Delegated', ...(isEa ? ['EA-Followup'] : [])]
    });

    // 3. Insert and broadcast notification to the tagged user
    const userNotifId = `notif-${Date.now()}`;
    const userNotif = {
      id: userNotifId,
      title: '📋 New Task Assigned via AI',
      message: `Task "${cleanTitle}" (${taskId}) has been assigned to you by ${creatorUser.name}.`,
      type: 'assignment',
      taskId: taskId,
      timestamp: nowIso
    };

    await query(
      'INSERT INTO notifications (id, title, message, type, task_id, user_id, is_read) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [userNotif.id, userNotif.title, userNotif.message, userNotif.type, userNotif.taskId, targetUser.id]
    ).catch(() => {});

    broadcastNotification(userNotif, targetUser.id);

    // 4. If EA follow-up requested, create EA follow-up and notify all EA users
    let eaFollowupId = null;
    let eaAssignedUser = null;

    if (isEa) {
      eaFollowupId = `fa-${Date.now()}`;
      const eaUsers = allUsers.filter(u => u.role === 'EA');
      eaAssignedUser = eaUsers.length > 0 ? eaUsers[0] : null;

      await query(`
        INSERT INTO ea_followups (
          id, task_id, task_title, assignee_id, assignee_name, channel,
          action_notes, action_required, next_followup_date, status,
          is_escalated_to_md, logged_by, logged_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        eaFollowupId,
        taskId,
        cleanTitle,
        targetUser.id,
        targetUser.name,
        'AI Copilot Delegation',
        `AI Task assigned by ${creatorUser.name}. Follow up required on execution.`,
        'Follow up with assignee on progress and execution.',
        new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        'Pending Follow-up',
        0,
        `${creatorUser.name} (via AI)`,
        nowIso
      ]).catch(e => console.warn('EA Followup insert warning:', e.message));

      // Notify all EA users
      for (const ea of eaUsers) {
        const eaNotifId = `notif-ea-${Date.now()}-${ea.id}`;
        const eaNotif = {
          id: eaNotifId,
          title: '⚡ EA Follow-Up Scheduled',
          message: `Task "${cleanTitle}" (${taskId}) assigned to ${targetUser.name} requires your follow-up.`,
          type: 'approval',
          taskId: taskId,
          timestamp: nowIso
        };

        await query(
          'INSERT INTO notifications (id, title, message, type, task_id, user_id, is_read) VALUES (?, ?, ?, ?, ?, ?, 0)',
          [eaNotif.id, eaNotif.title, eaNotif.message, eaNotif.type, eaNotif.taskId, ea.id]
        ).catch(() => {});

        broadcastNotification(eaNotif, ea.id);
      }
    }

    const delegatedTask = {
      id: taskId,
      title: cleanTitle,
      description: rawMsg,
      assignee: {
        id: targetUser.id,
        name: targetUser.name,
        role: targetUser.role,
        department: targetUser.department,
        avatar: targetUser.avatar
      },
      creator: {
        id: creatorUser.id,
        name: creatorUser.name,
        role: creatorUser.role
      },
      hasEaFollowup: isEa,
      eaFollowupId,
      eaAssignedName: eaAssignedUser?.name || 'Executive Assistant (EA)',
      status: 'Assigned',
      priority: 'High',
      dueDate,
      notificationDispatched: true
    };

    const replyText = `🎯 **Task Delegated & Transmitted Successfully**\n\n` +
      `• **Task ID:** \`${taskId}\`\n` +
      `• **Task:** ${cleanTitle}\n` +
      `• **Assigned Officer:** **${targetUser.name}** (${targetUser.role} • ${targetUser.department || 'Operations'})\n` +
      `• **Priority & SLA:** High Priority • Target Timeline 48h\n` +
      `${isEa ? `• **Executive Surveillance:** **EA Follow-Up Active** (Supervised by **${eaAssignedUser?.name || 'EA'}**)\n` : `• **Governance:** Standard Workspace Execution\n`}` +
      `• **Live Status:** 🟢 Dispatched directly to **${targetUser.name}**'s system with instant audio alert.`;

    return {
      handled: true,
      answer: replyText,
      delegatedTask
    };
  } catch (err) {
    console.error('Error in processAiTaskDelegation:', err);
    return null;
  }
}

export const delegateAiTask = async (req, res) => {
  try {
    const { message, taggedUserId, requireEaFollowup = false, userId = 'usr-1', channelId = 'chan-ai' } = req.body;
    const result = await processAiTaskDelegation({ message, taggedUserId, requireEaFollowup, userId, channelId });
    if (result && result.handled) {
      return res.status(201).json({ success: true, ...result });
    }
    return res.status(400).json({ success: false, error: 'Could not resolve tagged user or task details' });
  } catch (err) {
    console.error('Error in delegateAiTask controller:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const askAiAssistant = async (req, res) => {
  try {
    const {
      message,
      imageUrl,
      image,
      dataUrl,
      sessionId = 'default-session',
      userId = 'usr-1',
      channelId = 'chan-ai',
      taggedUserId = null,
      requireEaFollowup = false
    } = req.body;
    let finalImageUrl = imageUrl || image || dataUrl || null;

    const rawMsg = (message || '').trim();
    const isGreeting = /^(hlo|hello|helo|hi|hey|hlw|namaste|namaskar|ram\s*ram|radhe\s*radhe|sat\s*sri\s*akal|sasriakal|adaab|salam|good\s*(morning|afternoon|evening)|kaise\s*ho|sup)(\s*(ji|sir|bhai|mam|madam))?$/i.test(rawMsg);

    // Fallback: ONLY look up previous image if the user EXPLICITLY refers to inspecting an image/photo/slip
    // and the message is NOT a greeting or standard inquiry!
    const explicitlyAsksAboutPreviousImage = !isGreeting && /\b(this\s*(?:image|photo|pic|picture|slip)|is\s*(?:image|photo|pic|tasveer|slip)|yeh\s*(?:photo|pic|image|slip)|ye\s*(?:photo|pic|image)|identify\s*(?:this|the\s*image|the\s*photo)|check\s*(?:this\s*)?(?:image|photo|pic|slip))\b/i.test(rawMsg);

    if (!finalImageUrl && explicitlyAsksAboutPreviousImage && isConnected()) {
      try {
        const recentImg = await query(
          'SELECT image_url, created_at FROM chat_messages WHERE channel_id = ? AND is_ai = 0 AND image_url IS NOT NULL ORDER BY created_at DESC LIMIT 1',
          [channelId]
        );
        if (recentImg && recentImg.length > 0 && recentImg[0].image_url) {
          const imgAgeMs = Date.now() - new Date(recentImg[0].created_at).getTime();
          // Only use if sent within the last 3 minutes
          if (imgAgeMs < 180000) {
            finalImageUrl = recentImg[0].image_url;
          }
        }
      } catch (e) {
        console.warn('Recent image lookup warning:', e.message);
      }
    }

    const userPrompt = (message || '').trim() || (finalImageUrl ? 'Please inspect this image and extract the Lot Number and production details.' : '');
    if (!userPrompt && !finalImageUrl) {
      return res.status(400).json({ success: false, error: 'Message or image is required' });
    }

    let aiReplyText = '';
    let isN8nConnected = false;
    let pdfAttachment = null;
    let imageAttachment = null;
    let imageGallery = null;
    let trackingData = null;
    let delegatedTask = null;

    // Check for Task Delegation to tagged user
    const delegationResult = await processAiTaskDelegation({
      message: userPrompt,
      taggedUserId,
      requireEaFollowup,
      userId,
      channelId
    });

    if (delegationResult && delegationResult.handled) {
      aiReplyText = delegationResult.answer;
      delegatedTask = delegationResult.delegatedTask;
      isN8nConnected = true;
    } else {
      // 1. Fetch recent messages in channel to provide context and history
      let recentMessages = [];
      let conversationHistory = [];
      if (isConnected()) {
        recentMessages = await query(
          'SELECT sender_name, is_ai, text FROM chat_messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT 8',
          [channelId]
        ).catch(() => []);
        conversationHistory = [...recentMessages].reverse().map(m => ({
          role: m.is_ai ? 'assistant' : 'user',
          content: m.text
        }));
      }

      // 2. Run query through our Universal AI Query Engine
      // Handles ALL types of questions: OCR Lot extraction, Specific lots, Parties/Buyers, Categories, Fabrics, Vendors, Overview, Database Tasks & KPIs
      const engineResult = await processUniversalQuery(userPrompt, { channelId, userId, recentMessages, conversationHistory, imageUrl: finalImageUrl }).catch(e => {
        console.warn('Universal Query Engine notice:', e.message);
        return { handled: false };
      });

      if (engineResult && engineResult.handled) {
        aiReplyText = engineResult.answer;
        if (engineResult.pdfAttachment) {
          pdfAttachment = engineResult.pdfAttachment;
        }
        if (engineResult.imageAttachment) {
          imageAttachment = engineResult.imageAttachment;
        }
        if (engineResult.imageGallery) {
          imageGallery = engineResult.imageGallery;
        }
        if (engineResult.trackingData) {
          trackingData = engineResult.trackingData;
        }
        isN8nConnected = true;
      } else {
        const targetUrl = config.n8nChatWebhookUrl || 'http://localhost:5678/webhook/factory-ai-agents';
        const fallbackUrl = config.n8nTestWebhookUrl || 'http://localhost:5678/webhook/factory-ai-agents';

        const callN8n = async (url) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 35000);

          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'sendMessage',
                sessionId: sessionId || `user-${userId}`,
                chatInput: userPrompt,
                message: userPrompt,
                prompt: userPrompt,
                query: userPrompt,
                imageUrl: finalImageUrl,
                image: finalImageUrl,
                history: conversationHistory
              }),
              signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
              const data = await response.json().catch(() => null);
              if (data) {
                if (data.answer) return { text: data.answer, connected: true };
                if (data.output) return { text: data.output, connected: true };
                if (data.text) return { text: data.text, connected: true };
                if (data.message) return { text: data.message, connected: true };
                if (data.response) return { text: data.response, connected: true };
                if (Array.isArray(data) && data.length > 0) {
                  const first = data[0];
                  const t = first.answer || first.output || first.text || first.message || first.response || (typeof first === 'string' ? first : '');
                  if (t) return { text: t, connected: true };
                }
                if (typeof data === 'string') return { text: data, connected: true };
              }
            }
          } catch (err) {
            clearTimeout(timeoutId);
            console.warn(`n8n webhook call to ${url} notice:`, err.message);
          }
          return null;
        };

        const n8nResult = (await callN8n(targetUrl)) || (await callN8n(fallbackUrl));
        if (n8nResult && n8nResult.text) {
          aiReplyText = n8nResult.text;
          isN8nConnected = true;
        }

        // Anti-hallucination guard for specific lots in factory database
        if (aiReplyText) {
          const lotMatch = message.match(/(?:LOT[-_\s]*)?(\d{4,7})\b/i);
          if (lotMatch) {
            const lNum = lotMatch[1];
            const lotData = loadFactorySheetsData()?.lotsMap?.get(lNum);
            if (lotData && /(?:active nahi hai|data available nahi hai|record nahi mila|not found in(?: the)? active|not available in live production|kya aap confirm kar sakte hain|purana\/closed lot hai)/i.test(aiReplyText)) {
              const rerun = await processUniversalQuery(`${lNum} lot complete history`).catch(() => null);
              if (rerun && rerun.handled) {
                aiReplyText = rerun.answer;
                if (rerun.trackingData) trackingData = rerun.trackingData;
                if (rerun.imageAttachment) imageAttachment = rerun.imageAttachment;
                if (rerun.pdfAttachment) pdfAttachment = rerun.pdfAttachment;
              }
            }
          }
        }

        if (!aiReplyText) {
          aiReplyText = `🤖 *PulseBot*: Received "${message}". Factory Suite Pro AI Engine is active and ready to assist you.`;
        }

      // Attach PDF ONLY when user gave explicit command to create, generate, or download PDF
      const userAskedForPdf = /\b(pdf|generate\s*pdf|create\s*pdf|download\s*pdf|make\s*pdf|print\s*pdf|export\s*pdf|pdf\s*bana|bana\s*do\s*pdf|krdo\s*generate\s*pdf|pdf.*chahiye|chahiye.*pdf|pdf\s*do|show\s*pdf|slip\s*download|download\s*slip|slip\s*chahiye)\b/i.test(message);

      if (userAskedForPdf && !pdfAttachment) {
        if (/\b(331|ss\s*lots|lots\s*of\s*ss|ss\s*party)\b/i.test(message) || /\b(ss\s*party|buyer:|total\s*\d+\s*lots)\b/i.test(aiReplyText)) {
          let pName = 'SS';
          if (/zara/i.test(message + ' ' + aiReplyText)) pName = 'Zara';
          else if (/h&m|hm/i.test(message + ' ' + aiReplyText)) pName = 'H&M';
          else if (/mohit/i.test(message + ' ' + aiReplyText)) pName = 'Mohit Hosiery';
          const pSlug = pName.replace(/[^a-zA-Z0-9_-]/g, '_');
          const isPending = /uncut|pending/i.test(message);
          pdfAttachment = {
            type: 'party',
            partyName: isPending ? `${pName} (Uncut Lots)` : pName,
            downloadUrl: `http://localhost:5000/api/chat/pdf/party/${encodeURIComponent(pSlug)}${isPending ? '?status=pending' : ''}`,
            filename: `${pSlug}_${isPending ? 'Uncut_' : ''}Lots_Report.pdf`,
            title: `${pName} - ${isPending ? 'Uncut' : 'Complete'} Lots Report`
          };
        } else {
          const mentionedLot = message.match(/(?:LOT[-_\s]*)?(\d{4,7})\b/i) || aiReplyText.match(/(?:LOT[-_\s]*)?(\d{4,7})\b/i);
          if (mentionedLot) {
            const lNum = mentionedLot[1];
            const lotInfo = loadFactorySheetsData()?.lotsMap?.get(lNum);
            const jNum = lotInfo?.jo || 'JO-1';
            pdfAttachment = {
              lotNumber: lNum,
              jobOrderNo: jNum,
              downloadUrl: `http://localhost:5000/api/chat/pdf/${lNum}`,
              filename: `JobOrder_${jNum}_Lot_${lNum}.pdf`,
              title: `Job Order & Production Slip (${jNum} • Lot ${lNum})`
            };
          }
        }
      }
    }
  }

    const messageId = `msg-ai-${Date.now()}`;
    const timestamp = new Date().toISOString();

    if (isConnected()) {
      const attachmentPayload = {
        ...(pdfAttachment ? { pdfAttachment } : {}),
        ...(imageAttachment ? { imageAttachment } : {}),
        ...(imageGallery ? { imageGallery } : {}),
        ...(trackingData ? { trackingData } : {}),
        ...(delegatedTask ? { delegatedTask } : {})
      };

      await query(
        `INSERT INTO chat_messages (id, channel_id, sender_id, sender_name, sender_role, sender_avatar, message_type, text, is_ai, file_attachment)
         VALUES (?, ?, ?, ?, ?, ?, 'text', ?, ?, ?)`,
        [
          messageId,
          channelId,
          'pulse-bot',
          'PulseBot AI (Gemini)',
          'AI Assistant',
          '🤖',
          aiReplyText,
          1,
          Object.keys(attachmentPayload).length > 0 ? JSON.stringify(attachmentPayload) : null
        ]
      ).catch(e => console.warn('Could not store AI message to DB:', e.message));

      await query(
        'UPDATE chat_channels SET last_message_id = ?, last_message_at = CURRENT_TIMESTAMP WHERE id = ?',
        [messageId, channelId]
      ).catch(() => {});

      logService.info('AI', 'AI_REPLY_GENERATED', {
        userId,
        entityType: 'chat_message',
        entityId: messageId,
        details: { channelId, isN8nConnected, hasPdf: Boolean(pdfAttachment), hasImage: Boolean(imageAttachment), hasGallery: Boolean(imageGallery), hasTracking: Boolean(trackingData), hasDelegatedTask: Boolean(delegatedTask) }
      }).catch(() => {});
    }

    const aiMessage = {
      id: messageId,
      channelId,
      senderId: 'pulse-bot',
      senderName: 'PulseBot AI (Gemini)',
      senderRole: 'AI Assistant',
      senderAvatar: '🤖',
      messageType: 'text',
      text: aiReplyText,
      isAi: true,
      timestamp,
      isN8nConnected,
      pdfAttachment,
      imageAttachment,
      imageGallery,
      trackingData,
      delegatedTask
    };

    // Broadcast AI message in real time to the channel
    broadcastChatMessage(channelId, aiMessage);

    return res.json({
      success: true,
      message: aiMessage
    });
  } catch (error) {
    console.error('Error in askAiAssistant controller:', error);
    res.status(500).json({ success: false, error: 'AI Assistant service encountered an error' });
  }
};

export const generateLotPdf = async (req, res) => {
  try {
    const lotNumber = String(req.params.lotNumber || '11028').trim();
    const sheets = loadFactorySheetsData();
    let lotData = null;

    if (sheets && sheets.lotsMap && sheets.lotsMap.has(lotNumber)) {
      const rec = sheets.lotsMap.get(lotNumber);
      lotData = {
        lotNumber: rec.lot,
        jobOrderNo: rec.jo || 'JO-1',
        partyName: rec.party || 'Mohit Hosiery',
        brand: rec.brand || 'Standard',
        garmentType: rec.garment || 'GARMENT',
        style: rec.style || 'Standard',
        pattern: rec.pattern || 'SS Pattern',
        fabricCode: rec.fabric || 'Standard',
        quantity: `${rec.qty} ${rec.unit || 'PCS'}`,
        sizes: rec.sizes || 'Standard',
        shades: rec.shades || 'Standard',
        embVendor: rec.embVendor || 'NA',
        embPlacement: rec.embDetails || 'FRONT',
        directStitching: rec.directStitching ? 'YES' : 'NO',
        challanNo: rec.challanNo || 'N/A',
        challanDate: rec.date || 'N/A',
        challanQty: rec.challanQty || rec.qty,
        completeLot: false,
        challanBreakdown: '',
        fullBaju: 'YES',
        tapeLace: '',
        bottomType: '',
        submittedBy: rec.submittedBy || 'Ravinder',
        fabricSupervisor: 'YES',
        isCut: rec.isCut,
        isCancelled: Boolean(rec.isCancelled),
        cancelInfo: rec.cancelInfo,
        cutPcs: rec.cutPcs,
        cutDate: rec.cutDate
      };
    } else {
      const isJo2 = lotNumber === '11029';
      lotData = {
        lotNumber: lotNumber,
        jobOrderNo: req.query.jo || (isJo2 ? 'JO-2' : 'JO-1'),
        partyName: req.query.party || 'Mohit Hosiery',
        brand: req.query.brand || (isJo2 ? 'AMIRI' : 'Hoodbyrich'),
        garmentType: req.query.garment || 'SWEATSHIRT',
        style: req.query.style || (isJo2 ? 'FULL ZIPPER (MONKEY HOOD)' : 'Cross Hoodie'),
        pattern: req.query.pattern || 'SS Pattern',
        fabricCode: req.query.fabric || '3553',
        quantity: req.query.qty || (isJo2 ? '20 SETS' : '30 SETS'),
        sizes: req.query.sizes || 'M, L, L, XL, XXL',
        shades: req.query.shades || (isJo2 ? 'BLACK, OFFWHITE, OLIVE' : 'Black, Off-White, Olive'),
        embVendor: req.query.emb || (isJo2 ? 'BHM' : 'GOURAV'),
        embPlacement: req.query.placement || (isJo2 ? 'FRONT' : 'FRONT, Cap'),
        directStitching: 'No',
        challanNo: req.query.challan || (isJo2 ? 'CH-EMB-0088' : 'CH-EMB-0052'),
        challanDate: req.query.challanDate || '13 Oct 2025',
        challanQty: req.query.challanQty || (isJo2 ? '300' : '415'),
        completeLot: false,
        challanBreakdown: req.query.breakdown || (isJo2 ? 'BLACK: 100 pcs | OFFWHITE: 100 pcs | OLIVE: 100 pcs' : 'BLACK: 140 pcs | OFF-WHITE: 135 pcs | OLIVE: 140 pcs'),
        fullBaju: 'YES',
        tapeLace: isJo2 ? 'yes' : 'abc',
        bottomType: isJo2 ? 'blue' : 'abc',
        submittedBy: isJo2 ? 'RAVINDER' : 'Ravinder',
        fabricSupervisor: 'YES',
        isCut: isJo2,
        cutPcs: isJo2 ? 300 : null,
        cutDate: isJo2 ? '17 Dec 2025' : null
      };
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="JobOrder_${lotData.jobOrderNo}_Lot_${lotNumber}.pdf"`);

    generateJobOrderPdf(lotData, res);
  } catch (err) {
    console.error('Error generating Lot PDF:', err);
    res.status(500).json({ success: false, error: 'Failed to generate PDF' });
  }
};

export const generatePartyPdf = async (req, res) => {
  try {
    const rawParty = req.params.partyName || 'SS Party';
    const decodedParty = decodeURIComponent(rawParty).replace(/_/g, ' ').trim();
    const isSS = /\bss\b/i.test(decodedParty);
    const isZara = /zara/i.test(decodedParty);
    const isHM = /h&m|hm/i.test(decodedParty);

    const sheetsData = getSheetsData();
    let reportData = null;

    if (sheetsData && Array.isArray(sheetsData.jobOrders)) {
      const getLotNum = (r) => String(r["Lot Number"] || r["LOT NUMBER"] || r["Lot No"] || r["LOT NO"] || r["lotNo"] || r["Lot"] || "").trim();
      const cutLotsSet = new Set((sheetsData.indexRows || sheetsData.issues || []).map(r => getLotNum(r)).filter(Boolean));
      const cancelledLotsSet = new Set((sheetsData.cancelledLots || []).map(r => getLotNum(r)).filter(Boolean));

      let matchedOrders = [];
      if (isSS) {
        matchedOrders = sheetsData.jobOrders.filter(r => String(r['Party Name'] || '').trim().toUpperCase() === 'SS');
        if (matchedOrders.length === 0) {
          matchedOrders = sheetsData.jobOrders.filter(r => String(r['Pattern'] || '').toUpperCase().includes('SS'));
        }
      } else {
        matchedOrders = sheetsData.jobOrders.filter(r => {
          const p = String(r['Party Name'] || r['Party'] || '').toLowerCase();
          const pat = String(r['Pattern'] || '').toLowerCase();
          return p.includes(decodedParty.toLowerCase()) || pat.includes(decodedParty.toLowerCase());
        });
      }

      if (matchedOrders.length > 0) {
        let cutCount = 0;
        let pendingCount = 0;
        let cancelCount = 0;
        const allRows = matchedOrders.map(r => {
          const lot = getLotNum(r) || r['Job Order No'] || 'N/A';
          const statusStr = String(r['Status'] || '').toLowerCase();
          const isCancelled = cancelledLotsSet.has(lot) || statusStr.includes('cancel') || Boolean(r['Cancellation Reason']) || Boolean(r['Cancellation Timestamp']);
          const isCut = !isCancelled && cutLotsSet.has(lot);
          if (isCancelled) cancelCount++;
          else if (isCut) cutCount++;
          else pendingCount++;
          return {
            lot,
            jo: r['Job Order No'] || 'N/A',
            style: `${r['Garment Type'] || ''} ${r['Style'] || ''}`.trim() || 'Garment',
            fabric: r['Fabric'] || 'Standard',
            qty: String(r['Quantity'] || r['Challan Total Qty'] || '0'),
            isCut,
            isCancelled,
            cancelInfo: isCancelled ? { reason: r['Cancellation Reason'] || 'Cancelled', by: r['Cancelled By'] || 'EA' } : null,
            emb: r['Emb'] || r['Emb Details'] || 'NA'
          };
        });

        const filter = String(req.query.status || req.query.filter || '').toLowerCase();
        const isPendingOnly = filter === 'pending' || filter === 'uncut' || /uncut|pending/i.test(decodedParty);
        const isCutOnly = filter === 'cut' || filter === 'complete';
        const isCancelledOnly = filter === 'cancel' || filter === 'cancelled';

        let displayRows = allRows;
        if (isPendingOnly) {
          displayRows = allRows.filter(r => !r.isCut && !r.isCancelled);
        } else if (isCutOnly) {
          displayRows = allRows.filter(r => r.isCut && !r.isCancelled);
        } else if (isCancelledOnly) {
          displayRows = allRows.filter(r => r.isCancelled);
        }

        reportData = {
          partyName: isSS ? 'SS' : decodedParty,
          totalLots: displayRows.length,
          allTotalLots: allRows.length,
          cutCount,
          pendingCount,
          cancelCount,
          filter: isPendingOnly ? 'pending' : (isCutOnly ? 'cut' : (isCancelledOnly ? 'cancelled' : 'all')),
          rows: displayRows
        };
      }
    }

    if (!reportData) {
      reportData = {
        partyName: decodedParty,
        totalLots: 2,
        cutCount: 1,
        pendingCount: 1,
        filter: 'all',
        rows: [
          { lot: '11027', jo: 'JO-0', style: 'T-Shirt (Classic)', fabric: 'Single Jersey', qty: '300 Pcs', isCut: true, emb: 'DIRECT' },
          { lot: '11028', jo: 'JO-1', style: 'Sweatshirt (Cross Hoodie)', fabric: '3553', qty: '30 SETS', isCut: false, emb: 'GOURAV' }
        ]
      };
    }

    const filter = String(req.query.status || req.query.filter || '').toLowerCase();
    const isPendingOnly = filter === 'pending' || filter === 'uncut' || /uncut|pending/i.test(decodedParty);
    const isCutOnly = filter === 'cut' || filter === 'complete';

    const cleanName = (isSS ? 'SS' : decodedParty).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = isPendingOnly
      ? `${cleanName}_Uncut_Lots_Report.pdf`
      : (isCutOnly ? `${cleanName}_Cut_Lots_Report.pdf` : `${cleanName}_Lots_Report.pdf`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    generatePartyReportPdf(reportData, res);
  } catch (err) {
    console.error('Error generating Party PDF:', err);
    res.status(500).json({ success: false, error: 'Failed to generate party report PDF' });
  }
};


export const getAiStatus = async (req, res) => {
try {
let n8nReachable = false;
try {
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 2000);
const pingRes = await fetch('http://localhost:5678/healthz', { signal: controller.signal }).catch(() => null);
clearTimeout(timeoutId);
if (pingRes && pingRes.ok) n8nReachable = true;
} catch (e) {}
res.json({
success: true,
provider: 'n8n AI Agent (Google Gemini Chat Model)',
workflow: 'My workflow 4',
workflowId: 'DzBNwKVTSUvLQTee',
webhookUrl: config.n8nChatWebhookUrl,
n8nReachable
});
} catch (error) {
res.status(500).json({ success: false, error: 'Could not fetch AI status' });
}
};
export const createGroupChannel = async (req, res) => {
try {
  const { name, description = '', memberIds = [], creatorId, creatorName, avatar = null } = req.body;
if (!name || !name.trim()) {
return res.status(400).json({ success: false, error: 'Group name is required' });
}
if (!creatorId) {
return res.status(400).json({ success: false, error: 'Creator ID is required' });
}
// Ensure creator is in memberIds and remove duplicates
const allMemberIds = Array.from(new Set([creatorId, ...(Array.isArray(memberIds) ? memberIds : [])])).filter(Boolean);
if (allMemberIds.length < 2) {
return res.status(400).json({ success: false, error: 'Please select at least 1 other team member for the group' });
}
const channelId = `group-${Date.now()}`;
const timestamp = new Date().toISOString();
if (isConnected()) {
// 1. Create channel in chat_channels
await query(
`INSERT INTO chat_channels (id, name, type, description, created_by, participant_ids, is_private, avatar)
VALUES (?, ?, 'group', ?, ?, ?, 1, ?)`,
[channelId, name.trim(), description.trim(), creatorId, JSON.stringify(allMemberIds), avatar || null]
);
// 2. Insert member records into chat_channel_members for every person
for (const uid of allMemberIds) {
const role = uid === creatorId ? 'admin' : 'member';
const memberKey = `mem-${channelId}-${uid}`;
await query(
`INSERT INTO chat_channel_members (id, channel_id, user_id, role, unread_count)
VALUES (?, ?, ?, ?, 0)
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
[memberKey, channelId, uid, role]
);
}
// 3. System message indicating group creation
const sysMsgId = `msg-sys-${Date.now()}`;
const sysText = `🎉 ${creatorName || 'A team member'} created group "${name.trim()}" with ${allMemberIds.length} members.`;
await query(
`INSERT INTO chat_messages (id, channel_id, sender_id, sender_name, sender_role, sender_avatar, message_type, text, is_ai, status)
VALUES (?, ?, 'system', 'TaskPulse System', 'System', '📢', 'system', ?, 0, 'delivered')`,
[sysMsgId, channelId, sysText]
).catch(() => {});
await query(
'UPDATE chat_channels SET last_message_id = ?, last_message_at = CURRENT_TIMESTAMP WHERE id = ?',
[sysMsgId, channelId]
).catch(() => {});
// 4. Audit Log
logService.info('CHAT', 'GROUP_CREATED', {
userId: creatorId,
userName: creatorName,
entityType: 'chat_channel',
entityId: channelId,
details: { name: name.trim(), membersCount: allMemberIds.length }
}).catch(() => {});
const newChannel = {
id: channelId,
name: name.trim(),
type: 'group',
avatar: avatar || null,
description: description.trim(),
createdBy: creatorId,
participantIds: allMemberIds,
isPrivate: true,
unreadCount: 0,
roleBadge: `Group • ${allMemberIds.length} members`,
createdAt: timestamp,
lastMessageAt: timestamp
};
const systemMessage = {
id: sysMsgId,
channelId,
senderId: 'system',
senderName: 'TaskPulse System',
senderRole: 'System',
senderAvatar: '📢',
messageType: 'system',
text: sysText,
isAi: false,
status: 'delivered',
timestamp
};
// 5. Broadcast to all online users
broadcastChannelCreated(newChannel);
broadcastChatMessage(channelId, systemMessage);
return res.status(201).json({
success: true,
channel: newChannel,
message: systemMessage
});
}
res.json({ success: true, channel: { id: channelId, name: name.trim(), type: 'group', participantIds: allMemberIds } });
} catch (error) {
console.error('Error in createGroupChannel controller:', error);
res.status(500).json({ success: false, error: 'Group creation failed' });
}
};

/**
 * Image Proxy Controller
 * Streams Google Drive images and remote artwork images with proper caching and Content-Type
 */
export const proxyImage = async (req, res) => {
  try {
    const rawUrl = req.query.url;
    const directId = req.query.id;
    if (!rawUrl && !directId) return res.status(400).send('Image URL or ID is required');

    const driveMatch = rawUrl ? (rawUrl.match(/id=([a-zA-Z0-9_-]+)/) || rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)) : null;
    const driveId = directId || (driveMatch ? driveMatch[1] : null);

    let targetUrl = driveId ? 'https://lh3.googleusercontent.com/d/' + driveId : rawUrl;
    let response = await fetch(targetUrl).catch(() => null);

    if (!response || !response.ok) {
      if (driveId) {
        const fbUrl = 'https://drive.google.com/uc?export=view&id=' + driveId;
        response = await fetch(fbUrl).catch(() => null);
      }
    }

    if (!response || !response.ok) {
      return res.status(response ? response.status : 404).send('Image could not be retrieved');
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('Error in proxyImage controller:', err.message);
    res.status(500).send('Error proxying image');
  }
};

/**
 * High-Speed AI Context Controller for n8n Workflow
 * Returns fully aggregated multi-sheet ERP context from local cache in < 5ms
 */
export const getAiContextForN8n = async (req, res) => {
  try {
    const payload = req.method === 'POST' ? req.body : req.query;
    const body = payload?.body || payload || {};
    const prompt = body?.prompt || body?.chatInput || body?.message || body?.query || '';
    const history = body?.history || [];
    const context = body?.context || {};

    const result = await buildAiAggregatedContext({
      prompt,
      chatInput: body?.chatInput,
      message: body?.message,
      query: body?.query,
      history,
      context
    });

    return res.json(result);
  } catch (error) {
    console.error('Error in getAiContextForN8n controller:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

