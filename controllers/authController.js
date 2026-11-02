import { query, isConnected } from '../config/db.js';
import { readDb, writeDb } from '../data/dbStore.js';

export const loginUser = async (req, res) => {
  try {
    const { email, password, quickUserId } = req.body;

    if (!email && !quickUserId) {
      return res.status(400).json({ success: false, error: 'Work email is required for login.' });
    }

    if (isConnected()) {
      let rows = [];
      if (quickUserId) {
        rows = await query('SELECT * FROM users WHERE id = ?', [quickUserId]);
      } else if (email) {
        rows = await query('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
      }

      if (!rows || rows.length === 0) {
        return res.status(401).json({ success: false, error: 'Invalid email or password.' });
      }

      const u = rows[0];

      // If user has a password in DB and a password was supplied, check match
      if (u.password && password) {
        if (u.password.trim() !== password.trim()) {
          return res.status(401).json({ success: false, error: 'Invalid password. Please check your credentials.' });
        }
      }

      const user = {
        ...u,
        employeeId: u.employee_id || u.employeeId,
        managerId: u.manager_id || u.managerId,
        managerName: u.manager_name || u.managerName,
        managerEmail: u.manager_email || u.managerEmail,
        hireDate: u.hire_date || u.hireDate,
        kpi: typeof u.kpi === 'string' ? JSON.parse(u.kpi || '{}') : (u.kpi || { onTimeRate: 100, avgResolutionHours: 0, overdueRate: 0, qualityScore: 100, slaCompliance: 100 }),
        kraList: typeof u.kra_list === 'string' ? JSON.parse(u.kra_list || '[]') : (u.kra_list || u.kraList || []),
        performanceReview: typeof u.performance_review === 'string' ? JSON.parse(u.performance_review || '{}') : (u.performance_review || u.performanceReview || {})
      };

      // Strip sensitive password field from client response
      delete user.password;

      return res.json({
        success: true,
        user,
        token: `jwt-mysql-${Date.now()}`
      });
    }

    // Fallback in-memory JSON store
    const db = readDb();
    const users = db.users || [];
    let user = users.find(u => u.email?.toLowerCase() === email?.toLowerCase().trim());
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    if (user.password && password && user.password !== password.trim()) {
      return res.status(401).json({ success: false, error: 'Invalid password. Please check your credentials.' });
    }

    res.json({
      success: true,
      user,
      token: `jwt-simulated-${Date.now()}`
    });
  } catch (error) {
    console.error('Error in loginUser controller:', error);
    res.status(500).json({ success: false, error: 'Database login query failed' });
  }
};

export const registerUser = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      department = 'Engineering & DevOps',
      role = 'Employee',
      managerId = null,
      managerName = null,
      managerEmail = null,
      avatar = null
    } = req.body;

    if (!name?.trim() || !email?.trim()) {
      return res.status(400).json({ success: false, error: 'Full name and work email are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const cleanPassword = password ? password.trim() : null;
    const employeeId = req.body.employeeId || `EMP-${Math.floor(1000 + Math.random() * 9000)}`;
    const id = `usr-${Date.now()}`;
    const hireDate = new Date().toISOString().slice(0, 10);
    const defaultAvatar = avatar || `https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80`;

    const defaultKpi = JSON.stringify({
      onTimeRate: 100,
      avgResolutionHours: 0,
      overdueRate: 0,
      qualityScore: 100,
      slaCompliance: 100
    });
    const defaultKra = JSON.stringify([
      { id: 'kra-1', title: 'Target Execution & Delivery', weight: 50, score: 95, status: 'On Track', description: 'Complete assigned responsibilities promptly.' },
      { id: 'kra-2', title: 'Quality Standards & Collaboration', weight: 50, score: 98, status: 'Exceeding', description: 'Maintain high execution quality.' }
    ]);
    const defaultReview = JSON.stringify({
      rating: 5.0,
      evaluationPeriod: 'Current',
      managerFeedback: 'Active team member'
    });

    if (isConnected()) {
      // 1. Check if user already exists
      const existing = await query('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [cleanEmail]);
      if (existing && existing.length > 0) {
        return res.status(400).json({ success: false, error: 'An account with this email address already exists. Please sign in.' });
      }

      // 2. Insert new user directly as Active without OTP
      await query(
        `INSERT INTO users (id, employee_id, name, email, password, department, role, manager_id, manager_name, manager_email, status, avatar, hire_date, kpi, kra_list, performance_review)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?)`,
        [
          id,
          employeeId,
          cleanName,
          cleanEmail,
          cleanPassword,
          department,
          role,
          managerId || null,
          managerName || (role === 'Manager' || role === 'Admin' ? 'Executive Board' : null),
          managerEmail || null,
          defaultAvatar,
          hireDate,
          defaultKpi,
          defaultKra,
          defaultReview
        ]
      );

      const createdUser = {
        id,
        employeeId,
        name: cleanName,
        email: cleanEmail,
        department,
        role,
        managerId: managerId || null,
        managerName: managerName || (role === 'Manager' || role === 'Admin' ? 'Executive Board' : null),
        managerEmail: managerEmail || null,
        status: 'Active',
        avatar: defaultAvatar,
        hireDate,
        kpi: JSON.parse(defaultKpi),
        kraList: JSON.parse(defaultKra),
        performanceReview: JSON.parse(defaultReview)
      };

      return res.status(201).json({
        success: true,
        user: createdUser,
        token: `jwt-mysql-${Date.now()}`,
        message: 'Account created and activated successfully! You are now signed in.'
      });
    }

    // Fallback store
    const db = readDb();
    if (!db.users) db.users = [];
    if (db.users.find(u => u.email?.toLowerCase() === cleanEmail)) {
      return res.status(400).json({ success: false, error: 'An account with this email address already exists. Please sign in.' });
    }

    const createdUser = {
      id,
      employeeId,
      name: cleanName,
      email: cleanEmail,
      department,
      role,
      managerId: managerId || null,
      managerName: managerName || null,
      status: 'Active',
      avatar: defaultAvatar,
      hireDate,
      kpi: JSON.parse(defaultKpi),
      kraList: JSON.parse(defaultKra),
      performanceReview: JSON.parse(defaultReview)
    };

    db.users.push(createdUser);
    writeDb(db);

    res.status(201).json({
      success: true,
      user: createdUser,
      token: `jwt-simulated-${Date.now()}`,
      message: 'Account created successfully!'
    });
  } catch (error) {
    console.error('Error in registerUser controller:', error);
    res.status(500).json({ success: false, error: 'Database registration failed: ' + error.message });
  }
};

export const resendOtp = async (req, res) => {
  res.json({
    success: true,
    message: 'OTP verification is disabled in this environment. Direct signup and login are active.'
  });
};

export const verifyOtp = async (req, res) => {
  res.json({
    success: true,
    message: 'OTP verification is disabled in this environment. Direct signup and login are active.'
  });
};
