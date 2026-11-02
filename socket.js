import { Server } from 'socket.io';

let io = null;

export function initSocket(httpServer, corsOrigin) {
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 [Socket.IO] Client connected: ${socket.id}`);

    // Join user room for targeted notifications
    socket.on('user:join', (userId) => {
      if (userId) {
        socket.join(`user:${userId}`);
        socket.join('broadcast');
        console.log(`👤 [Socket.IO] User ${userId} joined notification room.`);
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

    socket.on('disconnect', () => {
      console.log(`🔌 [Socket.IO] Client disconnected: ${socket.id}`);
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
    io.emit('chat:message', message);
    io.emit('chat:activity', { channelId, message });
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

