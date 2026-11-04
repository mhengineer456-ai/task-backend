import { query, isConnected } from '../config/db.js';
import { readDb, writeDb } from '../data/dbStore.js';
import { broadcastTaskUpdated, broadcastNotification } from '../socket.js';

// ==========================================
// 1. REMINDERS CONTROLLERS
// ==========================================

export const getReminders = async (req, res) => {
  try {
    const userId = req.query.userId || req.headers['x-user-id'];
    if (isConnected()) {
      let sql = 'SELECT * FROM reminders';
      const params = [];
      if (userId) {
        sql += ' WHERE user_id = ? OR user_id = "all"';
        params.push(userId);
      }
      sql += ' ORDER BY due_date ASC, due_time ASC';
      const rows = await query(sql, params);
      const formatted = (rows || []).map(r => ({
        id: r.id,
        userId: r.user_id,
        userName: r.user_name,
        title: r.title,
        notes: r.notes || '',
        dueDate: r.due_date,
        dueTime: r.due_time || '09:00',
        priority: r.priority || 'Normal',
        status: r.status || 'Pending',
        taskId: r.task_id || null,
        taskTitle: r.task_title || null,
        repeatCycle: r.repeat_cycle || 'none',
        createdAt: r.created_at
      }));
      return res.json({ success: true, reminders: formatted });
    }

    const db = readDb();
    const reminders = (db.reminders || []).filter(r => !userId || r.userId === userId);
    res.json({ success: true, reminders });
  } catch (error) {
    console.error('Error fetching reminders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch reminders' });
  }
};

export const createReminder = async (req, res) => {
  try {
    const { userId, userName, title, notes, dueDate, dueTime, priority, taskId, taskTitle, repeatCycle } = req.body;
    if (!title || !dueDate) {
      return res.status(400).json({ success: false, error: 'Title and due date are required' });
    }

    const reminderId = `rem-${Date.now()}`;
    const newReminder = {
      id: reminderId,
      userId: userId || 'usr-1',
      userName: userName || 'User',
      title: title.trim(),
      notes: notes || '',
      dueDate,
      dueTime: dueTime || '09:00',
      priority: priority || 'Normal',
      status: 'Pending',
      taskId: taskId || null,
      taskTitle: taskTitle || null,
      repeatCycle: repeatCycle || 'none',
      createdAt: new Date().toISOString()
    };

    if (isConnected()) {
      await query(
        `INSERT INTO reminders (id, user_id, user_name, title, notes, due_date, due_time, priority, status, task_id, task_title, repeat_cycle)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newReminder.id,
          newReminder.userId,
          newReminder.userName,
          newReminder.title,
          newReminder.notes,
          newReminder.dueDate,
          newReminder.dueTime,
          newReminder.priority,
          newReminder.status,
          newReminder.taskId,
          newReminder.taskTitle,
          newReminder.repeatCycle
        ]
      );
    } else {
      const db = readDb();
      db.reminders = db.reminders || [];
      db.reminders.push(newReminder);
      writeDb(db);
    }

    // Broadcast in-app notification
    broadcastNotification({
      id: `notif-${Date.now()}`,
      title: '⏰ New Reminder Created',
      message: `${newReminder.title} (Due: ${newReminder.dueDate} at ${newReminder.dueTime})`,
      type: 'info',
      userId: newReminder.userId,
      createdAt: new Date().toISOString()
    });

    res.status(201).json({ success: true, reminder: newReminder });
  } catch (error) {
    console.error('Error creating reminder:', error);
    res.status(500).json({ success: false, error: 'Failed to create reminder' });
  }
};

export const toggleReminderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'Completed' or 'Pending'
    const newStatus = status || 'Completed';

    if (isConnected()) {
      await query('UPDATE reminders SET status = ? WHERE id = ?', [newStatus, id]);
    } else {
      const db = readDb();
      db.reminders = (db.reminders || []).map(r => r.id === id ? { ...r, status: newStatus } : r);
      writeDb(db);
    }

    res.json({ success: true, id, status: newStatus });
  } catch (error) {
    console.error('Error toggling reminder status:', error);
    res.status(500).json({ success: false, error: 'Failed to update reminder' });
  }
};

export const deleteReminder = async (req, res) => {
  try {
    const { id } = req.params;
    if (isConnected()) {
      await query('DELETE FROM reminders WHERE id = ?', [id]);
    } else {
      const db = readDb();
      db.reminders = (db.reminders || []).filter(r => r.id !== id);
      writeDb(db);
    }
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error deleting reminder:', error);
    res.status(500).json({ success: false, error: 'Failed to delete reminder' });
  }
};

// ==========================================
// 2. TIME LOGS CONTROLLERS
// ==========================================

export const getTimeLogs = async (req, res) => {
  try {
    const { userId, taskId } = req.query;
    if (isConnected()) {
      let sql = 'SELECT * FROM time_logs';
      const params = [];
      const conditions = [];

      if (userId) {
        conditions.push('user_id = ?');
        params.push(userId);
      }
      if (taskId) {
        conditions.push('task_id = ?');
        params.push(taskId);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
      sql += ' ORDER BY date DESC, created_at DESC';

      const rows = await query(sql, params);
      const formatted = (rows || []).map(l => ({
        id: l.id,
        userId: l.user_id,
        userName: l.user_name,
        taskId: l.task_id,
        taskTitle: l.task_title,
        durationMinutes: l.duration_minutes,
        hours: Number(l.hours || (l.duration_minutes / 60).toFixed(2)),
        date: l.date ? new Date(l.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        startTime: l.start_time,
        endTime: l.end_time,
        notes: l.notes || '',
        isBillable: Boolean(l.is_billable),
        createdAt: l.created_at
      }));
      return res.json({ success: true, timeLogs: formatted });
    }

    const db = readDb();
    let logs = db.timeLogs || [];
    if (userId) logs = logs.filter(l => l.userId === userId);
    if (taskId) logs = logs.filter(l => l.taskId === taskId);
    res.json({ success: true, timeLogs: logs });
  } catch (error) {
    console.error('Error fetching time logs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch time logs' });
  }
};

export const createTimeLog = async (req, res) => {
  try {
    const { userId, userName, taskId, taskTitle, durationMinutes, hours, date, startTime, endTime, notes, isBillable } = req.body;

    if (!taskId || (!durationMinutes && !hours)) {
      return res.status(400).json({ success: false, error: 'Task and duration/hours are required' });
    }

    const minutes = durationMinutes ? Number(durationMinutes) : Math.round(Number(hours) * 60);
    const calculatedHours = Number(hours) || Number((minutes / 60).toFixed(2));
    const logDate = date || new Date().toISOString().slice(0, 10);
    const logId = `tim-${Date.now()}`;

    const newLog = {
      id: logId,
      userId: userId || 'usr-1',
      userName: userName || 'Team Member',
      taskId,
      taskTitle: taskTitle || 'Task',
      durationMinutes: minutes,
      hours: calculatedHours,
      date: logDate,
      startTime: startTime || null,
      endTime: endTime || null,
      notes: notes || '',
      isBillable: isBillable !== false,
      createdAt: new Date().toISOString()
    };

    if (isConnected()) {
      await query(
        `INSERT INTO time_logs (id, user_id, user_name, task_id, task_title, duration_minutes, hours, date, start_time, end_time, notes, is_billable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newLog.id,
          newLog.userId,
          newLog.userName,
          newLog.taskId,
          newLog.taskTitle,
          newLog.durationMinutes,
          newLog.hours,
          newLog.date,
          newLog.startTime,
          newLog.endTime,
          newLog.notes,
          newLog.isBillable
        ]
      );

      // Increment actual_hours on the target task
      try {
        await query(
          'UPDATE tasks SET actual_hours = COALESCE(actual_hours, 0) + ? WHERE id = ?',
          [calculatedHours, taskId]
        );
        // Fetch updated task to broadcast
        const [updatedRows] = await query('SELECT * FROM tasks WHERE id = ?', [taskId]);
        if (updatedRows) broadcastTaskUpdated(updatedRows);
      } catch (taskUpdateErr) {
        console.warn('Failed to auto-update task actual_hours:', taskUpdateErr.message);
      }
    } else {
      const db = readDb();
      db.timeLogs = db.timeLogs || [];
      db.timeLogs.push(newLog);

      if (db.tasks) {
        const taskIdx = db.tasks.findIndex(t => t.id === taskId);
        if (taskIdx >= 0) {
          db.tasks[taskIdx].actualHours = (Number(db.tasks[taskIdx].actualHours) || 0) + calculatedHours;
        }
      }
      writeDb(db);
    }

    res.status(201).json({ success: true, timeLog: newLog });
  } catch (error) {
    console.error('Error creating time log:', error);
    res.status(500).json({ success: false, error: 'Failed to record time log' });
  }
};

export const deleteTimeLog = async (req, res) => {
  try {
    const { id } = req.params;
    if (isConnected()) {
      await query('DELETE FROM time_logs WHERE id = ?', [id]);
    } else {
      const db = readDb();
      db.timeLogs = (db.timeLogs || []).filter(l => l.id !== id);
      writeDb(db);
    }
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error deleting time log:', error);
    res.status(500).json({ success: false, error: 'Failed to delete time log' });
  }
};

// ==========================================
// 3. DOCUMENTS CONTROLLERS
// ==========================================

export const getDocuments = async (req, res) => {
  try {
    if (isConnected()) {
      const rows = await query('SELECT * FROM documents ORDER BY is_pinned DESC, updated_at DESC');
      const formatted = (rows || []).map(d => ({
        id: d.id,
        userId: d.user_id,
        authorName: d.author_name,
        title: d.title,
        content: d.content || '',
        category: d.category || 'General',
        department: d.department || 'All',
        tags: typeof d.tags === 'string' ? JSON.parse(d.tags || '[]') : (d.tags || []),
        visibility: d.visibility || 'workspace',
        isPinned: Boolean(d.is_pinned),
        createdAt: d.created_at,
        updatedAt: d.updated_at
      }));
      return res.json({ success: true, documents: formatted });
    }

    const db = readDb();
    res.json({ success: true, documents: db.documents || [] });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch documents' });
  }
};

export const createDocument = async (req, res) => {
  try {
    const { userId, authorName, title, content, category, department, tags, visibility, isPinned } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'Document title is required' });
    }

    const docId = `doc-${Date.now()}`;
    const newDoc = {
      id: docId,
      userId: userId || 'usr-1',
      authorName: authorName || 'Admin',
      title: title.trim(),
      content: content || '',
      category: category || 'General',
      department: department || 'All',
      tags: tags || [],
      visibility: visibility || 'workspace',
      isPinned: Boolean(isPinned),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (isConnected()) {
      await query(
        `INSERT INTO documents (id, user_id, author_name, title, content, category, department, tags, visibility, is_pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newDoc.id,
          newDoc.userId,
          newDoc.authorName,
          newDoc.title,
          newDoc.content,
          newDoc.category,
          newDoc.department,
          JSON.stringify(newDoc.tags),
          newDoc.visibility,
          newDoc.isPinned
        ]
      );
    } else {
      const db = readDb();
      db.documents = db.documents || [];
      db.documents.push(newDoc);
      writeDb(db);
    }

    res.status(201).json({ success: true, document: newDoc });
  } catch (error) {
    console.error('Error creating document:', error);
    res.status(500).json({ success: false, error: 'Failed to create document' });
  }
};

export const updateDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category, department, tags, visibility, isPinned } = req.body;

    if (isConnected()) {
      await query(
        `UPDATE documents 
         SET title = COALESCE(?, title),
             content = COALESCE(?, content),
             category = COALESCE(?, category),
             department = COALESCE(?, department),
             tags = COALESCE(?, tags),
             visibility = COALESCE(?, visibility),
             is_pinned = COALESCE(?, is_pinned),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          title,
          content,
          category,
          department,
          tags ? JSON.stringify(tags) : null,
          visibility,
          isPinned !== undefined ? isPinned : null,
          id
        ]
      );
    } else {
      const db = readDb();
      db.documents = (db.documents || []).map(d => d.id === id ? { ...d, ...req.body, updatedAt: new Date().toISOString() } : d);
      writeDb(db);
    }

    res.json({ success: true, id });
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({ success: false, error: 'Failed to update document' });
  }
};

export const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    if (isConnected()) {
      await query('DELETE FROM documents WHERE id = ?', [id]);
    } else {
      const db = readDb();
      db.documents = (db.documents || []).filter(d => d.id !== id);
      writeDb(db);
    }
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ success: false, error: 'Failed to delete document' });
  }
};

// ==========================================
// 4. PERSONAL NOTES CONTROLLERS
// ==========================================

export const getNotes = async (req, res) => {
  try {
    const userId = req.query.userId || req.headers['x-user-id'];
    if (isConnected()) {
      let sql = 'SELECT * FROM notes';
      const params = [];
      if (userId) {
        sql += ' WHERE user_id = ?';
        params.push(userId);
      }
      sql += ' ORDER BY is_pinned DESC, updated_at DESC';

      const rows = await query(sql, params);
      const formatted = (rows || []).map(n => ({
        id: n.id,
        userId: n.user_id,
        title: n.title,
        content: n.content || '',
        color: n.color || '#fef08a',
        checklist: typeof n.checklist === 'string' ? JSON.parse(n.checklist || '[]') : (n.checklist || []),
        isPinned: Boolean(n.is_pinned),
        createdAt: n.created_at,
        updatedAt: n.updated_at
      }));
      return res.json({ success: true, notes: formatted });
    }

    const db = readDb();
    const notes = (db.notes || []).filter(n => !userId || n.userId === userId);
    res.json({ success: true, notes });
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch notes' });
  }
};

export const createNote = async (req, res) => {
  try {
    const { userId, title, content, color, checklist, isPinned } = req.body;
    if (!title && !content) {
      return res.status(400).json({ success: false, error: 'Note title or content is required' });
    }

    const noteId = `not-${Date.now()}`;
    const newNote = {
      id: noteId,
      userId: userId || 'usr-1',
      title: (title || 'Quick Note').trim(),
      content: content || '',
      color: color || '#fef08a',
      checklist: checklist || [],
      isPinned: Boolean(isPinned),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (isConnected()) {
      await query(
        `INSERT INTO notes (id, user_id, title, content, color, checklist, is_pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          newNote.id,
          newNote.userId,
          newNote.title,
          newNote.content,
          newNote.color,
          JSON.stringify(newNote.checklist),
          newNote.isPinned
        ]
      );
    } else {
      const db = readDb();
      db.notes = db.notes || [];
      db.notes.push(newNote);
      writeDb(db);
    }

    res.status(201).json({ success: true, note: newNote });
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ success: false, error: 'Failed to create note' });
  }
};

export const updateNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, color, checklist, isPinned } = req.body;

    if (isConnected()) {
      await query(
        `UPDATE notes 
         SET title = COALESCE(?, title),
             content = COALESCE(?, content),
             color = COALESCE(?, color),
             checklist = COALESCE(?, checklist),
             is_pinned = COALESCE(?, is_pinned),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          title,
          content,
          color,
          checklist ? JSON.stringify(checklist) : null,
          isPinned !== undefined ? isPinned : null,
          id
        ]
      );
    } else {
      const db = readDb();
      db.notes = (db.notes || []).map(n => n.id === id ? { ...n, ...req.body, updatedAt: new Date().toISOString() } : n);
      writeDb(db);
    }

    res.json({ success: true, id });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ success: false, error: 'Failed to update note' });
  }
};

export const deleteNote = async (req, res) => {
  try {
    const { id } = req.params;
    if (isConnected()) {
      await query('DELETE FROM notes WHERE id = ?', [id]);
    } else {
      const db = readDb();
      db.notes = (db.notes || []).filter(n => n.id !== id);
      writeDb(db);
    }
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ success: false, error: 'Failed to delete note' });
  }
};

// ==========================================
// 5. CUSTOM LISTS CONTROLLERS
// ==========================================

export const getCustomLists = async (req, res) => {
  try {
    const userId = req.query.userId || req.headers['x-user-id'];
    if (isConnected()) {
      let sql = 'SELECT * FROM custom_lists';
      const params = [];
      if (userId) {
        sql += ' WHERE user_id = ? OR user_id = "all"';
        params.push(userId);
      }
      sql += ' ORDER BY created_at ASC';

      const rows = await query(sql, params);
      const formatted = (rows || []).map(l => ({
        id: l.id,
        userId: l.user_id,
        name: l.name,
        color: l.color || '#6366f1',
        icon: l.icon || 'list',
        description: l.description || '',
        items: typeof l.items === 'string' ? JSON.parse(l.items || '[]') : (l.items || []),
        createdAt: l.created_at
      }));
      return res.json({ success: true, lists: formatted });
    }

    const db = readDb();
    const lists = (db.customLists || []).filter(l => !userId || l.userId === userId);
    res.json({ success: true, lists });
  } catch (error) {
    console.error('Error fetching custom lists:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch lists' });
  }
};

export const createCustomList = async (req, res) => {
  try {
    const { userId, name, color, icon, description, items } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'List name is required' });
    }

    const listId = `lst-${Date.now()}`;
    const newList = {
      id: listId,
      userId: userId || 'usr-1',
      name: name.trim(),
      color: color || '#6366f1',
      icon: icon || 'list',
      description: description || '',
      items: items || [],
      createdAt: new Date().toISOString()
    };

    if (isConnected()) {
      await query(
        `INSERT INTO custom_lists (id, user_id, name, color, icon, description, items)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          newList.id,
          newList.userId,
          newList.name,
          newList.color,
          newList.icon,
          newList.description,
          JSON.stringify(newList.items)
        ]
      );
    } else {
      const db = readDb();
      db.customLists = db.customLists || [];
      db.customLists.push(newList);
      writeDb(db);
    }

    res.status(201).json({ success: true, list: newList });
  } catch (error) {
    console.error('Error creating custom list:', error);
    res.status(500).json({ success: false, error: 'Failed to create list' });
  }
};

export const updateCustomList = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, icon, description, items } = req.body;

    if (isConnected()) {
      await query(
        `UPDATE custom_lists 
         SET name = COALESCE(?, name),
             color = COALESCE(?, color),
             icon = COALESCE(?, icon),
             description = COALESCE(?, description),
             items = COALESCE(?, items)
         WHERE id = ?`,
        [
          name,
          color,
          icon,
          description,
          items ? JSON.stringify(items) : null,
          id
        ]
      );
    } else {
      const db = readDb();
      db.customLists = (db.customLists || []).map(l => l.id === id ? { ...l, ...req.body } : l);
      writeDb(db);
    }

    res.json({ success: true, id });
  } catch (error) {
    console.error('Error updating custom list:', error);
    res.status(500).json({ success: false, error: 'Failed to update list' });
  }
};

export const deleteCustomList = async (req, res) => {
  try {
    const { id } = req.params;
    if (isConnected()) {
      await query('DELETE FROM custom_lists WHERE id = ?', [id]);
    } else {
      const db = readDb();
      db.customLists = (db.customLists || []).filter(l => l.id !== id);
      writeDb(db);
    }
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error deleting custom list:', error);
    res.status(500).json({ success: false, error: 'Failed to delete list' });
  }
};
