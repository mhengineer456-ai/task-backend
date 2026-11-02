import { initDatabase } from './config/db.js';

console.log('🔄 Initializing MySQL Database Schema and Seed Data...');
initDatabase().then(() => {
  console.log('✅ MySQL Database initialization complete.');
  process.exit(0);
}).catch(err => {
  console.error('❌ Database initialization failed:', err);
  process.exit(1);
});
