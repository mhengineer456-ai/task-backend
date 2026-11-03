import { query, isConnected } from './db.js';

export const seedUsers = [
  {
    id: 'usr-1',
    employee_id: 'EMP-1001',
    name: 'Alex Morgan',
    email: 'alex.morgan@company.com',
    role: 'Admin',
    department: 'Engineering & DevOps',
    team: 'Core Infrastructure',
    hire_date: '2022-03-15',
    manager_id: null,
    manager_name: 'Executive Board',
    manager_email: 'board@company.com',
    status: 'Active',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    kpi: { onTimeRate: 96, avgResolutionHours: 12.4, overdueRate: 1.8, qualityScore: 98, slaCompliance: 99.2 },
    kra_list: [
      { id: 'kra-1', title: 'System Architecture & High Availability', weight: 35, score: 98, status: 'Exceeding', description: 'Maintain 99.99% uptime across core microservices.' },
      { id: 'kra-2', title: 'Engineering Velocity & Code Review', weight: 30, score: 95, status: 'On Track', description: 'Lead technical reviews and maintain fast turnarounds.' }
    ],
    performance_review: {
      rating: 4.9,
      evaluationPeriod: 'Q3 2026',
      managerFeedback: 'Alex continues to drive exceptional engineering standards.',
      bonusEligible: true
    }
  },
  {
    id: 'usr-ea',
    employee_id: 'EMP-1000',
    name: 'Rachel Green',
    email: 'rachel.green@company.com',
    role: 'EA',
    department: 'Executive Office',
    team: 'MD Operations & EA Unit',
    hire_date: '2022-01-05',
    manager_id: 'usr-1',
    manager_name: 'Alex Morgan',
    manager_email: 'alex.morgan@company.com',
    status: 'Active',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    kpi: { onTimeRate: 98, avgResolutionHours: 4.2, overdueRate: 0.5, qualityScore: 99, slaCompliance: 99.8 },
    kra_list: [
      { id: 'kra-ea-1', title: 'MD Task Follow-Up & SLA Enforcement', weight: 60, score: 99, status: 'Exceeding', description: 'Ensure 100% follow-up accuracy on all MD-assigned deliverables.' }
    ],
    performance_review: {
      rating: 5.0,
      evaluationPeriod: 'Q3 2026',
      managerFeedback: 'Rachel keeps the entire executive pipeline operating seamlessly.'
    }
  },
  {
    id: 'usr-2',
    employee_id: 'EMP-1002',
    name: 'Sarah Jenkins',
    email: 'sarah.jenkins@company.com',
    role: 'Manager',
    department: 'Product Management',
    team: 'Product Ops',
    hire_date: '2023-01-10',
    manager_id: 'usr-1',
    manager_name: 'Alex Morgan',
    manager_email: 'alex.morgan@company.com',
    status: 'Active',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    kpi: { onTimeRate: 92, avgResolutionHours: 18.2, overdueRate: 3.2, qualityScore: 94, slaCompliance: 96.5 },
    kra_list: [
      { id: 'kra-10', title: 'Product Roadmap Execution & Delivery', weight: 40, score: 94, status: 'On Track', description: 'Ensure 90%+ feature deliverable accuracy.' }
    ],
    performance_review: {
      rating: 4.7,
      evaluationPeriod: 'Q3 2026',
      managerFeedback: 'Sarah demonstrates great leadership in managing cross-team roadmaps.'
    }
  },
  {
    id: 'usr-3',
    employee_id: 'EMP-1003',
    name: 'David Chen',
    email: 'david.chen@company.com',
    role: 'Supervisor',
    department: 'UI/UX Design',
    team: 'Design Systems',
    hire_date: '2023-06-01',
    manager_id: 'usr-2',
    manager_name: 'Sarah Jenkins',
    manager_email: 'sarah.jenkins@company.com',
    status: 'Active',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    kpi: { onTimeRate: 88, avgResolutionHours: 21.0, overdueRate: 5.4, qualityScore: 97, slaCompliance: 93.0 },
    kra_list: [
      { id: 'kra-20', title: 'Design System Component Standards', weight: 40, score: 97, status: 'Exceeding', description: 'Maintain WCAG compliant Figma token library.' }
    ],
    performance_review: {
      rating: 4.5,
      evaluationPeriod: 'Q3 2026',
      managerFeedback: 'David created an extraordinary glassmorphic design system.'
    }
  },
  {
    id: 'usr-4',
    employee_id: 'EMP-1004',
    name: 'Elena Rostova',
    email: 'elena.rostova@company.com',
    role: 'Manager',
    department: 'Operations & HR',
    team: 'Talent & Workplace',
    hire_date: '2022-09-15',
    manager_id: 'usr-1',
    manager_name: 'Alex Morgan',
    manager_email: 'alex.morgan@company.com',
    status: 'Active',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    kpi: { onTimeRate: 98, avgResolutionHours: 10.5, overdueRate: 0.0, qualityScore: 99, slaCompliance: 100.0 },
    kra_list: [
      { id: 'kra-30', title: 'Employee Onboarding & Retention', weight: 40, score: 99, status: 'Exceeding', description: 'Maintain 95%+ onboarding satisfaction.' }
    ],
    performance_review: {
      rating: 4.95,
      evaluationPeriod: 'Q3 2026',
      managerFeedback: 'Elena executed the annual review flawlessly with 100% participation.'
    }
  },
  {
    id: 'usr-5',
    employee_id: 'EMP-1005',
    name: 'Marcus Vance',
    email: 'marcus.vance@company.com',
    role: 'Employee',
    department: 'Marketing & Growth',
    team: 'Digital Marketing',
    hire_date: '2023-08-20',
    manager_id: 'usr-2',
    manager_name: 'Sarah Jenkins',
    manager_email: 'sarah.jenkins@company.com',
    status: 'Active',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    kpi: { onTimeRate: 90, avgResolutionHours: 19.5, overdueRate: 4.0, qualityScore: 91, slaCompliance: 92.5 },
    kra_list: [
      { id: 'kra-40', title: 'Growth Campaigns & Funnel Conversion', weight: 50, score: 92, status: 'On Track', description: 'Increase organic lead generation velocity.' }
    ],
    performance_review: {
      rating: 4.2,
      evaluationPeriod: 'Q3 2026',
      managerFeedback: 'Marcus shows high energy and creativity in growth campaigns.'
    }
  },
  {
    id: 'usr-6',
    employee_id: 'EMP-1006',
    name: 'Sophia Patel',
    email: 'sophia.patel@company.com',
    role: 'Supervisor',
    department: 'Finance & Compliance',
    team: 'Audit & Governance',
    hire_date: '2022-11-10',
    manager_id: 'usr-1',
    manager_name: 'Alex Morgan',
    manager_email: 'alex.morgan@company.com',
    status: 'Active',
    avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    kpi: { onTimeRate: 95, avgResolutionHours: 14.0, overdueRate: 2.0, qualityScore: 98, slaCompliance: 98.5 },
    kra_list: [
      { id: 'kra-50', title: 'SOC2 Type II Audit Artifact Assembly', weight: 50, score: 98, status: 'Exceeding', description: 'Compile all control evidence binders.' }
    ],
    performance_review: {
      rating: 4.85,
      evaluationPeriod: 'Q3 2026',
      managerFeedback: 'Sophia has done an outstanding job preparing the SOC2 Type II audit binder.'
    }
  },
  {
    id: 'usr-7',
    employee_id: 'EMP-1007',
    name: 'Liam O\'Connor',
    email: 'liam.oconnor@company.com',
    role: 'Employee',
    department: 'Engineering & DevOps',
    team: 'Frontend Web',
    hire_date: '2024-05-15',
    manager_id: 'usr-1',
    manager_name: 'Alex Morgan',
    manager_email: 'alex.morgan@company.com',
    status: 'Active',
    avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
    kpi: { onTimeRate: 91, avgResolutionHours: 16.5, overdueRate: 2.5, qualityScore: 95, slaCompliance: 96.0 },
    kra_list: [
      { id: 'kra-60', title: 'Frontend Component Development', weight: 45, score: 95, status: 'On Track', description: 'Build responsive React components.' }
    ],
    performance_review: {
      rating: 4.6,
      evaluationPeriod: 'Q3 2026',
      managerFeedback: 'Liam shows great technical growth and enthusiasm.'
    }
  }
];

export const seedTasks = [
  {
    id: 'TSK-1001',
    title: 'Migrate Core Authentication Service to OAuth 2.1 & OIDC',
    description: 'Upgrade authentication server to support Proof Key for Code Exchange (PKCE) and deprecate legacy session token endpoints across all microservices.',
    category: 'Software Development',
    department: 'Engineering & DevOps',
    project: 'Enterprise Security Hardening',
    assignee_id: 'usr-1',
    co_assignees: ['usr-7'],
    creator_id: 'usr-2',
    approval_owner_id: 'usr-2',
    backup_person_id: 'usr-7',
    watchers: ['usr-2', 'usr-6'],
    priority: 'High',
    status: 'In Progress',
    start_date: '2026-09-20T09:00',
    due_date: '2026-10-15T17:00',
    estimated_hours: 32,
    actual_hours: 18.5,
    delay_reason: '',
    recurring: { isRecurring: false, frequency: 'None' },
    tags: ['Auth', 'OAuth', 'Security', 'Backend'],
    custom_fields: { 'Billing Code': 'ENG-2026-09', 'Risk Level': 'High', 'Environment': 'Staging' },
    checklist: [
      { id: 'ck-1', text: 'Draft OIDC discovery specification', completed: true },
      { id: 'ck-2', text: 'Implement PKCE challenge generator', completed: true },
      { id: 'ck-3', text: 'Update frontend React auth provider', completed: true },
      { id: 'ck-4', text: 'Load test token exchange endpoint (10k rps)', completed: false },
      { id: 'ck-5', text: 'Obtain SOC2 supervisor signoff', completed: false }
    ],
    dependencies: [],
    attachments: [
      { id: 'att-1', name: 'OIDC_Architecture_v2.pdf', size: '2.4 MB', type: 'pdf', url: '#' }
    ],
    remarks: '',
    comments: [
      {
        id: 'cmt-1',
        userId: 'usr-1',
        userName: 'Alex Morgan',
        userAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        text: 'PKCE challenge flow is implemented. Starting load testing now.',
        timestamp: '2026-09-22T14:30:00Z',
        isInternal: false
      }
    ],
    activity_log: [
      { id: 'act-1', timestamp: '2026-09-20T09:00:00Z', userId: 'usr-2', action: 'Task created' },
      { id: 'act-2', timestamp: '2026-09-20T10:00:00Z', userId: 'usr-1', action: 'Status changed to In Progress' }
    ]
  },
  {
    id: 'TSK-1002',
    title: 'Enterprise Analytics Dashboard Design Tokens & Dark Theme',
    description: 'Design responsive multi-tenant analytics dashboard with dark theme contrast specs, customizable KPI widgets, and executive summary export cards.',
    category: 'UI/UX Redesign',
    department: 'UI/UX Design',
    project: 'Design System 3.0',
    assignee_id: 'usr-3',
    co_assignees: [],
    creator_id: 'usr-2',
    approval_owner_id: 'usr-2',
    backup_person_id: 'usr-1',
    watchers: ['usr-2', 'usr-5'],
    priority: 'Normal',
    status: 'In Progress',
    start_date: '2026-09-18T09:00',
    due_date: '2026-10-18T18:00',
    estimated_hours: 24,
    actual_hours: 20,
    delay_reason: '',
    recurring: { isRecurring: false, frequency: 'None' },
    tags: ['Design', 'Figma', 'UI/UX', 'Charts'],
    custom_fields: { 'Billing Code': 'DES-2026-03', 'Risk Level': 'Medium', 'Environment': 'Design Workspace' },
    checklist: [
      { id: 'ck-10', text: 'Create high-fidelity Figma mockups', completed: true },
      { id: 'ck-11', text: 'Validate WCAG 2.1 AA accessibility contrast', completed: true },
      { id: 'ck-12', text: 'Export SVG icon pack & design tokens', completed: true },
      { id: 'ck-13', text: 'Handoff component specs to React frontend team', completed: false }
    ],
    dependencies: [],
    attachments: [
      { id: 'att-3', name: 'Dashboard_Design_v3.fig', size: '14.2 MB', type: 'figma', url: '#' }
    ],
    remarks: 'High priority item for CEO demonstration.',
    comments: [
      {
        id: 'cmt-3',
        userId: 'usr-3',
        userName: 'David Chen',
        userAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
        text: 'Finalized dark glass theme palettes. Ready for review.',
        timestamp: '2026-09-22T16:00:00Z',
        isInternal: false
      }
    ],
    activity_log: [
      { id: 'act-10', timestamp: '2026-09-18T09:00:00Z', userId: 'usr-2', action: 'Task created' },
      { id: 'act-11', timestamp: '2026-09-18T10:00:00Z', userId: 'usr-3', action: 'Status changed to In Progress' }
    ]
  },
  {
    id: 'TSK-1003',
    title: 'SOC2 Type II Annual Compliance Audit Documentation',
    description: 'Gather audit artifacts for IT general controls, encryption key rotations, disaster recovery drills, and employee security training records.',
    category: 'Compliance & Governance',
    department: 'Finance & Compliance',
    project: 'Q3 Compliance Gate',
    assignee_id: 'usr-6',
    co_assignees: ['usr-4'],
    creator_id: 'usr-1',
    approval_owner_id: 'usr-1',
    backup_person_id: 'usr-4',
    watchers: ['usr-1', 'usr-2', 'usr-6'],
    priority: 'Urgent',
    status: 'Review',
    start_date: '2026-09-15T09:00',
    due_date: '2026-10-20T17:00',
    estimated_hours: 40,
    actual_hours: 42,
    delay_reason: 'Awaiting penetration testing signoff',
    recurring: { isRecurring: true, frequency: 'Quarterly' },
    tags: ['SOC2', 'Audit', 'Legal', 'Governance'],
    custom_fields: { 'Billing Code': 'FIN-SOC2-26', 'Risk Level': 'Critical', 'Environment': 'Production Audit' },
    checklist: [
      { id: 'ck-20', text: 'Collect AWS CloudTrail log exports', completed: true },
      { id: 'ck-21', text: 'Verify multi-factor authentication enforcement', completed: true },
      { id: 'ck-22', text: 'Compile annual penetration test report', completed: true },
      { id: 'ck-23', text: 'Submit package to external auditor', completed: true }
    ],
    dependencies: ['TSK-1001'],
    attachments: [
      { id: 'att-4', name: 'SOC2_Evidence_Binder_Q3.pdf', size: '18.5 MB', type: 'pdf', url: '#' }
    ],
    remarks: 'Pending final supervisor approval before external submission.',
    comments: [
      {
        id: 'cmt-4',
        userId: 'usr-6',
        userName: 'Sophia Patel',
        userAvatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
        text: 'Submitted package to Review queue. @Alex Morgan please review the encryption attestation.',
        timestamp: '2026-09-22T18:30:00Z',
        isInternal: false
      }
    ],
    activity_log: [
      { id: 'act-20', timestamp: '2026-09-15T09:00:00Z', userId: 'usr-1', action: 'Task created' },
      { id: 'act-21', timestamp: '2026-09-22T18:30:00Z', userId: 'usr-6', action: 'Moved status to Review' }
    ]
  },
  {
    id: 'TSK-1004',
    title: 'Automate Kubernetes Cluster Multi-Zone Failover Testing',
    description: 'Configure chaos engineering experiment to simulate AZ loss in eu-central-1 and observe ingress controller route reassignment latency.',
    category: 'Infrastructure & DevOps',
    department: 'Engineering & DevOps',
    project: 'High Availability 99.99%',
    assignee_id: 'usr-7',
    co_assignees: ['usr-1'],
    creator_id: 'usr-1',
    approval_owner_id: 'usr-1',
    backup_person_id: 'usr-1',
    watchers: ['usr-1'],
    priority: 'High',
    status: 'Assigned',
    start_date: '2026-10-01T09:00',
    due_date: '2026-10-25T18:00',
    estimated_hours: 16,
    actual_hours: 2,
    delay_reason: '',
    recurring: { isRecurring: false, frequency: 'None' },
    tags: ['DevOps', 'Kubernetes', 'K8s', 'Failover'],
    custom_fields: { 'Billing Code': 'ENG-2026-10', 'Risk Level': 'High', 'Environment': 'Staging Cluster' },
    checklist: [
      { id: 'ck-30', text: 'Write Chaos Mesh test scenario', completed: true },
      { id: 'ck-31', text: 'Execute in staging cluster during low traffic window', completed: false }
    ],
    dependencies: [],
    attachments: [],
    remarks: '',
    comments: [],
    activity_log: [
      { id: 'act-30', timestamp: '2026-10-01T09:00:00Z', userId: 'usr-1', action: 'Task created' }
    ]
  }
];

export const seedLeaves = [
  {
    id: 'lev-1',
    employee_id: 'EMP-1003',
    user_id: 'usr-3',
    user_name: 'David Chen',
    user_role: 'Supervisor',
    department: 'UI/UX Design',
    manager_id: 'usr-2',
    manager_name: 'Sarah Jenkins',
    leave_type: 'Casual Leave',
    start_date: '2026-10-20',
    end_date: '2026-10-22',
    total_days: 3,
    reason: 'Attending family wedding ceremony.',
    emergency_contact: '+1 555-0192',
    status: 'Pending',
    applied_date: '2026-10-10T14:30:00.000Z',
    manager_remark: ''
  },
  {
    id: 'lev-2',
    employee_id: 'EMP-1002',
    user_id: 'usr-2',
    user_name: 'Sarah Jenkins',
    user_role: 'Manager',
    department: 'Product Management',
    manager_id: 'usr-1',
    manager_name: 'Alex Morgan',
    leave_type: 'Earned Leave',
    start_date: '2026-11-05',
    end_date: '2026-11-09',
    total_days: 4,
    reason: 'Annual family holiday.',
    emergency_contact: '+1 555-0188',
    status: 'Approved',
    applied_date: '2026-10-01T09:15:00.000Z',
    manager_remark: 'Approved. Deliverables handed over to David.'
  }
];

export const seedEaFollowUps = [
  {
    id: 'fa-1',
    task_id: 'TSK-1001',
    task_title: 'Migrate Core Authentication Service to OAuth 2.1 & OIDC',
    assignee_id: 'usr-1',
    assignee_name: 'Alex Morgan',
    channel: 'Direct Check-in',
    action_notes: 'Spoke with Alex regarding PKCE load testing completion timeline.',
    action_required: 'Finalize benchmark report by 5 PM today.',
    next_followup_date: '2026-10-15',
    status: 'In Progress',
    is_escalated_to_md: 0,
    logged_by: 'Rachel Green (EA)',
    logged_at: '2026-10-12T10:30:00.000Z'
  },
  {
    id: 'fa-2',
    task_id: 'TSK-1003',
    task_title: 'SOC2 Type II Annual Compliance Audit Documentation',
    assignee_id: 'usr-6',
    assignee_name: 'Sophia Patel',
    channel: 'Executive Call',
    action_notes: 'Reviewed external auditor timeline. Penetration testing vendor signoff needed.',
    action_required: 'Submit final binder to Alex for signature.',
    next_followup_date: '2026-10-14',
    status: 'In Progress',
    is_escalated_to_md: 0,
    logged_by: 'Rachel Green (EA)',
    logged_at: '2026-10-11T16:00:00.000Z'
  }
];

export const seedEaMeetings = [
  {
    id: 'mtg-1',
    title: 'Q4 Strategic Engineering Roadmap Sync',
    host: 'Alex Morgan (MD)',
    organizer: 'Rachel Green (EA)',
    attendees: ['Sarah Jenkins (Manager)', 'David Chen (Lead)'],
    date: '2026-10-15',
    time: '10:30 AM',
    duration_minutes: 45,
    location: 'Executive Boardroom A / Zoom',
    agenda: 'Review Q4 cloud architecture migration deliverables and headcount allocation.',
    status: 'Scheduled'
  },
  {
    id: 'mtg-2',
    title: 'Monthly KPI & SLA Compliance Review',
    host: 'Alex Morgan (MD)',
    organizer: 'Rachel Green (EA)',
    attendees: ['All Department Leads'],
    date: '2026-10-18',
    time: '02:00 PM',
    duration_minutes: 60,
    location: 'Main Conference Hall',
    agenda: 'Evaluate Q3 SLA compliance targets and recognize top KPI performers.',
    status: 'Scheduled'
  }
];

export const seedEaDailyTasks = [
  {
    id: 'ead-1',
    title: 'Morning Calendar & Executive Agenda Audit for MD',
    time_slot: '09:00 AM',
    category: 'Executive Admin',
    completed: 1,
    completed_at: '2026-10-12T09:12:00.000Z',
    notes: 'Audited 3 scheduled board syncs. Verified boardroom link.'
  },
  {
    id: 'ead-2',
    title: 'Inspect Overdue Deliverables Queue & Issue Follow-Up Pings',
    time_slot: '11:00 AM',
    category: 'Task SLA Tracking',
    completed: 0,
    completed_at: null,
    notes: '2 tasks nearing SLA due window in Engineering and Design.'
  },
  {
    id: 'ead-3',
    title: 'Review Executive Briefs & Meeting Summaries for MD',
    time_slot: '04:30 PM',
    category: 'Reporting & Briefs',
    completed: 0,
    completed_at: null,
    notes: 'Prepare executive summary of Q4 vendor agreements.'
  }
];

export const seedChatChannels = [
  {
    id: 'chan-ai',
    name: '🤖 PulseBot AI Assistant',
    type: 'ai',
    participant_ids: [],
    is_private: 0
  },
  {
    id: 'chan-md-mgr',
    name: '👑 MD & Managers Leadership',
    type: 'group',
    participant_ids: ['usr-1', 'usr-2', 'usr-4', 'usr-ea'],
    is_private: 1
  },
  {
    id: 'chan-general',
    name: '💬 All-Hands General',
    type: 'general',
    participant_ids: [],
    is_private: 0
  }
];

export const seedChatMessages = [
  {
    id: 'msg-1',
    channel_id: 'chan-ai',
    sender_id: 'chan-ai',
    sender_name: 'PulseBot AI',
    sender_role: 'AI Assistant',
    sender_avatar: '🤖',
    text: 'Hello! I am PulseBot AI. I can assist you with your tasks, deadlines, team capacity, and SLA tracking.',
    task_attachment: null,
    is_ai: 1
  },
  {
    id: 'msg-2',
    channel_id: 'chan-general',
    sender_id: 'usr-1',
    sender_name: 'Alex Morgan',
    sender_role: 'Admin',
    sender_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    text: 'Welcome team! TaskPulse Enterprise MySQL backend is now live.',
    task_attachment: null,
    is_ai: 0
  }
];

export async function seedDatabase() {
  if (!isConnected()) {
    console.warn('⚠️ [Seed] MySQL not connected. Skipping seed.');
    return;
  }

  try {
    // 1. Seed Users (Upsert)
    for (const u of seedUsers) {
      await query(
        `INSERT INTO users (id, employee_id, name, email, department, team, role, manager_id, manager_name, manager_email, status, avatar, hire_date, kpi, kra_list, performance_review)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           department = VALUES(department),
           team = VALUES(team),
           role = VALUES(role),
           manager_id = VALUES(manager_id),
           manager_name = VALUES(manager_name),
           status = VALUES(status),
           avatar = VALUES(avatar),
           kpi = VALUES(kpi),
           kra_list = VALUES(kra_list),
           performance_review = VALUES(performance_review)`,
        [
          u.id,
          u.employee_id,
          u.name,
          u.email,
          u.department,
          u.team,
          u.role,
          u.manager_id,
          u.manager_name,
          u.manager_email,
          u.status,
          u.avatar,
          u.hire_date,
          JSON.stringify(u.kpi || {}),
          JSON.stringify(u.kra_list || []),
          JSON.stringify(u.performance_review || {})
        ]
      );
    }
    console.log(`✅ [Seed] Seeded ${seedUsers.length} users in MySQL.`);

    // 2. Check Tasks - Seed if empty
    const [taskCount] = await query('SELECT COUNT(*) as count FROM tasks');
    if (taskCount.count === 0) {
      for (const t of seedTasks) {
        await query(
          `INSERT INTO tasks (id, title, description, category, department, project, assignee_id, co_assignees, creator_id, approval_owner_id, backup_person_id, watchers, priority, status, start_date, due_date, estimated_hours, actual_hours, delay_reason, recurring, tags, custom_fields, checklist, dependencies, attachments, remarks, comments, activity_log)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            t.id,
            t.title,
            t.description,
            t.category,
            t.department,
            t.project,
            t.assignee_id,
            JSON.stringify(t.co_assignees || []),
            t.creator_id,
            t.approval_owner_id,
            t.backup_person_id,
            JSON.stringify(t.watchers || []),
            t.priority,
            t.status,
            t.start_date,
            t.due_date,
            t.estimated_hours,
            t.actual_hours,
            t.delay_reason,
            JSON.stringify(t.recurring || {}),
            JSON.stringify(t.tags || []),
            JSON.stringify(t.custom_fields || {}),
            JSON.stringify(t.checklist || []),
            JSON.stringify(t.dependencies || []),
            JSON.stringify(t.attachments || []),
            t.remarks,
            JSON.stringify(t.comments || []),
            JSON.stringify(t.activity_log || [])
          ]
        );
      }
      console.log(`✅ [Seed] Seeded ${seedTasks.length} tasks in MySQL.`);
    }

    // 3. Check Leaves - Seed if empty
    const [leaveCount] = await query('SELECT COUNT(*) as count FROM leaves');
    if (leaveCount.count === 0) {
      for (const l of seedLeaves) {
        await query(
          `INSERT INTO leaves (id, employee_id, user_id, user_name, user_role, department, manager_id, manager_name, leave_type, start_date, end_date, total_days, reason, emergency_contact, status, applied_date, manager_remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            l.id,
            l.employee_id,
            l.user_id,
            l.user_name,
            l.user_role,
            l.department,
            l.manager_id,
            l.manager_name,
            l.leave_type,
            l.start_date,
            l.end_date,
            l.total_days,
            l.reason,
            l.emergency_contact,
            l.status,
            l.applied_date,
            l.manager_remark
          ]
        );
      }
      console.log(`✅ [Seed] Seeded ${seedLeaves.length} leaves in MySQL.`);
    }

    // 4. Check EA Follow-Ups - Seed if empty
    const [eaCount] = await query('SELECT COUNT(*) as count FROM ea_followups');
    if (eaCount.count === 0) {
      for (const f of seedEaFollowUps) {
        await query(
          `INSERT INTO ea_followups (id, task_id, task_title, assignee_id, assignee_name, channel, action_notes, action_required, next_followup_date, status, is_escalated_to_md, logged_by, logged_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            f.id,
            f.task_id,
            f.task_title,
            f.assignee_id,
            f.assignee_name,
            f.channel,
            f.action_notes,
            f.action_required,
            f.next_followup_date,
            f.status,
            f.is_escalated_to_md,
            f.logged_by,
            f.logged_at
          ]
        );
      }
      console.log(`✅ [Seed] Seeded ${seedEaFollowUps.length} EA follow-ups in MySQL.`);
    }

    // 5. Check EA Meetings - Seed if empty
    const [mtgCount] = await query('SELECT COUNT(*) as count FROM ea_meetings');
    if (mtgCount.count === 0) {
      for (const m of seedEaMeetings) {
        await query(
          `INSERT INTO ea_meetings (id, title, host, organizer, attendees, date, time, duration_minutes, location, agenda, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.id,
            m.title,
            m.host,
            m.organizer,
            JSON.stringify(m.attendees || []),
            m.date,
            m.time,
            m.duration_minutes,
            m.location,
            m.agenda,
            m.status
          ]
        );
      }
      console.log(`✅ [Seed] Seeded ${seedEaMeetings.length} EA meetings in MySQL.`);
    }

    // 6. Check EA Daily Tasks - Seed if empty
    const [dailyCount] = await query('SELECT COUNT(*) as count FROM ea_daily_tasks');
    if (dailyCount.count === 0) {
      for (const d of seedEaDailyTasks) {
        await query(
          `INSERT INTO ea_daily_tasks (id, title, time_slot, category, completed, completed_at, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            d.id,
            d.title,
            d.time_slot,
            d.category,
            d.completed,
            d.completed_at,
            d.notes
          ]
        );
      }
      console.log(`✅ [Seed] Seeded ${seedEaDailyTasks.length} EA daily tasks in MySQL.`);
    }

    // 7. Check Chat Channels - Seed if empty
    const [chanCount] = await query('SELECT COUNT(*) as count FROM chat_channels');
    if (chanCount.count === 0) {
      for (const c of seedChatChannels) {
        await query(
          `INSERT INTO chat_channels (id, name, type, participant_ids, is_private)
           VALUES (?, ?, ?, ?, ?)`,
          [
            c.id,
            c.name,
            c.type,
            JSON.stringify(c.participant_ids || []),
            c.is_private
          ]
        );
      }
      console.log(`✅ [Seed] Seeded ${seedChatChannels.length} chat channels in MySQL.`);
    }

    // 8. Check Chat Messages - Seed if empty
    const [msgCount] = await query('SELECT COUNT(*) as count FROM chat_messages');
    if (msgCount.count === 0) {
      for (const m of seedChatMessages) {
        await query(
          `INSERT INTO chat_messages (id, channel_id, sender_id, sender_name, sender_role, sender_avatar, text, task_attachment, is_ai)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.id,
            m.channel_id,
            m.sender_id,
            m.sender_name,
            m.sender_role,
            m.sender_avatar,
            m.text,
            m.task_attachment ? JSON.stringify(m.task_attachment) : null,
            m.is_ai
          ]
        );
      }
      console.log(`✅ [Seed] Seeded ${seedChatMessages.length} chat messages in MySQL.`);
    }

    // 9. Check User Statuses - Seed if empty
    try {
      const [statusCount] = await query('SELECT COUNT(*) as count FROM user_statuses');
      if (statusCount && statusCount.count === 0) {
        const sampleStatuses = [
          {
            id: 'stat-sample-sarah',
            user_id: 'usr-2',
            user_name: 'Sarah Jenkins',
            user_avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
            type: 'text',
            content: '🚀 Sprint 42 deployed cleanly across all cloud regions! Great work everyone.',
            media_url: null,
            background_color: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)',
            text_color: '#FFFFFF',
            font_style: 'sans',
            privacy_type: 'contacts',
            privacy_users: '[]',
            created_at: new Date(Date.now() - 3600000 * 2).toISOString().slice(0, 19).replace('T', ' '),
            expires_at: new Date(Date.now() + 3600000 * 22).toISOString().slice(0, 19).replace('T', ' ')
          },
          {
            id: 'stat-sample-david',
            user_id: 'usr-3',
            user_name: 'David Chen',
            user_avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
            type: 'text',
            content: '🎨 New Apple-inspired design system tokens and glassmorphic card layouts are live!',
            media_url: null,
            background_color: 'linear-gradient(135deg, #34C759 0%, #30B0C7 100%)',
            text_color: '#FFFFFF',
            font_style: 'handwriting',
            privacy_type: 'contacts',
            privacy_users: '[]',
            created_at: new Date(Date.now() - 3600000 * 5).toISOString().slice(0, 19).replace('T', ' '),
            expires_at: new Date(Date.now() + 3600000 * 19).toISOString().slice(0, 19).replace('T', ' ')
          }
        ];

        for (const s of sampleStatuses) {
          await query(
            `INSERT INTO user_statuses (
              id, user_id, user_name, user_avatar, type, content, 
              media_url, background_color, text_color, font_style, 
              privacy_type, privacy_users, created_at, expires_at, is_deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [
              s.id, s.user_id, s.user_name, s.user_avatar, s.type, s.content,
              s.media_url, s.background_color, s.text_color, s.font_style,
              s.privacy_type, s.privacy_users, s.created_at, s.expires_at
            ]
          );
        }
        console.log(`✅ [Seed] Seeded ${sampleStatuses.length} initial sample statuses in MySQL.`);
      }
    } catch (statusErr) {
      console.warn('Notice: user_statuses seeding notice:', statusErr.message);
    }
  } catch (err) {
    console.error('❌ [Seed] Error while seeding MySQL database:', err);
  }
}
