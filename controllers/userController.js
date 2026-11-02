import { query, isConnected } from '../config/db.js';
import { readDb, writeDb } from '../data/dbStore.js';

export const getUsers = async (req, res) => {
  try {
    if (isConnected()) {
      const rows = await query('SELECT * FROM users ORDER BY name ASC');
      const formatted = (rows || []).map(u => ({
        ...u,
        employeeId: u.employee_id || u.employeeId,
        managerId: u.manager_id || u.managerId,
        managerName: u.manager_name || u.managerName,
        managerEmail: u.manager_email || u.managerEmail,
        hireDate: u.hire_date || u.hireDate,
        kpi: typeof u.kpi === 'string' ? JSON.parse(u.kpi || '{}') : (u.kpi || {}),
        kraList: typeof u.kra_list === 'string' ? JSON.parse(u.kra_list || '[]') : (u.kra_list || u.kraList || []),
        performanceReview: typeof u.performance_review === 'string' ? JSON.parse(u.performance_review || '{}') : (u.performance_review || u.performanceReview || {})
      }));
      return res.json({ success: true, users: formatted });
    }

    const db = readDb();
    res.json({ success: true, users: db.users || [] });
  } catch (error) {
    console.error('Error in getUsers controller:', error);
    res.status(500).json({ success: false, error: 'Database fetch users failed' });
  }
};

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (isConnected()) {
      const rows = await query('SELECT * FROM users WHERE id = ?', [id]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      const u = rows[0];
      const user = {
        ...u,
        employeeId: u.employee_id || u.employeeId,
        managerId: u.manager_id || u.managerId,
        managerName: u.manager_name || u.managerName,
        managerEmail: u.manager_email || u.managerEmail,
        hireDate: u.hire_date || u.hireDate,
        kpi: typeof u.kpi === 'string' ? JSON.parse(u.kpi || '{}') : (u.kpi || {}),
        kraList: typeof u.kra_list === 'string' ? JSON.parse(u.kra_list || '[]') : (u.kra_list || u.kraList || []),
        performanceReview: typeof u.performance_review === 'string' ? JSON.parse(u.performance_review || '{}') : (u.performance_review || u.performanceReview || {})
      };
      return res.json({ success: true, user });
    }

    const db = readDb();
    const user = (db.users || []).find(u => u.id === id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    res.json({ success: true, user });
  } catch (error) {
    console.error('Error in getUserById controller:', error);
    res.status(500).json({ success: false, error: 'Database fetch user failed' });
  }
};

export const updateUserProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (isConnected()) {
      if (updates.avatar !== undefined) {
        await query('UPDATE users SET avatar = ? WHERE id = ?', [updates.avatar, id]);
        await query('UPDATE chat_messages SET sender_avatar = ? WHERE sender_id = ?', [updates.avatar, id]).catch(() => {});
      }
      if (updates.name) {
        await query('UPDATE users SET name = ? WHERE id = ?', [updates.name, id]);
      }
      if (updates.kpi) {
        await query('UPDATE users SET kpi = ? WHERE id = ?', [JSON.stringify(updates.kpi), id]);
      }
      if (updates.kraList) {
        await query('UPDATE users SET kra_list = ? WHERE id = ?', [JSON.stringify(updates.kraList), id]);
      }
      if (updates.performanceReview) {
        await query('UPDATE users SET performance_review = ? WHERE id = ?', [JSON.stringify(updates.performanceReview), id]);
      }

      const rows = await query('SELECT * FROM users WHERE id = ?', [id]);
      if (rows && rows.length > 0) {
        const u = rows[0];
        const formattedUser = {
          ...u,
          employeeId: u.employee_id || u.employeeId,
          managerId: u.manager_id || u.managerId,
          managerName: u.manager_name || u.managerName,
          managerEmail: u.manager_email || u.managerEmail,
          hireDate: u.hire_date || u.hireDate,
          kpi: typeof u.kpi === 'string' ? JSON.parse(u.kpi || '{}') : (u.kpi || {}),
          kraList: typeof u.kra_list === 'string' ? JSON.parse(u.kra_list || '[]') : (u.kra_list || u.kraList || []),
          performanceReview: typeof u.performance_review === 'string' ? JSON.parse(u.performance_review || '{}') : (u.performance_review || u.performanceReview || {})
        };
        return res.json({ success: true, message: 'User profile updated in MySQL database', user: formattedUser });
      }

      return res.json({ success: true, message: 'User profile updated in MySQL database' });
    }

    const db = readDb();
    let updatedUser = null;
    db.users = (db.users || []).map(u => {
      if (u.id === id) {
        updatedUser = { ...u, ...updates };
        return updatedUser;
      }
      return u;
    });

    writeDb(db);
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Error in updateUserProfile controller:', error);
    res.status(500).json({ success: false, error: 'User profile update failed' });
  }
};
