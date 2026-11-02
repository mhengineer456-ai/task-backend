import { initDatabase, query } from './config/db.js';

async function clearDatabase() {
  console.log('🧹 Initializing and clearing all sample data from MySQL database...');
  await initDatabase();

  const tables = ['tasks', 'leaves', 'ea_followups', 'ea_meetings', 'ea_daily_tasks', 'pending_users', 'audit_logs'];

  for (const table of tables) {
    try {
      await query(`DELETE FROM \`${table}\`;`);
    } catch (e) {
      console.log(`Notice for table ${table}:`, e.message);
    }
  }

  console.log('✅ All sample data successfully cleared! MySQL database is clean and ready for your custom data.');
  process.exit(0);
}

clearDatabase();
