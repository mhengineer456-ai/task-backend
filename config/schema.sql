-- ====================================================================
-- TaskPulse Pro Enterprise Module - Optimized MySQL Database Schema
-- High-Performance Normalized Relational Architecture for Massive Scale
-- ====================================================================

CREATE DATABASE IF NOT EXISTS taskpulse_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE taskpulse_db;

-- 1. USERS TABLE (Indexed by role, department, manager_id, status)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  email VARCHAR(128) NOT NULL UNIQUE,
  password VARCHAR(255),
  department VARCHAR(128) NOT NULL,
  team VARCHAR(128),
  role VARCHAR(64) NOT NULL,
  manager_id VARCHAR(64),
  manager_name VARCHAR(128),
  manager_email VARCHAR(128),
  status VARCHAR(32) DEFAULT 'Active',
  avatar TEXT,
  hire_date DATE,
  kpi JSON,
  kra_list JSON,
  performance_review JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_role (role),
  INDEX idx_users_dept (department),
  INDEX idx_users_manager (manager_id),
  INDEX idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2. TASKS TABLE (High-performance B-Tree compound indexes)
CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(128) DEFAULT 'Software Development',
  department VARCHAR(128),
  project VARCHAR(128) DEFAULT 'General Project',
  assignee_id VARCHAR(64),
  co_assignees JSON,
  creator_id VARCHAR(64),
  approval_owner_id VARCHAR(64),
  backup_person_id VARCHAR(64),
  watchers JSON,
  priority VARCHAR(32) DEFAULT 'Normal',
  status VARCHAR(32) DEFAULT 'Assigned',
  start_date VARCHAR(64),
  due_date VARCHAR(64),
  estimated_hours DECIMAL(6,2) DEFAULT 8.00,
  actual_hours DECIMAL(6,2) DEFAULT 0.00,
  delay_reason TEXT,
  recurring JSON,
  tags JSON,
  custom_fields JSON,
  checklist JSON,
  dependencies JSON,
  attachments JSON,
  remarks TEXT,
  comments JSON,
  activity_log JSON,
  progress INT DEFAULT 0,
  followups JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tasks_assignee_status (assignee_id, status),
  INDEX idx_tasks_creator_status (creator_id, status),
  INDEX idx_tasks_approval (approval_owner_id, status),
  INDEX idx_tasks_due_date (due_date),
  INDEX idx_tasks_dept (department),
  INDEX idx_tasks_priority (priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 3. LEAVES TABLE (Strict User & Manager Data Segregation)
CREATE TABLE IF NOT EXISTS leaves (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL,
  user_role VARCHAR(64),
  department VARCHAR(128),
  manager_id VARCHAR(64),
  manager_name VARCHAR(128),
  leave_type VARCHAR(64) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days INT NOT NULL DEFAULT 1,
  reason TEXT,
  emergency_contact VARCHAR(64),
  status VARCHAR(32) DEFAULT 'Pending',
  applied_date VARCHAR(64),
  manager_remark TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_leaves_user (user_id, status),
  INDEX idx_leaves_manager (manager_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 4. CHAT CHANNELS / CONVERSATIONS TABLE
CREATE TABLE IF NOT EXISTS chat_channels (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'group',
  description VARCHAR(255),
  created_by VARCHAR(64),
  participant_ids JSON,
  is_private BOOLEAN DEFAULT TRUE,
  last_message_id VARCHAR(64),
  last_message_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_channels_type (type),
  INDEX idx_channels_last_msg (last_message_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 5. CHAT CHANNEL MEMBERS (Participant Grouping & Conditions Table)
-- Normalizes every person chatting into their own separate record for scale and state isolation
CREATE TABLE IF NOT EXISTS chat_channel_members (
  id VARCHAR(64) PRIMARY KEY,
  channel_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  role VARCHAR(32) DEFAULT 'member',
  nickname VARCHAR(128),
  unread_count INT DEFAULT 0,
  last_read_message_id VARCHAR(64),
  last_read_at TIMESTAMP NULL,
  is_muted BOOLEAN DEFAULT FALSE,
  is_pinned BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_channel_user (channel_id, user_id),
  INDEX idx_member_user_channel (user_id, channel_id),
  INDEX idx_member_channel (channel_id),
  INDEX idx_member_user_unread (user_id, unread_count),
  INDEX idx_member_active_channels (user_id, is_archived, last_read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 6. CHAT MESSAGES TABLE (High-Volume Partitionable & Compound-Indexed)
CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR(64) PRIMARY KEY,
  channel_id VARCHAR(64) NOT NULL,
  sender_id VARCHAR(64) NOT NULL,
  sender_name VARCHAR(128) NOT NULL,
  sender_role VARCHAR(64),
  sender_avatar TEXT,
  message_type VARCHAR(32) DEFAULT 'text',
  text TEXT,
  image_url LONGTEXT,
  audio_url LONGTEXT,
  file_attachment JSON,
  reactions JSON,
  task_attachment JSON,
  task_id VARCHAR(64) NULL,
  reply_to_message_id VARCHAR(64) NULL,
  is_ai BOOLEAN DEFAULT FALSE,
  status VARCHAR(32) DEFAULT 'sent',
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_chat_channel_time (channel_id, created_at DESC),
  INDEX idx_chat_sender_time (sender_id, created_at DESC),
  INDEX idx_chat_task (task_id),
  INDEX idx_chat_type (message_type),
  INDEX idx_chat_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 7. CHAT REACTIONS TABLE (Normalized Atomic Reactions Store)
CREATE TABLE IF NOT EXISTS chat_reactions (
  id VARCHAR(64) PRIMARY KEY,
  message_id VARCHAR(64) NOT NULL,
  channel_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL,
  emoji VARCHAR(32) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_reaction_msg_user_emoji (message_id, user_id, emoji),
  INDEX idx_reaction_msg (message_id),
  INDEX idx_reaction_user (user_id),
  INDEX idx_reaction_channel (channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 8. CHAT MESSAGE RECEIPTS TABLE (Delivery & Read Tracking)
CREATE TABLE IF NOT EXISTS chat_message_receipts (
  id VARCHAR(64) PRIMARY KEY,
  message_id VARCHAR(64) NOT NULL,
  channel_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'delivered',
  delivered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL,
  UNIQUE KEY uk_receipt_msg_user (message_id, user_id),
  INDEX idx_receipt_channel_user (channel_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 9. SYSTEM LOGS TABLE (Enterprise Activity, Audit & Performance Logs)
CREATE TABLE IF NOT EXISTS system_logs (
  id VARCHAR(64) PRIMARY KEY,
  level VARCHAR(16) NOT NULL DEFAULT 'INFO',
  module VARCHAR(64) NOT NULL DEFAULT 'SYSTEM',
  action VARCHAR(128) NOT NULL,
  user_id VARCHAR(64) NULL,
  user_name VARCHAR(128) NULL,
  user_role VARCHAR(64) NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  entity_type VARCHAR(64) NULL,
  entity_id VARCHAR(64) NULL,
  details JSON NULL,
  status_code INT DEFAULT 200,
  execution_time_ms INT DEFAULT 0,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_syslogs_created (created_at DESC),
  INDEX idx_syslogs_module_action (module, action, created_at DESC),
  INDEX idx_syslogs_user (user_id, created_at DESC),
  INDEX idx_syslogs_level (level, created_at DESC),
  INDEX idx_syslogs_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 10. EA FOLLOW-UPS TABLE
CREATE TABLE IF NOT EXISTS ea_followups (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64) NOT NULL,
  task_title VARCHAR(255) NOT NULL,
  assignee_id VARCHAR(64),
  assignee_name VARCHAR(128),
  channel VARCHAR(64) DEFAULT 'Phone Call',
  action_notes TEXT,
  action_required TEXT,
  next_followup_date DATE,
  status VARCHAR(32) DEFAULT 'In Progress',
  is_escalated_to_md BOOLEAN DEFAULT FALSE,
  logged_by VARCHAR(128) DEFAULT 'Rachel Green (EA)',
  logged_at VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ea_followup_task (task_id),
  INDEX idx_ea_followup_assignee (assignee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 11. EA MEETINGS TABLE
CREATE TABLE IF NOT EXISTS ea_meetings (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  host VARCHAR(128) DEFAULT 'Alex Morgan (MD)',
  organizer VARCHAR(128) DEFAULT 'Rachel Green (EA)',
  attendees JSON,
  date DATE NOT NULL,
  time VARCHAR(32) NOT NULL,
  duration_minutes INT DEFAULT 45,
  location VARCHAR(255) DEFAULT 'Executive Boardroom A',
  agenda TEXT,
  status VARCHAR(32) DEFAULT 'Scheduled',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_meetings_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 12. EA DAILY ROUTINE TASKS TABLE
CREATE TABLE IF NOT EXISTS ea_daily_tasks (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  time_slot VARCHAR(32) NOT NULL,
  category VARCHAR(128) DEFAULT 'Executive Admin',
  completed BOOLEAN DEFAULT FALSE,
  completed_at VARCHAR(64),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 13. PENDING UNVERIFIED USERS TABLE (MANAGER OTP)
CREATE TABLE IF NOT EXISTS pending_users (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  email VARCHAR(128) NOT NULL,
  department VARCHAR(128),
  role VARCHAR(64) DEFAULT 'Employee',
  manager_id VARCHAR(64),
  manager_name VARCHAR(128),
  manager_email VARCHAR(128),
  status VARCHAR(64) DEFAULT 'Pending Manager OTP Verification',
  otp_code VARCHAR(16) NOT NULL,
  avatar TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pending_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 14. LEGACY AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  timestamp VARCHAR(64) NOT NULL,
  user VARCHAR(128) NOT NULL,
  action VARCHAR(128) NOT NULL,
  details TEXT,
  category VARCHAR(64) DEFAULT 'General',
  INDEX idx_audit_time (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 15. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  type VARCHAR(32) DEFAULT 'info',
  task_id VARCHAR(64) DEFAULT NULL,
  user_id VARCHAR(64) DEFAULT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user (user_id),
  INDEX idx_notif_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 16. USER STATUSES / STORIES TABLE (24-Hour Expiration Model)
CREATE TABLE IF NOT EXISTS user_statuses (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL,
  user_avatar TEXT,
  type VARCHAR(32) NOT NULL DEFAULT 'text',
  content TEXT,
  media_url LONGTEXT,
  background_color VARCHAR(32) DEFAULT '#007AFF',
  text_color VARCHAR(32) DEFAULT '#FFFFFF',
  font_style VARCHAR(64) DEFAULT 'sans',
  privacy_type VARCHAR(32) DEFAULT 'contacts',
  privacy_users JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE,
  INDEX idx_status_user (user_id, created_at DESC),
  INDEX idx_status_expires (expires_at, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 17. STATUS VIEWS TABLE (Strictly Genuine Authenticated Viewers Tracking)
CREATE TABLE IF NOT EXISTS status_views (
  id VARCHAR(64) PRIMARY KEY,
  status_id VARCHAR(64) NOT NULL,
  viewer_id VARCHAR(64) NOT NULL,
  viewer_name VARCHAR(128) NOT NULL,
  viewer_avatar TEXT,
  viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_status_viewer (status_id, viewer_id),
  INDEX idx_view_status (status_id, viewed_at DESC),
  INDEX idx_view_viewer (viewer_id, viewed_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 18. USER STATUS PRIVACY PREFERENCES TABLE
CREATE TABLE IF NOT EXISTS user_status_privacy (
  user_id VARCHAR(64) PRIMARY KEY,
  privacy_type VARCHAR(32) DEFAULT 'contacts',
  excluded_users JSON,
  allowed_users JSON,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 19. CALL LOGS & HISTORY TABLE (WebRTC Voice & Video Calls)
CREATE TABLE IF NOT EXISTS call_logs (
  id VARCHAR(64) PRIMARY KEY,
  caller_id VARCHAR(64) NOT NULL,
  caller_name VARCHAR(128) NOT NULL,
  caller_avatar TEXT,
  receiver_id VARCHAR(64) NOT NULL,
  receiver_name VARCHAR(128) NOT NULL,
  receiver_avatar TEXT,
  call_type VARCHAR(32) NOT NULL DEFAULT 'voice',
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  duration_seconds INT DEFAULT 0,
  channel_id VARCHAR(64) DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  summary TEXT DEFAULT NULL,
  action_items JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_call_caller (caller_id, created_at DESC),
  INDEX idx_call_receiver (receiver_id, created_at DESC),
  INDEX idx_call_channel (channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;



