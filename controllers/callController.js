import { query, isConnected } from '../config/db.js';
import { broadcastChatMessage } from '../socket.js';

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
          call_type, status, duration_seconds, channel_id, created_at
        FROM call_logs
        WHERE caller_id = ? OR receiver_id = ?
        ORDER BY created_at DESC
        LIMIT 100
      `, [userId, userId]);

      return res.json({
        success: true,
        calls: rows || []
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
