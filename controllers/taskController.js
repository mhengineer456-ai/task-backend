import { query, isConnected } from '../config/db.js';
import { readDb, writeDb } from '../data/dbStore.js';
import {
  broadcastTaskCreated,
  broadcastTaskUpdated,
  broadcastTaskDeleted,
  broadcastFollowupAdded,
  broadcastNotification
} from '../socket.js';
import { dispatchScheduledTaskNow } from '../services/taskSchedulerService.js';

const formatTaskRow = (t) => {
  if (!t) return null;
  return {
    ...t,
    id: t.id !== undefined && t.id !== null ? String(t.id) : t.id,
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
};

export const getTasks = async (req, res) => {
  try {
    if (isConnected()) {
      const rows = await query('SELECT * FROM tasks ORDER BY created_at DESC');
      const formatted = (rows || []).map(formatTaskRow);
      return res.json({ success: true, tasks: formatted });
    }

    const db = readDb();
    res.json({ success: true, tasks: db.tasks || [] });
  } catch (error) {
    console.error('Error in getTasks controller:', error);
    res.status(500).json({ success: false, error: 'Database fetch tasks failed' });
  }
};

export const createTask = async (req, res) => {
  try {
    const taskData = req.body;
    const taskId = taskData.id || `TSK-${Date.now()}`;
    const isScheduledTask = Boolean(taskData.isScheduled || taskData.status === 'Scheduled');
    const taskStatus = isScheduledTask ? 'Scheduled' : (taskData.status || 'Assigned');
    const scheduledAtTime = isScheduledTask ? (taskData.scheduledAt || null) : null;

    if (isConnected()) {
      await query(
        `INSERT INTO tasks (
          id, title, description, category, department, project, assignee_id,
          co_assignees, creator_id, approval_owner_id, backup_person_id, watchers,
          priority, status, start_date, due_date, estimated_hours, actual_hours,
          delay_reason, recurring, tags, custom_fields, checklist, dependencies,
          attachments, remarks, comments, activity_log, progress, followups,
          scheduled_at, is_scheduled, dispatched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          taskId,
          taskData.title || 'Untitled Task',
          taskData.description || '',
          taskData.category || 'Software Development',
          taskData.department || 'Engineering & DevOps',
          taskData.project || 'General Project',
          taskData.assigneeId || 'usr-1',
          JSON.stringify(taskData.coAssignees || []),
          taskData.creatorId || 'usr-1',
          taskData.approvalOwnerId || null,
          taskData.backupPersonId || null,
          JSON.stringify(taskData.watchers || []),
          taskData.priority || 'Normal',
          taskStatus,
          taskData.startDate || new Date().toISOString().slice(0, 16),
          taskData.dueDate || new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 16),
          Number(taskData.estimatedHours) || 8,
          Number(taskData.actualHours) || 0,
          taskData.delayReason || '',
          JSON.stringify(taskData.recurring || { isRecurring: false, frequency: 'None' }),
          JSON.stringify(taskData.tags || []),
          JSON.stringify(taskData.customFields || {}),
          JSON.stringify(taskData.checklist || []),
          JSON.stringify(taskData.dependencies || []),
          JSON.stringify(taskData.attachments || []),
          taskData.remarks || '',
          JSON.stringify(taskData.comments || []),
          JSON.stringify(taskData.activityLog || []),
          Math.max(0, Math.min(100, Number(taskData.progress || 0))),
          JSON.stringify(taskData.followups || []),
          scheduledAtTime,
          isScheduledTask ? 1 : 0,
          null
        ]
      );

      const rows = await query('SELECT * FROM tasks WHERE id = ?', [taskId]);
      const created = rows && rows.length > 0 ? formatTaskRow(rows[0]) : {
        id: taskId,
        ...taskData,
        status: taskStatus,
        isScheduled: isScheduledTask,
        scheduledAt: scheduledAtTime
      };

      broadcastTaskCreated(created);

      // Only notify assignee immediately if the task is NOT scheduled for future trigger
      if (!isScheduledTask) {
        broadcastNotification({
          id: `notif-${Date.now()}`,
          title: 'New Task Assigned',
          message: `📋 Task "${created.title}" (${created.id}) was assigned.`,
          type: 'assignment',
          taskId: created.id,
          timestamp: new Date().toISOString()
        }, created.assigneeId);
      } else {
        // Confirmation alert for creator that the task has been queued in the scheduler
        broadcastNotification({
          id: `notif-sched-queued-${Date.now()}`,
          title: '⏰ Task Scheduled in Automations',
          message: `Task "${created.title}" scheduled to trigger automatically at ${created.scheduledAt}.`,
          type: 'info',
          taskId: created.id,
          timestamp: new Date().toISOString()
        }, created.creatorId);
      }

      return res.status(201).json({ success: true, task: created });
    }

    const db = readDb();
    const newTask = {
      id: taskId,
      ...taskData,
      status: taskStatus,
      isScheduled: isScheduledTask,
      scheduledAt: scheduledAtTime,
      dispatchedAt: null,
      progress: Math.max(0, Math.min(100, Number(taskData.progress || 0))),
      followups: taskData.followups || [],
      createdAt: new Date().toISOString()
    };
    db.tasks = [newTask, ...(db.tasks || [])];
    writeDb(db);
    broadcastTaskCreated(newTask);
    res.status(201).json({ success: true, task: newTask });
  } catch (error) {
    console.error('Error in createTask controller:', error);
    res.status(500).json({ success: false, error: 'Task creation failed' });
  }
};

export const dispatchScheduledTask = async (req, res) => {
  try {
    const { id } = req.params;
    const task = await dispatchScheduledTaskNow(id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found or could not be dispatched' });
    }
    res.json({ success: true, task });
  } catch (error) {
    console.error('Error in dispatchScheduledTask:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (isConnected()) {
      const fieldMap = {
        title: 'title',
        description: 'description',
        category: 'category',
        department: 'department',
        project: 'project',
        priority: 'priority',
        status: 'status',
        remarks: 'remarks',
        delayReason: 'delay_reason',
        startDate: 'start_date',
        dueDate: 'due_date',
        assigneeId: 'assignee_id',
        creatorId: 'creator_id',
        approvalOwnerId: 'approval_owner_id',
        backupPersonId: 'backup_person_id',
        scheduledAt: 'scheduled_at',
        isScheduled: 'is_scheduled',
        dispatchedAt: 'dispatched_at'
      };

      const jsonFieldMap = {
        coAssignees: 'co_assignees',
        watchers: 'watchers',
        recurring: 'recurring',
        tags: 'tags',
        customFields: 'custom_fields',
        checklist: 'checklist',
        dependencies: 'dependencies',
        attachments: 'attachments',
        comments: 'comments',
        activityLog: 'activity_log',
        followups: 'followups'
      };

      const setClauses = [];
      const values = [];

      for (const [key, col] of Object.entries(fieldMap)) {
        if (updates[key] !== undefined) {
          setClauses.push(`${col} = ?`);
          values.push(updates[key]);
        }
      }

      for (const [key, col] of Object.entries(jsonFieldMap)) {
        if (updates[key] !== undefined) {
          setClauses.push(`${col} = ?`);
          values.push(JSON.stringify(updates[key]));
        }
      }

      if (updates.progress !== undefined) {
        setClauses.push('progress = ?');
        values.push(Math.max(0, Math.min(100, Number(updates.progress) || 0)));
      }

      if (updates.estimatedHours !== undefined) {
        setClauses.push('estimated_hours = ?');
        values.push(Number(updates.estimatedHours));
      }

      if (updates.actualHours !== undefined) {
        setClauses.push('actual_hours = ?');
        values.push(Number(updates.actualHours));
      }

      if (setClauses.length > 0) {
        values.push(id);
        await query(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`, values);
      }

      const rows = await query('SELECT * FROM tasks WHERE id = ?', [id]);
      const updated = rows && rows.length > 0 ? formatTaskRow(rows[0]) : null;

      if (updated) {
        broadcastTaskUpdated(updated);
        if (updates.progress !== undefined) {
          broadcastNotification({
            id: `notif-${Date.now()}`,
            title: 'Task Progress Updated',
            message: `📊 Progress for "${updated.title}" updated to ${updated.progress}%.`,
            type: 'status',
            taskId: updated.id,
            timestamp: new Date().toISOString()
          });
        }
        if (updates.status !== undefined) {
          broadcastNotification({
            id: `notif-${Date.now()}`,
            title: 'Task Status Changed',
            message: `🔄 "${updated.title}" moved to ${updated.status}.`,
            type: updated.status === 'Review' ? 'approval' : 'status',
            taskId: updated.id,
            timestamp: new Date().toISOString()
          });
        }
        if (updates.assigneeId !== undefined) {
          broadcastNotification({
            id: `notif-${Date.now()}`,
            title: 'Task Reassigned',
            message: `👤 You were assigned "${updated.title}".`,
            type: 'assignment',
            taskId: updated.id,
            timestamp: new Date().toISOString()
          }, updated.assigneeId);
        }
      }

      return res.json({ success: true, task: updated, message: `Task ${id} updated in MySQL.` });
    }

    const db = readDb();
    let updatedTask = null;
    db.tasks = (db.tasks || []).map(t => {
      if (t.id === id) {
        updatedTask = { ...t, ...updates };
        return updatedTask;
      }
      return t;
    });

    writeDb(db);
    if (updatedTask) broadcastTaskUpdated(updatedTask);
    res.json({ success: true, task: updatedTask });
  } catch (error) {
    console.error('Error in updateTask controller:', error);
    res.status(500).json({ success: false, error: 'Task update failed' });
  }
};

export const addFollowup = async (req, res) => {
  try {
    const { id } = req.params;
    const followupData = req.body;
    const followupId = followupData.id || `fol-${Date.now()}`;
    const newFollowup = {
      id: followupId,
      date: followupData.date || new Date().toISOString().slice(0, 10),
      time: followupData.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      authorId: followupData.authorId || 'usr-1',
      authorName: followupData.authorName || 'Team Member',
      authorRole: followupData.authorRole || 'Employee',
      progress: followupData.progress !== undefined ? Number(followupData.progress) : undefined,
      notes: followupData.notes || '',
      actionRequired: followupData.actionRequired || '',
      nextFollowupDate: followupData.nextFollowupDate || '',
      status: followupData.status || 'On Track',
      createdAt: new Date().toISOString()
    };

    if (isConnected()) {
      const rows = await query('SELECT * FROM tasks WHERE id = ?', [id]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Task not found' });
      }
      const currentTask = formatTaskRow(rows[0]);
      const updatedFollowups = [newFollowup, ...(currentTask.followups || [])];
      const newProgress = followupData.progress !== undefined ? Math.max(0, Math.min(100, Number(followupData.progress))) : currentTask.progress;
      
      const activityLog = [
        {
          id: `act-${Date.now()}`,
          timestamp: new Date().toISOString(),
          userId: followupData.authorId || 'usr-1',
          action: `Daily follow-up added by ${followupData.authorName || 'Team Member'}: ${newFollowup.notes.slice(0, 50)}`
        },
        ...(currentTask.activityLog || [])
      ];

      await query(
        'UPDATE tasks SET followups = ?, progress = ?, activity_log = ? WHERE id = ?',
        [JSON.stringify(updatedFollowups), newProgress, JSON.stringify(activityLog), id]
      );

      const updatedRows = await query('SELECT * FROM tasks WHERE id = ?', [id]);
      const updatedTask = formatTaskRow(updatedRows[0]);

      broadcastFollowupAdded(id, newFollowup, newProgress);
      if (updatedTask) {
        broadcastTaskUpdated(updatedTask);
        broadcastNotification({
          id: `notif-${Date.now()}`,
          title: 'Daily Follow-up Logged',
          message: `💬 ${newFollowup.authorName} logged follow-up on "${updatedTask.title}" (${newProgress}%).`,
          type: 'info',
          taskId: id,
          timestamp: new Date().toISOString()
        });
      }

      return res.json({ success: true, task: updatedTask, followup: newFollowup });
    }

    const db = readDb();
    let updatedTask = null;
    db.tasks = (db.tasks || []).map(t => {
      if (t.id === id) {
        const followups = [newFollowup, ...(t.followups || [])];
        const progress = followupData.progress !== undefined ? Number(followupData.progress) : (t.progress || 0);
        updatedTask = { ...t, followups, progress };
        return updatedTask;
      }
      return t;
    });
    writeDb(db);
    broadcastFollowupAdded(id, newFollowup, followupData.progress);
    if (updatedTask) broadcastTaskUpdated(updatedTask);
    res.json({ success: true, task: updatedTask, followup: newFollowup });
  } catch (error) {
    console.error('Error in addFollowup controller:', error);
    res.status(500).json({ success: false, error: 'Adding follow-up failed' });
  }
};

export const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;

    if (isConnected()) {
      await query('DELETE FROM tasks WHERE id = ?', [id]);
      broadcastTaskDeleted(id);
      return res.json({ success: true, message: `Task ${id} deleted from MySQL.` });
    }

    const db = readDb();
    db.tasks = (db.tasks || []).filter(t => t.id !== id);
    writeDb(db);
    broadcastTaskDeleted(id);
    res.json({ success: true, message: `Task ${id} deleted.` });
  } catch (error) {
    console.error('Error in deleteTask controller:', error);
    res.status(500).json({ success: false, error: 'Task deletion failed' });
  }
};
