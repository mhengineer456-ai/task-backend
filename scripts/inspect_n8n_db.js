const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/node/.n8n/database.sqlite');

const wf = db.prepare("SELECT connections, nodes FROM workflow_entity WHERE id = 'nUjo2ktj7czCLu9E'").get();
const connections = JSON.parse(wf.connections);
console.log('--- WORKFLOW_ENTITY CONNECTIONS ---');
console.log('Scheduled Sync ->', connections["Scheduled Background Sync (Every 20 Min)"]);
console.log('Trigger Ingestion ->', connections["Trigger Backend Sheet Ingestion"]);
console.log('SQL Lot ->', connections["SQL - Fetch Lot Accessories (Zip & Dori)"]);
    
const hist = db.prepare("SELECT connections, nodes FROM workflow_history WHERE versionId = '35afdb1e-5950-40f1-999e-fd707ab156eb'").get();
if (hist) {
  const hConn = JSON.parse(hist.connections);
  console.log('--- WORKFLOW_HISTORY CONNECTIONS ---');
  console.log('Scheduled Sync ->', hConn["Scheduled Background Sync (Every 20 Min)"]);
  console.log('Trigger Ingestion ->', hConn["Trigger Backend Sheet Ingestion"]);
  console.log('SQL Lot ->', hConn["SQL - Fetch Lot Accessories (Zip & Dori)"]);
}
