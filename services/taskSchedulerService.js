import { query, isConnected } from '../config/db.js';
import { readDb, writeDb } from '../data/dbStore.js';
import {
  broadcastTaskUpdated,
  broadcastTaskCreated,
  broadcastNotification,
  getIO
} from '../socket.js';

let schedulerInterval = null;
let isRunningCheck = false;

/**
 * Formats a raw MySQL task row into a clean frontend-ready task object
 */
function formatTaskRow(t) {
  if (!t) return null;
  return {
    ...t,
    assigneeId: t.assignee_id || t.assigneeId,
    coAssignees: typeof t.co_assignees === 'string' ? JSON.parse(t.co_assignees || '[]') : (t.co_assignees || []),
    creatorId: t.creator_id || t.creatorId,
    approvalOwnerId: t.approval_owner_id || t.approvalOwnerId,
    backupPersonId: t.backup_person_id || t.backupPersonId,
    watchers: typeof t.watchers === 'string' ? JSON.parse(t.watchers || '[]') : (t.watchers || []),
    startDate: t.start_date || t.startDate,
    dueDate: t.due_date || t.dueDate,
    estimatedHours: Number(t.estimated_hours || t.estimatedHours || 8),
    actualHours: Number(t.actual_hours || t.actualHours || 0),
    delayReason: t.delay_reason || t.delayReason || '',
    recurring: typeof t.recurring === 'string' ? JSON.parse(t.recurring || '{}') : (t.recurring || {}),
    tags: typeof t.tags === 'string' ? JSON.parse(t.tags || '[]') : (t.tags || []),
    customFields: typeof t.custom_fields === 'string' ? JSON.parse(t.custom_fields || '{}') : (t.custom_fields || {}),
    checklist: typeof t.checklist === 'string' ? JSON.parse(t.checklist || '[]') : (t.checklist || []),
    dependencies: typeof t.dependencies === 'string' ? JSON.parse(t.dependencies || '[]') : (t.dependencies || []),
    attachments: typeof t.attachments === 'string' ? JSON.parse(t.attachments || '[]') : (t.attachments || []),
    remarks: t.remarks || '',
    comments: typeof t.comments === 'string' ? JSON.parse(t.comments || '[]') : (t.comments || []),
    activityLog: typeof t.activity_log === 'string' ? JSON.parse(t.activity_log || '[]') : (t.activity_log || []),
    progress: Number(t.progress !== undefined && t.progress !== null ? t.progress : 0),
    followups: typeof t.followups === 'string' ? JSON.parse(t.followups || '[]') : (t.followups || []),
    scheduledAt: t.scheduled_at || t.scheduledAt || null,
    isScheduled: Boolean(t.is_scheduled || t.isScheduled || (t.status === 'Scheduled')),
    dispatchedAt: t.dispatched_at || t.dispatchedAt || null
  };
}

/**
 * Checks for pending scheduled tasks whose allotment time has arrived and dispatches them
 */
export async function checkAndDispatchScheduledTasks() {
  if (isRunningCheck) return;
  isRunningCheck = true;

  try {
    const nowMs = Date.now();

    if (isConnected()) {
      const rows = await query(`
        SELECT t.*, u.name AS assignee_name, u.email AS assignee_email, u.role AS assignee_role,
               c.name AS creator_name
        FROM tasks t
        LEFT JOIN users u ON t.assignee_id = u.id
        LEFT JOIN users c ON t.creator_id = c.id
        WHERE (t.status = 'Scheduled' OR t.is_scheduled = 1)
          AND (t.dispatched_at IS NULL OR t.status = 'Scheduled')
          AND t.scheduled_at IS NOT NULL
      `).catch(() => []);

      for (const t of rows || []) {
        if (!t.scheduled_at) continue;

        const schedTimeMs = new Date(t.scheduled_at).getTime();
        // If scheduled time has arrived or passed
        if (!isNaN(schedTimeMs) && schedTimeMs <= nowMs) {
          const nowIso = new Date().toISOString();
          let currentLog = [];
          try {
            currentLog = typeof t.activity_log === 'string' ? JSON.parse(t.activity_log || '[]') : (t.activity_log || []);
          } catch (e) {
            currentLog = [];
          }

          currentLog.push({
            id: `act-disp-${Date.now()}`,
            timestamp: nowIso,
            userId: 'system-scheduler',
            action: `⚡ Automated Scheduler dispatched task to ${t.assignee_name || 'assignee'} (Zapier Automation Trigger)`
          });

          await query(`
            UPDATE tasks
            SET status = 'Assigned',
                is_scheduled = 0,
                dispatched_at = CURRENT_TIMESTAMP,
                activity_log = ?
            WHERE id = ?
          `, [JSON.stringify(currentLog), t.id]).catch(e => console.warn('Schedule update warning:', e.message));

          // Fetch updated task row
          const [updatedRow] = await query('SELECT * FROM tasks WHERE id = ?', [t.id]).catch(() => [null]);
          const formattedTask = updatedRow ? formatTaskRow(updatedRow) : {
            ...formatTaskRow(t),
            status: 'Assigned',
            isScheduled: false,
            dispatchedAt: nowIso
          };

          // 1. Broadcast task update to all clients
          broadcastTaskUpdated(formattedTask);

          // 2. Real-time dedicated trigger event
          const io = getIO();
          if (io) {
            io.emit('task:scheduled_triggered', formattedTask);
            if (t.assignee_id) {
              io.to(`user:${t.assignee_id}`).emit('task:scheduled_triggered', formattedTask);
            }
          }

          // 3. Create notification for assignee
          const notifId = `notif-sched-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
          const notif = {
            id: notifId,
            title: '⚡ Scheduled Task Activated',
            message: `Task "${t.title}" (${t.id}) has been automatically dispatched to your task list.`,
            type: 'assignment',
            taskId: t.id,
            timestamp: nowIso
          };

          await query(
            'INSERT INTO notifications (id, title, message, type, task_id, user_id, is_read) VALUES (?, ?, ?, ?, ?, ?, 0)',
            [notif.id, notif.title, notif.message, notif.type, notif.taskId, t.assignee_id]
          ).catch(() => {});

          broadcastNotification(notif, t.assignee_id);
          console.log(`⚡ [Task Scheduler] Dispatched scheduled task "${t.title}" (${t.id}) to ${t.assignee_name || t.assignee_id}`);
        }
      }
    } else {
      // Fallback mode for JSON DB
      const db = readDb();
      const tasks = db.tasks || [];
      let hasChanges = false;

      for (const t of tasks) {
        if ((t.status === 'Scheduled' || t.isScheduled) && (!t.dispatchedAt || t.status === 'Scheduled') && t.scheduledAt) {
          const schedTimeMs = new Date(t.scheduledAt).getTime();
          if (!isNaN(schedTimeMs) && schedTimeMs <= nowMs) {
            t.status = 'Assigned';
            t.isScheduled = false;
            t.dispatchedAt = new Date().toISOString();
            hasChanges = true;
            broadcastTaskUpdated(t);
            broadcastNotification({
              id: `notif-sched-${Date.now()}`,
              title: '⚡ Scheduled Task Activated',
              message: `Task "${t.title}" (${t.id}) is now active on your task list.`,
              type: 'assignment',
              taskId: t.id,
              timestamp: new Date().toISOString()
            }, t.assigneeId);
            console.log(`⚡ [Task Scheduler (JSON)] Dispatched scheduled task "${t.title}" (${t.id})`);
          }
        }
      }

      if (hasChanges) {
        writeDb(db);
      }
    }
  } catch (err) {
    console.error('Error in checkAndDispatchScheduledTasks:', err);
  } finally {
    isRunningCheck = false;
  }
}

/**
 * Manually dispatches a scheduled task immediately ahead of its allotment time
 */
export async function dispatchScheduledTaskNow(taskId) {
  if (!taskId) return null;

  try {
    const nowIso = new Date().toISOString();

    if (isConnected()) {
      const rows = await query(`
        SELECT t.*, u.name AS assignee_name
        FROM tasks t
        LEFT JOIN users u ON t.assignee_id = u.id
        WHERE t.id = ?
      `, [taskId]).catch(() => []);

      if (!rows || rows.length === 0) return null;
      const t = rows[0];

      let currentLog = [];
      try {
        currentLog = typeof t.activity_log === 'string' ? JSON.parse(t.activity_log || '[]') : (t.activity_log || []);
      } catch (e) {
        currentLog = [];
      }

      currentLog.push({
        id: `act-disp-${Date.now()}`,
        timestamp: nowIso,
        userId: 'manual-trigger',
        action: `⚡ Task manually dispatched ahead of schedule by manager (Zapier Trigger)`
      });

      await query(`
        UPDATE tasks
        SET status = 'Assigned',
            is_scheduled = 0,
            dispatched_at = CURRENT_TIMESTAMP,
            activity_log = ?
        WHERE id = ?
      `, [JSON.stringify(currentLog), taskId]);

      const [updatedRow] = await query('SELECT * FROM tasks WHERE id = ?', [taskId]);
      const formatted = updatedRow ? formatTaskRow(updatedRow) : null;

      if (formatted) {
        broadcastTaskUpdated(formatted);
        const io = getIO();
        if (io) {
          io.emit('task:scheduled_triggered', formatted);
          if (t.assignee_id) {
            io.to(`user:${t.assignee_id}`).emit('task:scheduled_triggered', formatted);
          }
        }

        const notif = {
          id: `notif-disp-${Date.now()}`,
          title: '⚡ Task Dispatched to Your Workstation',
          message: `Task "${t.title}" (${t.id}) has been activated and added to your task list.`,
          type: 'assignment',
          taskId: t.id,
          timestamp: nowIso
        };
        await query(
          'INSERT INTO notifications (id, title, message, type, task_id, user_id, is_read) VALUES (?, ?, ?, ?, ?, ?, 0)',
          [notif.id, notif.title, notif.message, notif.type, notif.taskId, t.assignee_id]
        ).catch(() => {});
        broadcastNotification(notif, t.assignee_id);
      }

      return formatted;
    } else {
      const db = readDb();
      const task = (db.tasks || []).find(t => t.id === taskId);
      if (task) {
        task.status = 'Assigned';
        task.isScheduled = false;
        task.dispatchedAt = nowIso;
        writeDb(db);
        broadcastTaskUpdated(task);
        return task;
      }
      return null;
    }
  } catch (err) {
    console.error('Error in dispatchScheduledTaskNow:', err);
    throw err;
  }
}

/**
 * Starts the continuous background scheduler worker
 */
export function startTaskScheduler(intervalMs = 10000) {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  console.log(`⏰ [Task Scheduler] Background Zapier-style automated dispatcher initialized (interval: ${intervalMs / 1000}s)`);

  // Run initial check after server boot
  setTimeout(() => {
    checkAndDispatchScheduledTasks();
  }, 3000);

  // Poll continuously
  schedulerInterval = setInterval(() => {
    checkAndDispatchScheduledTasks();
  }, intervalMs);
}
