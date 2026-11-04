import { Server } from 'socket.io';
import { query, isConnected } from './config/db.js';

let io = null;

// Real-Time Calling State Maps
const activeCalls = new Map(); // callId -> callData
const userActiveCallMap = new Map(); // userId -> callId

function cleanupCall(callId) {
  if (!callId) return;
  const call = activeCalls.get(callId);
  if (call) {
    if (call.caller?.id) userActiveCallMap.delete(String(call.caller.id));
    if (call.receiver?.id) userActiveCallMap.delete(String(call.receiver.id));
    activeCalls.delete(callId);
  }
}

export function initSocket(httpServer, corsOrigin) {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Dynamically allow requesting origin for credentials in production
        callback(null, true);
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 30000,
    pingInterval: 15000
  });

  io.on('connection', (socket) => {
    console.log(`🔌 [Socket.IO] Client connected: ${socket.id}`);

    // Join user room for targeted notifications
    socket.on('user:join', (userId) => {
      if (userId) {
        socket.userId = String(userId);
        socket.join(`user:${userId}`);
        socket.join('broadcast');
        console.log(`👤 [Socket.IO] User ${userId} joined notification room.`);

        if (isConnected()) {
          query('UPDATE users SET is_online = 1, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]).catch(() => {});
        }
        io.emit('user:presence', { userId: String(userId), isOnline: true, lastSeenAt: new Date().toISOString() });
      }
    });

    // Message read receipt tracking
    socket.on('message:read', async ({ messageId, channelId, userId }) => {
      if (messageId && userId) {
        if (isConnected()) {
          const receiptId = `rcpt-${messageId}-${userId}`;
          await query(
            `INSERT INTO chat_message_receipts (id, message_id, channel_id, user_id, status, read_at)
             VALUES (?, ?, ?, ?, 'read', CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE status = 'read', read_at = CURRENT_TIMESTAMP`,
            [receiptId, messageId, channelId || '', userId]
          ).catch(() => {});
        }
        if (channelId) {
          io.to(`channel:${channelId}`).emit('message:read_receipt', { messageId, channelId, userId, readAt: new Date().toISOString() });
        }
      }
    });

    // Join specific chat channel
    socket.on('channel:join', (channelId) => {
      if (channelId) {
        socket.join(`channel:${channelId}`);
      }
    });

    // Leave channel
    socket.on('channel:leave', (channelId) => {
      if (channelId) {
        socket.leave(`channel:${channelId}`);
      }
    });

    // Live typing indicator
    socket.on('chat:typing', ({ channelId, user, isTyping }) => {
      io.emit('chat:typing', { channelId, user, isTyping });
    });

    // ====================================================================
    // WebRTC Real-Time Calling Signalling Events
    // ====================================================================

    // 1. Initiate Call
    socket.on('call:initiate', (payload) => {
      try {
        const { callId, caller, receiverId, receiverName, receiverAvatar, callType = 'voice', channelId } = payload;
        if (!callId || !caller?.id || !receiverId) return;

        const callerIdStr = String(caller.id);
        const receiverIdStr = String(receiverId);

        // Check if receiver is already in an active call
        if (userActiveCallMap.has(receiverIdStr)) {
          console.log(`📞 [Call] Receiver ${receiverIdStr} is currently busy.`);
          socket.emit('call:busy', {
            callId,
            receiverId: receiverIdStr,
            reason: 'User is currently on another call.'
          });
          return;
        }

        // Store active call record
        activeCalls.set(callId, {
          callId,
          caller: { ...caller, id: callerIdStr },
          receiver: { id: receiverIdStr, name: receiverName || 'User', avatar: receiverAvatar || '' },
          callType,
          channelId,
          status: 'ringing',
          createdAt: Date.now()
        });

        userActiveCallMap.set(callerIdStr, callId);
        userActiveCallMap.set(receiverIdStr, callId);

        console.log(`📞 [Call] Initiate ${callType} call (${callId}) from ${caller.name} to ${receiverName || receiverIdStr}`);

        // Forward incoming call to receiver's room
        io.to(`user:${receiverIdStr}`).emit('call:incoming', {
          callId,
          caller,
          receiverId: receiverIdStr,
          callType,
          channelId,
          timestamp: Date.now()
        });

        // Notify caller that call has been dispatched and is ringing
        socket.emit('call:ringing', { callId, receiverId: receiverIdStr });
      } catch (err) {
        console.error('Error handling call:initiate:', err);
      }
    });

    // 2. Ringing acknowledgment from receiver
    socket.on('call:ringing', ({ callId, callerId }) => {
      if (callerId) {
        io.to(`user:${callerId}`).emit('call:ringing', { callId });
      }
    });

    // 3. Accept Call
    socket.on('call:accept', ({ callId, callerId, receiver }) => {
      try {
        const call = activeCalls.get(callId);
        if (call) {
          call.status = 'connected';
          call.connectedAt = Date.now();
        }
        console.log(`📞 [Call] Call accepted (${callId}) by ${receiver?.name || 'Receiver'}`);
        io.to(`user:${callerId}`).emit('call:accept', {
          callId,
          receiver
        });
      } catch (err) {
        console.error('Error handling call:accept:', err);
      }
    });

    // 4. Reject Call
    socket.on('call:reject', ({ callId, callerId, reason = 'Call declined' }) => {
      try {
        console.log(`📞 [Call] Call rejected (${callId}): ${reason}`);
        cleanupCall(callId);
        if (callerId) {
          io.to(`user:${callerId}`).emit('call:reject', {
            callId,
            reason
          });
        }
      } catch (err) {
        console.error('Error handling call:reject:', err);
      }
    });

    // 5. SDP Offer
    socket.on('call:offer', ({ callId, targetUserId, offer }) => {
      if (targetUserId && offer) {
        io.to(`user:${targetUserId}`).emit('call:offer', {
          callId,
          offer,
          fromUserId: socket.userId
        });
      }
    });

    // 6. SDP Answer
    socket.on('call:answer', ({ callId, targetUserId, answer }) => {
      if (targetUserId && answer) {
        io.to(`user:${targetUserId}`).emit('call:answer', {
          callId,
          answer,
          fromUserId: socket.userId
        });
      }
    });

    // 7. ICE Candidate
    socket.on('call:ice-candidate', ({ callId, targetUserId, candidate }) => {
      if (targetUserId && candidate) {
        io.to(`user:${targetUserId}`).emit('call:ice-candidate', {
          callId,
          candidate,
          fromUserId: socket.userId
        });
      }
    });

    // 7b. Screen Share Toggle
    socket.on('call:screenshare-toggle', ({ callId, targetUserId, isSharing }) => {
      if (targetUserId) {
        io.to(`user:${targetUserId}`).emit('call:screenshare-toggle', {
          callId,
          fromUserId: socket.userId,
          isSharing
        });
      }
    });

    // 8. End Call
    socket.on('call:end', ({ callId, targetUserId, durationSeconds = 0, reason = 'Call ended' }) => {
      try {
        console.log(`📞 [Call] Call ended (${callId}): ${reason}`);
        cleanupCall(callId);
        if (targetUserId) {
          io.to(`user:${targetUserId}`).emit('call:end', {
            callId,
            endedBy: socket.userId,
            durationSeconds,
            reason
          });
        }
      } catch (err) {
        console.error('Error handling call:end:', err);
      }
    });

    // 9. Missed / Cancelled Call
    socket.on('call:missed', ({ callId, receiverId, reason = 'No answer' }) => {
      try {
        cleanupCall(callId);
        if (receiverId) {
          io.to(`user:${receiverId}`).emit('call:missed', {
            callId,
            reason
          });
        }
      } catch (err) {
        console.error('Error handling call:missed:', err);
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 [Socket.IO] Client disconnected: ${socket.id} (user: ${socket.userId || 'anonymous'})`);
      if (socket.userId) {
        if (isConnected()) {
          query('UPDATE users SET is_online = 0, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [socket.userId]).catch(() => {});
        }
        io.emit('user:presence', { userId: String(socket.userId), isOnline: false, lastSeenAt: new Date().toISOString() });

        const activeCallId = userActiveCallMap.get(String(socket.userId));
        if (activeCallId) {
          const call = activeCalls.get(activeCallId);
          if (call) {
            const peerId = String(call.caller.id) === String(socket.userId) ? call.receiver.id : call.caller.id;
            io.to(`user:${peerId}`).emit('call:end', {
              callId: activeCallId,
              endedBy: socket.userId,
              reason: 'Participant disconnected.'
            });
            cleanupCall(activeCallId);
          }
        }
      }
    });
  });

  return io;
}

export function getIO() {
  return io;
}

// Broadcasters for all real-time events
export function broadcastTaskCreated(task) {
  if (io) {
    io.emit('task:created', task);
  }
}

export function broadcastTaskUpdated(task) {
  if (io) {
    io.emit('task:updated', task);
  }
}

export function broadcastTaskDeleted(taskId) {
  if (io) {
    io.emit('task:deleted', { id: taskId });
  }
}

export function broadcastFollowupAdded(taskId, followup, progress) {
  if (io) {
    io.emit('task:followup', { taskId, followup, progress });
  }
}

export function broadcastChatMessage(channelId, message) {
  if (io) {
    if (channelId && channelId.startsWith('chan-ai-')) {
      const targetUserId = channelId.replace('chan-ai-', '');
      io.to(`channel:${channelId}`).emit('chat:message', message);
      io.to(`user:${targetUserId}`).emit('chat:message', message);
      io.to(`user:${targetUserId}`).emit('chat:activity', { channelId, message });
    } else {
      io.emit('chat:message', message);
      io.emit('chat:activity', { channelId, message });
    }
  }
}

export function broadcastNotification(notification, targetUserId = null) {
  if (io) {
    if (targetUserId) {
      io.to(`user:${targetUserId}`).emit('notification:new', notification);
    } else {
      io.emit('notification:new', notification);
    }
  }
}

export function broadcastLeaveUpdated(leave) {
  if (io) {
    io.emit('leave:updated', leave);
  }
}

export function broadcastReaction(messageId, channelId, reactions) {
  if (io) {
    io.emit('chat:reaction', { messageId, channelId, reactions });
  }
}

export function broadcastChannelCreated(channel) {
  if (io) {
    io.emit('chat:channel_created', channel);
  }
}

export function broadcastStatusCreated(status) {
  if (io) {
    io.emit('status:created', status);
  }
}

export function broadcastStatusViewed(data) {
  if (io) {
    // Notify the status owner directly in their user room for real-time viewer count & list
    if (data.ownerId) {
      io.to(`user:${data.ownerId}`).emit('status:viewed', data);
    }
    // Also emit globally so viewer badges update
    io.emit('status:viewed_global', data);
  }
}

export function broadcastStatusDeleted(statusId) {
  if (io) {
    io.emit('status:deleted', { id: statusId });
  }
}


