import fs from 'fs';
import { config } from '../config/config.js';

export const readDb = () => {
  try {
    if (!fs.existsSync(config.dbPath)) {
      fs.writeFileSync(config.dbPath, JSON.stringify({ leaves: [], tasks: [], users: [] }, null, 2));
    }
    const data = fs.readFileSync(config.dbPath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('Error reading db.json:', e);
    return { leaves: [], tasks: [], users: [] };
  }
};

export const writeDb = (data) => {
  try {
    fs.writeFileSync(config.dbPath, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error writing db.json:', e);
  }
};
