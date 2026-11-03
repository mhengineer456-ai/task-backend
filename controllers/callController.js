import { query, isConnected } from '../config/db.js';
import { broadcastChatMessage, broadcastTaskCreated, broadcastNotification } from '../socket.js';
import { generateAiResponseWithGemini } from '../services/aiQueryEngine.js';

// In-memory fallback for call history
let fallbackCallLogs = [
  {
    id: 'call-sample-1',
    caller_id: 'usr-2',
    caller_name: 'Sarah Jenkins',
    caller_avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    receiver_id: 'usr-1',
    receiver_name: 'Alex Johnson',
    receiver_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    call_type: 'video',
    status: 'completed',
    duration_seconds: 342, // 5 min 42 sec
    channel_id: 'dm-usr-1-usr-2',
    created_at: new Date(Date.now() - 3600000 * 3).toISOString()
  },
  {
    id: 'call-sample-2',
    caller_id: 'usr-3',
    caller_name: 'David Chen',
    caller_avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    receiver_id: 'usr-1',
    receiver_name: 'Alex Johnson',
    receiver_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    call_type: 'voice',
    status: 'missed',
    duration_seconds: 0,
    channel_id: 'dm-usr-1-usr-3',
    created_at: new Date(Date.now() - 3600000 * 6).toISOString()
  }
];

// Helper to format seconds into mm:ss or hh:mm:ss
const formatDuration = (sec) => {
  if (!sec || sec <= 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${String(h).padStart(2, '0')}:${String(remM).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/**
 * GET /api/calls/history
 * Retrieve call logs for the authenticated user
 */
export const getCallHistory = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required.' });
    }

    if (isConnected()) {
      const rows = await query(`
        SELECT
          id, caller_id, caller_name, caller_avatar,
          receiver_id, receiver_name, receiver_avatar,
          call_type, status, duration_seconds, channel_id,
          notes, summary, action_items, created_at
        FROM call_logs
        WHERE caller_id = ? OR receiver_id = ?
        ORDER BY created_at DESC
        LIMIT 100
      `, [userId, userId]);

      const formatted = (rows || []).map(r => {
        let parsedActions = [];
        try {
          parsedActions = typeof r.action_items === 'string' ? JSON.parse(r.action_items) : (r.action_items || []);
        } catch (e) {}
        return {
          ...r,
          action_items: parsedActions
        };
      });

      return res.json({
        success: true,
        calls: formatted
      });
    }

    // Fallback mode
    const filtered = fallbackCallLogs
      .filter(c => String(c.caller_id) === String(userId) || String(c.receiver_id) === String(userId))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.json({
      success: true,
      calls: filtered
    });
  } catch (error) {
    console.error('Error fetching call history:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve call history' });
  }
};

/**
 * POST /api/calls/log
 * Record a completed, missed, or rejected call.
 * Optionally injects call summary into the relevant chat channel.
 */
export const logCall = async (req, res) => {
  try {
    const {
      id,
      callerId,
      callerName,
      callerAvatar,
      receiverId,
      receiverName,
      receiverAvatar,
      callType = 'voice',
      status = 'completed',
      durationSeconds = 0,
      channelId = null,
      postToChat = true
    } = req.body;

    if (!callerId || !receiverId) {
      return res.status(400).json({ success: false, error: 'callerId and receiverId are required.' });
    }

    const callId = id || `call-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const callRecord = {
      id: callId,
      caller_id: callerId,
      caller_name: callerName || 'Caller',
      caller_avatar: callerAvatar || '',
      receiver_id: receiverId,
      receiver_name: receiverName || 'Receiver',
      receiver_avatar: receiverAvatar || '',
      call_type: callType,
      status: status,
      duration_seconds: Number(durationSeconds) || 0,
      channel_id: channelId || null,
      created_at: nowIso
    };

    if (isConnected()) {
      await query(`
        INSERT INTO call_logs (
          id, caller_id, caller_name, caller_avatar,
          receiver_id, receiver_name, receiver_avatar,
          call_type, status, duration_seconds, channel_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        callRecord.id,
        callRecord.caller_id,
        callRecord.caller_name,
        callRecord.caller_avatar,
        callRecord.receiver_id,
        callRecord.receiver_name,
        callRecord.receiver_avatar,
        callRecord.call_type,
        callRecord.status,
        callRecord.duration_seconds,
        callRecord.channel_id,
        callRecord.created_at
      ]);
    } else {
      fallbackCallLogs.unshift(callRecord);
    }

    // Optionally post a WhatsApp-style call activity message to the chat
    if (postToChat && channelId) {
      try {
        let callText = '';
        const isVoice = callType === 'voice';
        const typeIcon = isVoice ? '📞' : '📹';
        const typeLabel = isVoice ? 'Voice call' : 'Video call';

        if (status === 'completed') {
          const durStr = formatDuration(durationSeconds);
          callText = `${typeIcon} ${typeLabel} · ${durStr}`;
        } else if (status === 'missed') {
          callText = `${typeIcon} Missed ${typeLabel.toLowerCase()}`;
        } else if (status === 'rejected') {
          callText = `🚫 ${typeLabel} declined`;
        } else if (status === 'busy') {
          callText = `⏳ ${typeLabel} · Line busy`;
        } else if (status === 'cancelled') {
          callText = `${typeIcon} Cancelled ${typeLabel.toLowerCase()}`;
        }

        if (callText) {
          const msgId = `callmsg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          const msgPayload = {
            id: msgId,
            channelId,
            senderId: callerId,
            senderName: callerName || 'User',
            senderRole: 'Calling',
            senderAvatar: callerAvatar || '',
            messageType: 'call_activity',
            text: callText,
            callDetails: {
              callId,
              callType,
              status,
              durationSeconds: Number(durationSeconds) || 0
            },
            status: 'sent',
            timestamp: new Date().toISOString()
          };

          if (isConnected()) {
            await query(`
              INSERT INTO chat_messages (
                id, channel_id, sender_id, sender_name, sender_role,
                sender_avatar, message_type, text, status, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
              msgId, channelId, callerId, callerName || 'User',
              'Calling', callerAvatar || '', 'call_activity', callText, 'sent'
            ]).catch(() => {});

            await query(`
              UPDATE chat_channels
              SET last_message_id = ?, last_message_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `, [msgId, channelId]).catch(() => {});
          }

          broadcastChatMessage(channelId, msgPayload);
        }
      } catch (chatErr) {
        console.warn('Could not post call activity to chat channel:', chatErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      call: callRecord
    });
  } catch (error) {
    console.error('Error logging call:', error);
    return res.status(500).json({ success: false, error: 'Failed to record call log' });
  }
};

/**
 * GET /api/calls/ice-servers
 * Return reliable STUN and TURN server credentials for WebRTC peer connection
 */
export const getIceServers = async (req, res) => {
  try {
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ];

    // Optional environment-configured TURN server (for enterprise / symmetric NAT traversal)
    if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      iceServers.push({
        urls: process.env.TURN_URL,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
      });
    }

    return res.json({
      success: true,
      iceServers
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
      ]
    });
  }
};

/**
 * DELETE /api/calls/history/:id
 * Clear a specific call record
 */
export const deleteCallLog = async (req, res) => {
  try {
    const { id } = req.params;
    if (isConnected()) {
      await query('DELETE FROM call_logs WHERE id = ?', [id]);
    } else {
      fallbackCallLogs = fallbackCallLogs.filter(c => c.id !== id);
    }
    return res.json({ success: true, message: 'Call log removed' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to delete call log' });
  }
};

/**
 * POST /api/calls/:callId/ai-summary
 * Analyze meeting notes and call context with Gemini to generate executive summary and action items
 */
export const generateCallAiSummary = async (req, res) => {
  try {
    const { callId } = req.params;
    const {
      notes = '',
      topic = '',
      callerName = 'Participant 1',
      receiverName = 'Participant 2',
      durationSeconds = 0,
      channelId = null
    } = req.body;

    const formattedDuration = formatDuration(durationSeconds);

    const systemInstruction = `You are "PulseBot", an AI executive meeting assistant and productivity copilot for TaskPulse.
Your task is to analyze meeting/call notes, conversation context, and participant details.
You must return ONLY a valid, parseable JSON object without markdown fences, matching this schema:
{
  "summary": "Concise executive overview of the meeting, key discussion points, and agreements reached.",
  "key_decisions": ["Decision 1", "Decision 2"],
  "action_items": [
    {
      "id": "act-1",
      "title": "Clear actionable task title (e.g., Review client proposal)",
      "description": "Short explanation of what needs to be done",
      "suggested_assignee": "Name of participant to assign to",
      "priority": "low" | "medium" | "high" | "urgent",
      "due_in_days": 2
    }
  ]
}

Guidelines:
- If notes are brief, expand them constructively into professional meeting notes and clear actionable next steps.
- Extract concrete action items with specific deliverables.
- Keep the summary executive-ready, professional, and crisp.`;

    const prompt = `Meeting Context:
Participants: ${callerName} and ${receiverName}
Call Duration: ${formattedDuration}
Meeting Topic / Agenda: ${topic || 'General Team Sync'}
Call Notes / Scratchpad:
"""
${notes || 'Team alignment call regarding ongoing projects, milestone reviews, and next action items.'}
"""

Generate the executive summary, key decisions, and prioritized action items for this meeting in the specified JSON schema.`;

    // Try Gemini with snappy 5-second timeout
    let parsedResult = null;
    try {
      const geminiPromise = generateAiResponseWithGemini({
        prompt,
        systemInstruction,
        fallbackText: ''
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI response timed out')), 5000)
      );

      const rawAiText = await Promise.race([geminiPromise, timeoutPromise]);

      if (rawAiText) {
        // Strip markdown code fences if model enclosed in ```json
        const cleanJsonStr = rawAiText.replace(/^```json/im, '').replace(/^```/im, '').replace(/```$/m, '').trim();
        parsedResult = JSON.parse(cleanJsonStr);
      }
    } catch (aiErr) {
      console.warn('Gemini summary notice:', aiErr.message);
    }

    // Fallback if AI was unavailable or returned non-JSON
    if (!parsedResult || !parsedResult.summary) {
      const cleanNotes = notes.trim();
      const lines = cleanNotes ? cleanNotes.split('\n').filter(l => l.trim().length > 0) : [];
      const extractedActionItems = [];

      lines.forEach((line, idx) => {
        const cleanLine = line.replace(/^[-*•\d.]+\s*/, '').trim();
        if (/todo|action|need to|will|assign|followup|prepare|send|review|fix|check/i.test(cleanLine) || lines.length <= 4) {
          extractedActionItems.push({
            id: `act-${idx + 1}`,
            title: cleanLine,
            description: `Generated from call discussion between ${callerName} and ${receiverName}`,
            suggested_assignee: idx % 2 === 0 ? receiverName : callerName,
            priority: 'medium',
            due_in_days: 2
          });
        }
      });

      if (extractedActionItems.length === 0) {
        extractedActionItems.push({
          id: 'act-1',
          title: `Follow up on action items from call with ${receiverName}`,
          description: `Call duration: ${formattedDuration}. Review deliverables and milestones discussed.`,
          suggested_assignee: receiverName,
          priority: 'medium',
          due_in_days: 2
        });
      }

      parsedResult = {
        summary: cleanNotes
          ? `Productive sync between ${callerName} and ${receiverName} (${formattedDuration}). Notes recorded: ${cleanNotes}`
          : `Sync call between ${callerName} and ${receiverName} lasting ${formattedDuration}. Next milestones and project deliverables reviewed.`,
        key_decisions: [
          'Team agreed on next milestone deadlines',
          'Action items assigned to respective team members'
        ],
        action_items: extractedActionItems
      };
    }

    // Save to database
    const summaryText = parsedResult.summary || 'Meeting completed.';
    const actionItemsJson = JSON.stringify(parsedResult.action_items || []);

    if (isConnected()) {
      await query(`
        UPDATE call_logs
        SET notes = ?, summary = ?, action_items = ?
        WHERE id = ?
      `, [notes, summaryText, actionItemsJson, callId]).catch(() => {});
    }

    // Also update in-memory fallback
    const fallbackCall = fallbackCallLogs.find(c => c.id === callId);
    if (fallbackCall) {
      fallbackCall.notes = notes;
      fallbackCall.summary = summaryText;
      fallbackCall.action_items = parsedResult.action_items;
    }

    return res.json({
      success: true,
      callId,
      summary: summaryText,
      keyDecisions: parsedResult.key_decisions || [],
      actionItems: parsedResult.action_items || [],
      notes
    });
  } catch (error) {
    console.error('Error generating AI call summary:', error);
    return res.status(500).json({ success: false, error: 'Failed to generate AI call summary' });
  }
};

/**
 * GET /api/calls/:callId/ai-summary
 * Retrieve existing summary and action items for a call
 */
export const getCallAiSummary = async (req, res) => {
  try {
    const { callId } = req.params;
    if (isConnected()) {
      const rows = await query(`
        SELECT id, caller_id, caller_name, receiver_id, receiver_name, duration_seconds, notes, summary, action_items, created_at
        FROM call_logs
        WHERE id = ?
      `, [callId]);

      if (rows && rows.length > 0) {
        const row = rows[0];
        let actionItems = [];
        try {
          actionItems = typeof row.action_items === 'string' ? JSON.parse(row.action_items) : (row.action_items || []);
        } catch (e) {}

        return res.json({
          success: true,
          call: {
            ...row,
            action_items: actionItems
          }
        });
      }
    }

    const fallback = fallbackCallLogs.find(c => c.id === callId);
    if (fallback) {
      return res.json({
        success: true,
        call: fallback
      });
    }

    return res.status(404).json({ success: false, error: 'Call log not found' });
  } catch (error) {
    console.error('Error fetching call summary:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve call summary' });
  }
};

/**
 * POST /api/calls/:callId/create-tasks
 * Convert selected AI meeting action items directly into real tasks in the database
 */
export const createTasksFromCallActionItems = async (req, res) => {
  try {
    const { callId } = req.params;
    const {
      actionItems = [],
      creatorId = 'usr-1',
      creatorName = 'User',
      channelId = null,
      postSummaryToChat = true
    } = req.body;

    if (!Array.isArray(actionItems) || actionItems.length === 0) {
      return res.status(400).json({ success: false, error: 'No action items provided.' });
    }

    // Fetch user directory to resolve assignees
    let allUsers = [];
    if (isConnected()) {
      allUsers = await query('SELECT id, name, email FROM users').catch(() => []);
    }

    const createdTasks = [];
    const now = new Date();

    for (let i = 0; i < actionItems.length; i++) {
      const item = actionItems[i];
      const taskId = `task-call-${Date.now()}-${i + 1}`;

      // Resolve assignee
      let targetUserId = item.assignee_id || creatorId;
      let targetUserName = item.assignee_name || item.suggested_assignee || creatorName;

      if (allUsers.length > 0 && item.suggested_assignee) {
        const matched = allUsers.find(u =>
          u.name.toLowerCase().includes(String(item.suggested_assignee).toLowerCase()) ||
          u.id === item.assignee_id
        );
        if (matched) {
          targetUserId = matched.id;
          targetUserName = matched.name;
        }
      }

      const dueInDays = Number(item.due_in_days) || 2;
      const dueDateObj = new Date(now.getTime() + dueInDays * 86400000);
      const dueDateStr = dueDateObj.toISOString().slice(0, 10);
      const startDateStr = now.toISOString().slice(0, 10);

      const taskRecord = {
        id: taskId,
        title: item.title,
        description: item.description || `Action item agreed upon during call ${callId}.`,
        category: 'Project',
        department: 'Operations',
        project: 'General',
        assignee_id: targetUserId,
        creator_id: creatorId || 'usr-1',
        priority: item.priority || 'medium',
        status: 'todo',
        start_date: startDateStr,
        due_date: dueDateStr,
        estimated_hours: 3,
        tags: JSON.stringify(['AI-Call-Task', 'PulseBot']),
        checklist: '[]',
        comments: '[]',
        activity_log: JSON.stringify([
          {
            id: `act-${Date.now()}-${i}`,
            timestamp: now.toISOString(),
            userId: creatorId,
            action: `Task auto-generated by PulseBot from call action items and assigned to ${targetUserName}`
          }
        ]),
        progress: 0,
        followups: '[]'
      };

      if (isConnected()) {
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
        ]).catch((e) => console.warn('Could not insert task:', e.message));
      }

      // Broadcast task creation in real-time
      broadcastTaskCreated({
        ...taskRecord,
        assigneeId: targetUserId,
        creatorId: creatorId,
        assigneeName: targetUserName,
        creatorName: creatorName,
        tags: ['AI-Call-Task', 'PulseBot']
      });

      // Send notification to assignee
      const notif = {
        id: `notif-call-${Date.now()}-${i}`,
        title: '✨ Meeting Action Item Assigned',
        message: `Task "${item.title}" was created by PulseBot from meeting minutes and assigned to you.`,
        type: 'assignment',
        taskId: taskId,
        timestamp: now.toISOString()
      };

      if (isConnected()) {
        await query(
          'INSERT INTO notifications (id, title, message, type, task_id, user_id, is_read) VALUES (?, ?, ?, ?, ?, ?, 0)',
          [notif.id, notif.title, notif.message, notif.type, notif.taskId, targetUserId]
        ).catch(() => {});
      }
      broadcastNotification(notif, targetUserId);

      createdTasks.push({
        ...taskRecord,
        assigneeName: targetUserName,
        originalActionItem: item
      });
    }

    // Optionally post Meeting Minutes card to chat channel
    if (postSummaryToChat && channelId) {
      try {
        const taskTitlesList = createdTasks.map(t => `• ${t.title} (@${t.assigneeName})`).join('\n');
        const minutesText = `📋 *Meeting Minutes & Tasks Assigned*\n\nPulseBot has created ${createdTasks.length} task${createdTasks.length > 1 ? 's' : ''} from this call:\n${taskTitlesList}`;

        const msgId = `minutemsg-${Date.now()}`;
        const chatMsg = {
          id: msgId,
          channelId,
          senderId: 'ai-pulsebot',
          senderName: 'PulseBot (AI Copilot)',
          senderRole: 'AI Assistant',
          senderAvatar: 'https://ui-avatars.com/api/?name=Pulse+Bot&background=00A884&color=fff',
          messageType: 'ai_meeting_minutes',
          text: minutesText,
          status: 'sent',
          timestamp: new Date().toISOString()
        };

        if (isConnected()) {
          await query(`
            INSERT INTO chat_messages (
              id, channel_id, sender_id, sender_name, sender_role,
              sender_avatar, message_type, text, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `, [
            msgId, channelId, 'ai-pulsebot', 'PulseBot (AI Copilot)',
            'AI Assistant', chatMsg.senderAvatar, 'ai_meeting_minutes', minutesText, 'sent'
          ]).catch(() => {});

          await query(`
            UPDATE chat_channels
            SET last_message_id = ?, last_message_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [msgId, channelId]).catch(() => {});
        }

        broadcastChatMessage(channelId, chatMsg);
      } catch (chatErr) {
        console.warn('Could not post meeting minutes to chat:', chatErr.message);
      }
    }

    return res.json({
      success: true,
      createdCount: createdTasks.length,
      tasks: createdTasks
    });
  } catch (error) {
    console.error('Error creating tasks from action items:', error);
    return res.status(500).json({ success: false, error: 'Failed to create tasks from call' });
  }
};
