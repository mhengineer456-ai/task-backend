import { query, isConnected } from '../config/db.js';
import { readDb, writeDb } from '../data/dbStore.js';
import { broadcastLeaveUpdated, broadcastNotification } from '../socket.js';

export const getLeaves = async (req, res) => {
  try {
    if (isConnected()) {
      const rows = await query('SELECT * FROM leaves ORDER BY created_at DESC');
      const formatted = (rows || []).map(l => ({
        ...l,
        employeeId: l.employee_id || l.employeeId,
        userId: l.user_id || l.userId,
        userName: l.user_name || l.userName,
        userRole: l.user_role || l.userRole,
        managerId: l.manager_id || l.managerId,
        managerName: l.manager_name || l.managerName,
        leaveType: l.leave_type || l.leaveType,
        startDate: l.start_date ? new Date(l.start_date).toISOString().slice(0, 10) : l.startDate,
        endDate: l.end_date ? new Date(l.end_date).toISOString().slice(0, 10) : l.endDate,
        totalDays: Number(l.total_days || l.totalDays || 1),
        emergencyContact: l.emergency_contact || l.emergencyContact || '',
        appliedDate: l.applied_date || l.appliedDate,
        managerRemark: l.manager_remark || l.managerRemark || ''
      }));
      return res.json({ success: true, leaves: formatted });
    }

    const db = readDb();
    res.json({ success: true, leaves: db.leaves || [] });
  } catch (error) {
    console.error('Error in getLeaves controller:', error);
    res.status(500).json({ success: false, error: 'Database fetch leaves failed' });
  }
};

export const createLeave = async (req, res) => {
  try {
    const { userId, userName, userRole, department, managerId, managerName, leaveType, startDate, endDate, totalDays, reason, emergencyContact } = req.body;

    if (!userId || !startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'Missing required leave fields (userId, startDate, endDate).' });
    }

    const leaveId = `lev-${Date.now()}`;
    const employeeId = `EMP-${Math.floor(1000 + Math.random() * 9000)}`;

    const newLeave = {
      id: leaveId,
      employeeId,
      userId,
      userName: userName || 'Employee',
      userRole: userRole || 'Employee',
      department: department || 'Engineering',
      managerId: managerId || 'usr-1',
      managerName: managerName || 'Alex Morgan',
      leaveType: leaveType || 'Casual Leave',
      startDate,
      endDate,
      totalDays: Number(totalDays) || 1,
      reason: reason || '',
      emergencyContact: emergencyContact || '',
      status: 'Pending',
      appliedDate: new Date().toISOString(),
      managerRemark: ''
    };

    if (isConnected()) {
      await query(
        `INSERT INTO leaves (id, employee_id, user_id, user_name, user_role, department, manager_id, manager_name, leave_type, start_date, end_date, total_days, reason, emergency_contact, status, applied_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          leaveId,
          employeeId,
          userId,
          newLeave.userName,
          newLeave.userRole,
          newLeave.department,
          newLeave.managerId,
          newLeave.managerName,
          newLeave.leaveType,
          startDate,
          endDate,
          newLeave.totalDays,
          newLeave.reason,
          newLeave.emergencyContact,
          'Pending',
          newLeave.appliedDate
        ]
      );

      broadcastLeaveUpdated(newLeave);
      broadcastNotification({
        id: `notif-${Date.now()}`,
        title: 'New Leave Request',
        message: `📝 ${newLeave.userName} submitted a ${newLeave.leaveType} (${newLeave.startDate} to ${newLeave.endDate}).`,
        type: 'approval',
        timestamp: new Date().toISOString()
      });

      return res.status(201).json({ success: true, leave: newLeave, message: 'Leave application submitted successfully in MySQL.' });
    }

    const db = readDb();
    db.leaves = [newLeave, ...(db.leaves || [])];
    writeDb(db);

    broadcastLeaveUpdated(newLeave);
    broadcastNotification({
      id: `notif-${Date.now()}`,
      title: 'New Leave Request',
      message: `📝 ${newLeave.userName} submitted a ${newLeave.leaveType} (${newLeave.startDate} to ${newLeave.endDate}).`,
      type: 'approval',
      timestamp: new Date().toISOString()
    });

    res.status(201).json({ success: true, leave: newLeave, message: 'Leave application submitted successfully.' });
  } catch (error) {
    console.error('Error in createLeave controller:', error);
    res.status(500).json({ success: false, error: 'Leave application failed' });
  }
};

export const approveLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { remark, managerName } = req.body;
    const managerRemark = remark || `Approved by ${managerName || 'Manager'}`;

    if (isConnected()) {
      await query('UPDATE leaves SET status = ?, manager_remark = ? WHERE id = ?', ['Approved', managerRemark, id]);
      const rows = await query('SELECT * FROM leaves WHERE id = ?', [id]);
      const updated = rows && rows.length > 0 ? {
        ...rows[0],
        employeeId: rows[0].employee_id,
        userId: rows[0].user_id,
        userName: rows[0].user_name,
        userRole: rows[0].user_role,
        managerId: rows[0].manager_id,
        managerName: rows[0].manager_name,
        leaveType: rows[0].leave_type,
        startDate: rows[0].start_date ? new Date(rows[0].start_date).toISOString().slice(0, 10) : '',
        endDate: rows[0].end_date ? new Date(rows[0].end_date).toISOString().slice(0, 10) : '',
        totalDays: Number(rows[0].total_days || 1),
        appliedDate: rows[0].applied_date,
        managerRemark: rows[0].manager_remark
      } : null;

      const finalLeave = updated || targetLeave;
      if (finalLeave) {
        broadcastLeaveUpdated(finalLeave);
        broadcastNotification({
          id: `notif-${Date.now()}`,
          title: 'Leave Approved',
          message: `✅ Your leave request was approved (${finalLeave.leaveType}, ${finalLeave.startDate} - ${finalLeave.endDate}).`,
          type: 'approval',
          timestamp: new Date().toISOString()
        }, finalLeave.userId);
      }

      return res.json({ success: true, leave: finalLeave, message: 'Leave request approved successfully.' });
    }

    const db = readDb();
    let targetLeave = null;
    db.leaves = (db.leaves || []).map(l => {
      if (l.id === id) {
        targetLeave = { ...l, status: 'Approved', managerRemark };
        return targetLeave;
      }
      return l;
    });

    writeDb(db);
    if (targetLeave) {
      broadcastLeaveUpdated(targetLeave);
      broadcastNotification({
        id: `notif-${Date.now()}`,
        title: 'Leave Approved',
        message: `✅ Your leave request was approved (${targetLeave.leaveType}).`,
        type: 'approval',
        timestamp: new Date().toISOString()
      }, targetLeave.userId);
    }
    res.json({ success: true, leave: targetLeave, message: 'Leave request approved successfully.' });
  } catch (error) {
    console.error('Error in approveLeave controller:', error);
    res.status(500).json({ success: false, error: 'Leave approval failed' });
  }
};

export const rejectLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { remark, managerName } = req.body;
    const managerRemark = remark || `Rejected by ${managerName || 'Manager'}`;

    if (isConnected()) {
      await query('UPDATE leaves SET status = ?, manager_remark = ? WHERE id = ?', ['Rejected', managerRemark, id]);
      const rows = await query('SELECT * FROM leaves WHERE id = ?', [id]);
      const updated = rows && rows.length > 0 ? {
        ...rows[0],
        employeeId: rows[0].employee_id,
        userId: rows[0].user_id,
        userName: rows[0].user_name,
        userRole: rows[0].user_role,
        managerId: rows[0].manager_id,
        managerName: rows[0].manager_name,
        leaveType: rows[0].leave_type,
        startDate: rows[0].start_date ? new Date(rows[0].start_date).toISOString().slice(0, 10) : '',
        endDate: rows[0].end_date ? new Date(rows[0].end_date).toISOString().slice(0, 10) : '',
        totalDays: Number(rows[0].total_days || 1),
        appliedDate: rows[0].applied_date,
        managerRemark: rows[0].manager_remark
      } : null;

      const finalLeave = updated;
      if (finalLeave) {
        broadcastLeaveUpdated(finalLeave);
        broadcastNotification({
          id: `notif-${Date.now()}`,
          title: 'Leave Rejected',
          message: `❌ Your leave request was rejected: ${managerRemark}`,
          type: 'approval',
          timestamp: new Date().toISOString()
        }, finalLeave.userId);
      }

      return res.json({ success: true, leave: updated, message: 'Leave request rejected in MySQL.' });
    }

    const db = readDb();
    let targetLeave = null;
    db.leaves = (db.leaves || []).map(l => {
      if (l.id === id) {
        targetLeave = { ...l, status: 'Rejected', managerRemark };
        return targetLeave;
      }
      return l;
    });

    writeDb(db);
    if (targetLeave) {
      broadcastLeaveUpdated(targetLeave);
      broadcastNotification({
        id: `notif-${Date.now()}`,
        title: 'Leave Rejected',
        message: `❌ Your leave request was rejected: ${managerRemark}`,
        type: 'approval',
        timestamp: new Date().toISOString()
      }, targetLeave.userId);
    }
    res.json({ success: true, leave: targetLeave, message: 'Leave request rejected.' });
  } catch (error) {
    console.error('Error in rejectLeave controller:', error);
    res.status(500).json({ success: false, error: 'Leave rejection failed' });
  }
};
