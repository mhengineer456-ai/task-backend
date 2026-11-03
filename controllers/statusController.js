import { query, isConnected } from '../config/db.js';
import { broadcastStatusCreated, broadcastStatusViewed, broadcastStatusDeleted, broadcastChatMessage } from '../socket.js';

// Fallback in-memory storage for offline / local-fallback mode
let fallbackStatuses = [];
let fallbackViews = []; // { id, status_id, viewer_id, viewer_name, viewer_avatar, viewed_at }
let fallbackPrivacy = {}; // { [userId]: { privacyType, excludedUsers, allowedUsers } }

// Helper to clean expired statuses
const pruneExpiredStatuses = () => {
  const now = new Date();
  fallbackStatuses = fallbackStatuses.filter(s => !s.is_deleted && new Date(s.expires_at) > now);
};

export const getStatusFeed = async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required to fetch status feed' });
    }

    let allActiveStatuses = [];
    let userViews = [];

    if (isConnected()) {
      // Fetch unexpired, non-deleted statuses within the last 24 hours
      allActiveStatuses = await query(`
        SELECT 
          s.id, s.user_id, s.user_name, s.user_avatar, s.type, s.content, 
          s.media_url, s.background_color, s.text_color, s.font_style, 
          s.privacy_type, s.privacy_users, s.created_at, s.expires_at,
          COALESCE(v.views_count, 0) as views_count,
          CASE WHEN my_view.viewer_id IS NOT NULL THEN 1 ELSE 0 END as has_viewed
        FROM user_statuses s
        LEFT JOIN (
          SELECT status_id, COUNT(*) as views_count 
          FROM status_views 
          GROUP BY status_id
        ) v ON s.id = v.status_id
        LEFT JOIN status_views my_view ON s.id = my_view.status_id AND my_view.viewer_id = ?
        WHERE s.is_deleted = 0 AND s.expires_at > NOW()
        ORDER BY s.created_at ASC
      `, [userId]);

      // Normalize privacy_users JSON column
      allActiveStatuses = (allActiveStatuses || []).map(s => {
        let privacyUsers = [];
        try {
          privacyUsers = typeof s.privacy_users === 'string' ? JSON.parse(s.privacy_users) : (s.privacy_users || []);
        } catch (e) {
          privacyUsers = [];
        }
        return {
          ...s,
          privacy_users: Array.isArray(privacyUsers) ? privacyUsers : [],
          has_viewed: Boolean(s.has_viewed),
          views_count: Number(s.views_count) || 0
        };
      });
    } else {
      pruneExpiredStatuses();
      allActiveStatuses = fallbackStatuses.map(s => {
        const viewsForStatus = fallbackViews.filter(v => v.status_id === s.id);
        const hasViewed = viewsForStatus.some(v => String(v.viewer_id) === String(userId));
        return {
          ...s,
          views_count: viewsForStatus.length,
          has_viewed: hasViewed
        };
      });
    }

    // SERVER-SIDE PRIVACY ENFORCEMENT: Filter out any statuses that the viewer is not authorized to see
    const authorizedStatuses = allActiveStatuses.filter(status => {
      // The creator can always see their own statuses
      if (String(status.user_id) === String(userId)) return true;

      const pType = status.privacy_type || 'contacts';
      const pUsers = Array.isArray(status.privacy_users) ? status.privacy_users.map(String) : [];

      if (pType === 'contacts') {
        return true;
      } else if (pType === 'except') {
        // Excluded users cannot see this status
        return !pUsers.includes(String(userId));
      } else if (pType === 'only') {
        // Only explicitly allowed users can see this status
        return pUsers.includes(String(userId));
      }
      return true;
    });

    // Group statuses by user for the WhatsApp/Instagram story carousel
    const userMap = new Map();
    for (const rawStatus of authorizedStatuses) {
      const status = {
        ...rawStatus,
        content: rawStatus.content || '',
        text: rawStatus.content || '',
        caption: rawStatus.type !== 'text' ? (rawStatus.content || '') : '',
        mediaUrl: rawStatus.media_url || null,
        media_url: rawStatus.media_url || null,
        backgroundColor: rawStatus.background_color || '#007AFF',
        background_color: rawStatus.background_color || '#007AFF',
        textColor: rawStatus.text_color || '#FFFFFF',
        text_color: rawStatus.text_color || '#FFFFFF',
        typographyStyle: rawStatus.font_style || 'sans',
        fontStyle: rawStatus.font_style || 'sans',
        font_style: rawStatus.font_style || 'sans',
        createdAt: rawStatus.created_at,
        created_at: rawStatus.created_at,
        expiresAt: rawStatus.expires_at,
        expires_at: rawStatus.expires_at,
        viewCount: Number(rawStatus.views_count) || 0,
        viewsCount: Number(rawStatus.views_count) || 0,
        views_count: Number(rawStatus.views_count) || 0,
        hasViewed: Boolean(rawStatus.has_viewed),
        has_viewed: Boolean(rawStatus.has_viewed)
      };

      const uid = String(status.user_id);
      if (!userMap.has(uid)) {
        userMap.set(uid, {
          userId: status.user_id,
          userName: status.user_name,
          userAvatar: status.user_avatar,
          user: {
            id: status.user_id,
            name: status.user_name,
            avatar: status.user_avatar
          },
          statuses: [],
          lastUpdated: status.created_at,
          latestAt: status.created_at,
          hasUnviewed: false,
          hasUnread: false,
          unreadCount: 0
        });
      }

      const group = userMap.get(uid);
      group.statuses.push(status);
      if (new Date(status.created_at) > new Date(group.lastUpdated)) {
        group.lastUpdated = status.created_at;
        group.latestAt = status.created_at;
      }
      if (!status.has_viewed && String(status.user_id) !== String(userId)) {
        group.hasUnviewed = true;
        group.hasUnread = true;
        group.unreadCount = (group.unreadCount || 0) + 1;
      }
    }

    // Segregate into:
    // 1. My Status (current user's statuses)
    // 2. Recent Updates (contacts with at least one unviewed status)
    // 3. Viewed Updates (contacts whose active statuses have all been viewed)
    let myStatusGroup = null;
    const recentUpdates = [];
    const viewedUpdates = [];

    for (const [uid, group] of userMap.entries()) {
      if (uid === String(userId)) {
        myStatusGroup = group;
      } else {
        if (group.hasUnviewed || group.hasUnread) {
          recentUpdates.push(group);
        } else {
          viewedUpdates.push(group);
        }
      }
    }

    // Sort recent updates and viewed updates by latest timestamp descending
    recentUpdates.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
    viewedUpdates.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

    return res.json({
      success: true,
      myStatus: myStatusGroup,
      recentUpdates,
      viewedUpdates,
      totalActiveStatuses: authorizedStatuses.length
    });
  } catch (error) {
    console.error('Error fetching status feed:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch status feed' });
  }
};

export const createStatus = async (req, res) => {
  try {
    const {
      userId,
      userName,
      userAvatar,
      type = 'text',
      content = '',
      mediaUrl = null,
      backgroundColor = '#007AFF',
      textColor = '#FFFFFF',
      fontStyle = 'sans',
      privacyType = 'contacts',
      privacyUsers = []
    } = req.body;

    if (!userId || !userName) {
      return res.status(400).json({ success: false, error: 'User ID and User Name are required' });
    }

    if (type === 'text' && (!content || !content.trim())) {
      return res.status(400).json({ success: false, error: 'Status text content cannot be empty' });
    }

    if ((type === 'image' || type === 'video') && !mediaUrl) {
      return res.status(400).json({ success: false, error: 'Media URL is required for photo or video status' });
    }

    const statusId = `stat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

    const newStatus = {
      id: statusId,
      user_id: userId,
      user_name: userName,
      user_avatar: userAvatar || '',
      type,
      content: content.trim(),
      media_url: mediaUrl,
      background_color: backgroundColor,
      text_color: textColor,
      font_style: fontStyle,
      privacy_type: privacyType,
      privacy_users: Array.isArray(privacyUsers) ? privacyUsers : [],
      created_at: createdAt,
      expires_at: expiresAt,
      is_deleted: false,
      views_count: 0,
      has_viewed: false,
      text: content.trim(),
      caption: type !== 'text' ? content.trim() : '',
      mediaUrl: mediaUrl,
      backgroundColor: backgroundColor,
      textColor: textColor,
      fontStyle: fontStyle,
      typographyStyle: fontStyle,
      createdAt: createdAt,
      expiresAt: expiresAt,
      viewCount: 0,
      viewsCount: 0
    };

    if (isConnected()) {
      await query(`
        INSERT INTO user_statuses (
          id, user_id, user_name, user_avatar, type, content, 
          media_url, background_color, text_color, font_style, 
          privacy_type, privacy_users, created_at, expires_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `, [
        statusId, userId, userName, userAvatar || '', type, content.trim(),
        mediaUrl, backgroundColor, textColor, fontStyle,
        privacyType, JSON.stringify(newStatus.privacy_users), createdAt, expiresAt
      ]);
    } else {
      fallbackStatuses.unshift(newStatus);
    }

    // Broadcast real-time status created event
    broadcastStatusCreated(newStatus);

    return res.status(201).json({ success: true, status: newStatus });
  } catch (error) {
    console.error('Error creating status:', error);
    return res.status(500).json({ success: false, error: 'Failed to create status' });
  }
};

export const recordStatusView = async (req, res) => {
  try {
    const { statusId } = req.params;
    const { viewerId, viewerName, viewerAvatar } = req.body;

    if (!statusId || !viewerId) {
      return res.status(400).json({ success: false, error: 'Status ID and Viewer ID are required' });
    }

    let statusOwnerId = null;

    if (isConnected()) {
      // Find the status and its creator
      const [statusRow] = await query('SELECT user_id FROM user_statuses WHERE id = ?', [statusId]);
      if (!statusRow) {
        return res.status(404).json({ success: false, error: 'Status not found' });
      }
      statusOwnerId = statusRow.user_id;

      // Do not count the creator viewing their own status in the genuine viewer count
      if (String(statusOwnerId) === String(viewerId)) {
        return res.json({ success: true, isOwner: true, message: 'Owner view not recorded in viewer list' });
      }

      const viewId = `view-${statusId}-${viewerId}`;
      const viewedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

      // Strictly Genuine Authenticated Viewers Tracking (Idempotent: ON DUPLICATE KEY IGNORE)
      const result = await query(`
        INSERT INTO status_views (id, status_id, viewer_id, viewer_name, viewer_avatar, viewed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE viewed_at = viewed_at
      `, [viewId, statusId, viewerId, viewerName || 'Team Member', viewerAvatar || '', viewedAt]);

      const [countResult] = await query('SELECT COUNT(*) as count FROM status_views WHERE status_id = ?', [statusId]);
      const viewsCount = countResult ? countResult.count : 0;

      // Notify the status owner in real-time
      broadcastStatusViewed({
        statusId,
        ownerId: statusOwnerId,
        viewer: {
          id: viewerId,
          name: viewerName || 'Team Member',
          avatar: viewerAvatar || '',
          viewedAt
        },
        viewsCount
      });

      return res.json({ success: true, viewsCount });
    } else {
      const status = fallbackStatuses.find(s => s.id === statusId);
      if (!status) {
        return res.status(404).json({ success: false, error: 'Status not found' });
      }
      statusOwnerId = status.user_id;

      if (String(statusOwnerId) === String(viewerId)) {
        return res.json({ success: true, isOwner: true });
      }

      const existingView = fallbackViews.find(v => v.status_id === statusId && String(v.viewer_id) === String(viewerId));
      if (!existingView) {
        const viewRecord = {
          id: `view-${statusId}-${viewerId}`,
          status_id: statusId,
          viewer_id: viewerId,
          viewer_name: viewerName || 'Team Member',
          viewer_avatar: viewerAvatar || '',
          viewed_at: new Date().toISOString()
        };
        fallbackViews.push(viewRecord);

        const viewsCount = fallbackViews.filter(v => v.status_id === statusId).length;
        broadcastStatusViewed({
          statusId,
          ownerId: statusOwnerId,
          viewer: viewRecord,
          viewsCount
        });
        return res.json({ success: true, viewsCount });
      }

      const viewsCount = fallbackViews.filter(v => v.status_id === statusId).length;
      return res.json({ success: true, viewsCount, alreadyRecorded: true });
    }
  } catch (error) {
    console.error('Error recording status view:', error);
    return res.status(500).json({ success: false, error: 'Failed to record status view' });
  }
};

export const getStatusViews = async (req, res) => {
  try {
    const { statusId } = req.params;
    const { userId } = req.query;

    if (!statusId || !userId) {
      return res.status(400).json({ success: false, error: 'Status ID and User ID are required' });
    }

    if (isConnected()) {
      // Verify that the requester is the owner of the status
      const [status] = await query('SELECT user_id, user_name, created_at, expires_at FROM user_statuses WHERE id = ?', [statusId]);
      if (!status) {
        return res.status(404).json({ success: false, error: 'Status not found' });
      }

      if (String(status.user_id) !== String(userId)) {
        return res.status(403).json({ success: false, error: 'Unauthorized: Only the status owner can view who viewed their status' });
      }

      // Fetch authentic viewers list ordered by view time descending
      const views = await query(`
        SELECT id, viewer_id, viewer_name, viewer_avatar, viewed_at
        FROM status_views
        WHERE status_id = ?
        ORDER BY viewed_at DESC
      `, [statusId]);

      return res.json({
        success: true,
        statusId,
        totalViews: views.length,
        views: views.map(v => ({
          id: v.id,
          viewerId: v.viewer_id,
          name: v.viewer_name,
          avatar: v.viewer_avatar,
          viewedAt: v.viewed_at
        }))
      });
    } else {
      const status = fallbackStatuses.find(s => s.id === statusId);
      if (!status) {
        return res.status(404).json({ success: false, error: 'Status not found' });
      }

      if (String(status.user_id) !== String(userId)) {
        return res.status(403).json({ success: false, error: 'Unauthorized: Only the status owner can view viewers list' });
      }

      const views = fallbackViews
        .filter(v => v.status_id === statusId)
        .sort((a, b) => new Date(b.viewed_at) - new Date(a.viewed_at))
        .map(v => ({
          id: v.id,
          viewerId: v.viewer_id,
          name: v.viewer_name,
          avatar: v.viewer_avatar,
          viewedAt: v.viewed_at
        }));

      return res.json({
        success: true,
        statusId,
        totalViews: views.length,
        views
      });
    }
  } catch (error) {
    console.error('Error fetching status views:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch status views' });
  }
};

export const deleteStatus = async (req, res) => {
  try {
    const { statusId } = req.params;
    const userId = req.query.userId || req.body.userId;

    if (!statusId || !userId) {
      return res.status(400).json({ success: false, error: 'Status ID and User ID are required' });
    }

    if (isConnected()) {
      const [status] = await query('SELECT user_id FROM user_statuses WHERE id = ?', [statusId]);
      if (!status) {
        return res.status(404).json({ success: false, error: 'Status not found' });
      }

      if (String(status.user_id) !== String(userId)) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You can only delete your own statuses' });
      }

      await query('UPDATE user_statuses SET is_deleted = 1 WHERE id = ?', [statusId]);
    } else {
      const status = fallbackStatuses.find(s => s.id === statusId);
      if (!status) {
        return res.status(404).json({ success: false, error: 'Status not found' });
      }
      if (String(status.user_id) !== String(userId)) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You can only delete your own statuses' });
      }
      status.is_deleted = true;
    }

    broadcastStatusDeleted(statusId);
    return res.json({ success: true, message: 'Status deleted successfully' });
  } catch (error) {
    console.error('Error deleting status:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete status' });
  }
};

export const getStatusPrivacy = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    if (isConnected()) {
      const [row] = await query('SELECT * FROM user_status_privacy WHERE user_id = ?', [userId]);
      if (row) {
        return res.json({
          success: true,
          privacy: {
            privacyType: row.privacy_type || 'contacts',
            excludedUsers: typeof row.excluded_users === 'string' ? JSON.parse(row.excluded_users || '[]') : (row.excluded_users || []),
            allowedUsers: typeof row.allowed_users === 'string' ? JSON.parse(row.allowed_users || '[]') : (row.allowed_users || [])
          }
        });
      }
    } else if (fallbackPrivacy[userId]) {
      return res.json({ success: true, privacy: fallbackPrivacy[userId] });
    }

    // Default to 'contacts'
    return res.json({
      success: true,
      privacy: {
        privacyType: 'contacts',
        excludedUsers: [],
        allowedUsers: []
      }
    });
  } catch (error) {
    console.error('Error fetching status privacy:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch status privacy' });
  }
};

export const updateStatusPrivacy = async (req, res) => {
  try {
    const { userId } = req.params;
    const { privacyType = 'contacts', excludedUsers = [], allowedUsers = [] } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    if (isConnected()) {
      await query(`
        INSERT INTO user_status_privacy (user_id, privacy_type, excluded_users, allowed_users)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          privacy_type = VALUES(privacy_type),
          excluded_users = VALUES(excluded_users),
          allowed_users = VALUES(allowed_users)
      `, [userId, privacyType, JSON.stringify(excludedUsers), JSON.stringify(allowedUsers)]);
    } else {
      fallbackPrivacy[userId] = { privacyType, excludedUsers, allowedUsers };
    }

    return res.json({ success: true, message: 'Status privacy settings updated' });
  } catch (error) {
    console.error('Error updating status privacy:', error);
    return res.status(500).json({ success: false, error: 'Failed to update status privacy' });
  }
};

export const replyToStatus = async (req, res) => {
  try {
    const { statusId } = req.params;
    const { senderId, senderName, senderRole, senderAvatar, text } = req.body;

    if (!statusId || !senderId || !text) {
      return res.status(400).json({ success: false, error: 'Status ID, sender ID, and reply text are required' });
    }

    let status = null;
    if (isConnected()) {
      const [row] = await query('SELECT * FROM user_statuses WHERE id = ?', [statusId]);
      status = row;
    } else {
      status = fallbackStatuses.find(s => s.id === statusId);
    }

    if (!status) {
      return res.status(404).json({ success: false, error: 'Status not found or expired' });
    }

    const targetUserId = status.user_id;
    if (String(targetUserId) === String(senderId)) {
      return res.status(400).json({ success: false, error: 'You cannot reply to your own status' });
    }

    // Direct channel ID convention: dm-minUser-maxUser
    const sorted = [String(senderId), String(targetUserId)].sort();
    const dmChannelId = `dm-${sorted[0]}-${sorted[1]}`;

    // Create message with status reply preview
    const replySnippet = status.type === 'text' 
      ? status.content 
      : status.type === 'image' 
        ? (status.content ? `📷 Photo: ${status.content}` : '📷 Photo Status')
        : (status.content ? `🎥 Video: ${status.content}` : '🎥 Video Status');

    const formattedMessageText = `Replied to your status:\n> "${replySnippet}"\n\n${text}`;

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const messageObj = {
      id: messageId,
      channelId: dmChannelId,
      senderId,
      senderName,
      senderRole: senderRole || 'Team Member',
      senderAvatar: senderAvatar || '',
      messageType: 'status_reply',
      text: formattedMessageText,
      replyToStatusId: statusId,
      createdAt,
      timestamp: createdAt,
      status: 'sent'
    };

    if (isConnected()) {
      // Ensure DM channel exists
      await query(`
        INSERT INTO chat_channels (id, name, type, participant_ids, is_private, last_message_id, last_message_at)
        VALUES (?, ?, 'direct', ?, 1, ?, ?)
        ON DUPLICATE KEY UPDATE 
          last_message_id = VALUES(last_message_id),
          last_message_at = VALUES(last_message_at)
      `, [dmChannelId, `${senderName} & ${status.user_name}`, JSON.stringify(sorted), messageId, createdAt]);

      await query(`
        INSERT INTO chat_messages (id, channel_id, sender_id, sender_name, sender_role, sender_avatar, message_type, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'status_reply', ?, ?)
      `, [messageId, dmChannelId, senderId, senderName, senderRole || 'Team Member', senderAvatar || '', formattedMessageText, createdAt]);
    }

    broadcastChatMessage(dmChannelId, messageObj);

    return res.status(201).json({ success: true, message: messageObj, channelId: dmChannelId });
  } catch (error) {
    console.error('Error replying to status:', error);
    return res.status(500).json({ success: false, error: 'Failed to send reply to status' });
  }
};
