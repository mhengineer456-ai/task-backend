import { query, isConnected } from '../config/db.js';
import { readDb, writeDb } from '../data/dbStore.js';

export const getFollowUps = async (req, res) => {
  try {
    if (isConnected()) {
      const rows = await query('SELECT * FROM ea_followups ORDER BY created_at DESC');
      const formatted = (rows || []).map(f => ({
        ...f,
        taskId: f.task_id || f.taskId,
        taskTitle: f.task_title || f.taskTitle,
        assigneeId: f.assignee_id || f.assigneeId,
        assigneeName: f.assignee_name || f.assigneeName,
        actionNotes: f.action_notes || f.actionNotes,
        actionRequired: f.action_required || f.actionRequired,
        nextFollowUpDate: f.next_followup_date ? new Date(f.next_followup_date).toISOString().slice(0, 10) : f.nextFollowUpDate,
        isEscalatedToMd: Boolean(f.is_escalated_to_md),
        loggedBy: f.logged_by || f.loggedBy,
        loggedAt: f.logged_at || f.loggedAt
      }));
      return res.json({ success: true, followUps: formatted });
    }

    const db = readDb();
    res.json({ success: true, followUps: db.eaFollowUps || [] });
  } catch (error) {
    console.error('Error in getFollowUps controller:', error);
    res.status(500).json({ success: false, error: 'Database fetch follow-ups failed' });
  }
};

export const createFollowUp = async (req, res) => {
  try {
    const { taskId, taskTitle, assigneeId, assigneeName, channel, actionNotes, actionRequired, nextFollowUpDate, isEscalatedToMd, status, loggedBy } = req.body;

    if (!taskId || !actionNotes) {
      return res.status(400).json({ success: false, error: 'Task ID and action notes are required.' });
    }

    const id = `fa-${Date.now()}`;
    const newFollowUp = {
      id,
      taskId,
      taskTitle: taskTitle || 'MD Assigned Task',
      assigneeId: assigneeId || 'usr-3',
      assigneeName: assigneeName || 'Employee',
      channel: channel || 'Phone Call',
      actionNotes,
      actionRequired: actionRequired || 'Follow-up response requested.',
      nextFollowUpDate: nextFollowUpDate || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      status: status || (isEscalatedToMd ? 'Escalated to MD' : 'Pending Response'),
      isEscalatedToMd: !!isEscalatedToMd,
      loggedBy: loggedBy || 'Rachel Green (EA)',
      loggedAt: new Date().toISOString()
    };

    if (isConnected()) {
      await query(
        `INSERT INTO ea_followups (id, task_id, task_title, assignee_id, assignee_name, channel, action_notes, action_required, next_followup_date, status, is_escalated_to_md, logged_by, logged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          taskId,
          newFollowUp.taskTitle,
          newFollowUp.assigneeId,
          newFollowUp.assigneeName,
          newFollowUp.channel,
          newFollowUp.actionNotes,
          newFollowUp.actionRequired,
          newFollowUp.nextFollowUpDate,
          newFollowUp.status,
          newFollowUp.isEscalatedToMd ? 1 : 0,
          newFollowUp.loggedBy,
          newFollowUp.loggedAt
        ]
      );
      return res.status(201).json({ success: true, followUp: newFollowUp, message: 'EA Follow-up action logged in MySQL.' });
    }

    const db = readDb();
    db.eaFollowUps = [newFollowUp, ...(db.eaFollowUps || [])];
    writeDb(db);
    res.status(201).json({ success: true, followUp: newFollowUp, message: 'EA Follow-up action logged successfully.' });
  } catch (error) {
    console.error('Error in createFollowUp controller:', error);
    res.status(500).json({ success: false, error: 'EA Follow-up creation failed' });
  }
};

export const updateFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (isConnected()) {
      if (updates.status) {
        await query('UPDATE ea_followups SET status = ? WHERE id = ?', [updates.status, id]);
      }
      return res.json({ success: true, message: 'Follow-up log entry updated in MySQL.' });
    }

    const db = readDb();
    let targetLog = null;
    db.eaFollowUps = (db.eaFollowUps || []).map(item => {
      if (item.id === id) {
        targetLog = { ...item, ...updates, updatedAt: new Date().toISOString() };
        return targetLog;
      }
      return item;
    });

    writeDb(db);
    res.json({ success: true, followUp: targetLog, message: 'Follow-up entry updated.' });
  } catch (error) {
    console.error('Error in updateFollowUp controller:', error);
    res.status(500).json({ success: false, error: 'Follow-up update failed' });
  }
};

// Executive Meetings Methods
export const getMeetings = async (req, res) => {
  try {
    if (isConnected()) {
      const rows = await query('SELECT * FROM ea_meetings ORDER BY created_at DESC');
      const formatted = (rows || []).map(m => ({
        ...m,
        attendees: typeof m.attendees === 'string' ? JSON.parse(m.attendees || '[]') : (m.attendees || []),
        durationMinutes: Number(m.duration_minutes || m.durationMinutes || 45)
      }));
      return res.json({ success: true, meetings: formatted });
    }

    const db = readDb();
    res.json({ success: true, meetings: db.eaMeetings || [] });
  } catch (error) {
    console.error('Error in getMeetings controller:', error);
    res.status(500).json({ success: false, error: 'Database fetch meetings failed' });
  }
};

export const createMeeting = async (req, res) => {
  try {
    const { title, host, attendees, date, time, durationMinutes, location, agenda } = req.body;

    if (!title || !date || !time) {
      return res.status(400).json({ success: false, error: 'Title, date, and time are required for scheduling a meeting.' });
    }

    const id = `mtg-${Date.now()}`;
    const newMeeting = {
      id,
      title,
      host: host || 'Alex Morgan (MD)',
      organizer: 'Rachel Green (EA)',
      attendees: Array.isArray(attendees) ? attendees : [attendees || 'Department Leads'],
      date,
      time,
      durationMinutes: Number(durationMinutes) || 30,
      location: location || 'Executive Boardroom / Zoom',
      agenda: agenda || 'Executive agenda review.',
      status: 'Scheduled',
      createdAt: new Date().toISOString()
    };

    if (isConnected()) {
      await query(
        `INSERT INTO ea_meetings (id, title, host, organizer, attendees, date, time, duration_minutes, location, agenda, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          title,
          newMeeting.host,
          newMeeting.organizer,
          JSON.stringify(newMeeting.attendees),
          date,
          time,
          newMeeting.durationMinutes,
          newMeeting.location,
          newMeeting.agenda,
          'Scheduled'
        ]
      );
      return res.status(201).json({ success: true, meeting: newMeeting, message: 'Executive meeting scheduled in MySQL.' });
    }

    const db = readDb();
    db.eaMeetings = [newMeeting, ...(db.eaMeetings || [])];
    writeDb(db);
    res.status(201).json({ success: true, meeting: newMeeting, message: 'Executive meeting scheduled successfully.' });
  } catch (error) {
    console.error('Error in createMeeting controller:', error);
    res.status(500).json({ success: false, error: 'Executive meeting creation failed' });
  }
};

// EA Daily Routine Tasks Methods
export const getDailyTasks = async (req, res) => {
  try {
    if (isConnected()) {
      const rows = await query('SELECT * FROM ea_daily_tasks ORDER BY time_slot ASC');
      const formatted = (rows || []).map(t => ({
        ...t,
        timeSlot: t.time_slot || t.timeSlot,
        completed: Boolean(t.completed),
        completedAt: t.completed_at || t.completedAt
      }));
      return res.json({ success: true, dailyTasks: formatted });
    }

    const db = readDb();
    res.json({ success: true, dailyTasks: db.eaDailyTasks || [] });
  } catch (error) {
    console.error('Error in getDailyTasks controller:', error);
    res.status(500).json({ success: false, error: 'Database fetch daily tasks failed' });
  }
};

export const toggleDailyTask = async (req, res) => {
  try {
    const { id } = req.params;

    if (isConnected()) {
      const rows = await query('SELECT * FROM ea_daily_tasks WHERE id = ?', [id]);
      if (rows && rows.length > 0) {
        const item = rows[0];
        const isCompleted = !item.completed;
        const completedAt = isCompleted ? new Date().toISOString() : null;
        await query('UPDATE ea_daily_tasks SET completed = ?, completed_at = ? WHERE id = ?', [isCompleted ? 1 : 0, completedAt, id]);
        return res.json({ success: true, task: { ...item, completed: isCompleted, completedAt }, message: 'EA Daily Task toggled in MySQL.' });
      }
    }

    const db = readDb();
    let updatedItem = null;
    db.eaDailyTasks = (db.eaDailyTasks || []).map(item => {
      if (item.id === id) {
        const isCompleted = !item.completed;
        updatedItem = {
          ...item,
          completed: isCompleted,
          completedAt: isCompleted ? new Date().toISOString() : null
        };
        return updatedItem;
      }
      return item;
    });

    writeDb(db);
    res.json({ success: true, task: updatedItem, message: 'EA Daily Task toggled.' });
  } catch (error) {
    console.error('Error in toggleDailyTask controller:', error);
    res.status(500).json({ success: false, error: 'Daily task toggle failed' });
  }
};

export const createDailyTask = async (req, res) => {
  try {
    const { title, timeSlot, notes, category } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'Title is required for daily routine task.' });
    }

    const id = `ead-${Date.now()}`;
    const newTask = {
      id,
      title,
      timeSlot: timeSlot || '09:00 AM',
      category: category || 'Executive Routine',
      completed: false,
      completedAt: null,
      notes: notes || 'Daily working line logged.'
    };

    if (isConnected()) {
      await query(
        `INSERT INTO ea_daily_tasks (id, title, time_slot, category, completed, completed_at, notes)
         VALUES (?, ?, ?, ?, 0, NULL, ?)`,
        [id, newTask.title, newTask.timeSlot, newTask.category, newTask.notes]
      );
      return res.status(201).json({ success: true, dailyTask: newTask, message: 'EA Daily Task created in MySQL.' });
    }

    const db = readDb();
    db.eaDailyTasks = [...(db.eaDailyTasks || []), newTask];
    writeDb(db);
    res.status(201).json({ success: true, dailyTask: newTask });
  } catch (error) {
    console.error('Error in createDailyTask controller:', error);
    res.status(500).json({ success: false, error: 'Create daily task failed' });
  }
};

export const deleteDailyTask = async (req, res) => {
  try {
    const { id } = req.params;
    if (isConnected()) {
      await query('DELETE FROM ea_daily_tasks WHERE id = ?', [id]);
      return res.json({ success: true, message: 'EA Daily task deleted from MySQL.' });
    }

    const db = readDb();
    db.eaDailyTasks = (db.eaDailyTasks || []).filter(t => t.id !== id);
    writeDb(db);
    res.json({ success: true, message: 'EA Daily task deleted.' });
  } catch (error) {
    console.error('Error in deleteDailyTask controller:', error);
    res.status(500).json({ success: false, error: 'Delete daily task failed' });
  }
};

export const deleteMeeting = async (req, res) => {
  try {
    const { id } = req.params;
    if (isConnected()) {
      await query('DELETE FROM ea_meetings WHERE id = ?', [id]);
      return res.json({ success: true, message: 'Executive meeting deleted from MySQL.' });
    }

    const db = readDb();
    db.eaMeetings = (db.eaMeetings || []).filter(m => m.id !== id);
    writeDb(db);
    res.json({ success: true, message: 'Executive meeting deleted.' });
  } catch (error) {
    console.error('Error in deleteMeeting controller:', error);
    res.status(500).json({ success: false, error: 'Delete meeting failed' });
  }
};

