import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the exact workflow currently exported from n8n
const allWfsPath = path.join(__dirname, '../all_n8n_workflows.json');
const wfs = JSON.parse(fs.readFileSync(allWfsPath, 'utf8'));
const wf = wfs.find(w => w.id === 'nUjo2ktj7czCLu9E');

if (!wf) {
  console.error('Workflow nUjo2ktj7czCLu9E not found!');
  process.exit(1);
}

console.log('Fixing workflow:', wf.name, '(ID:', wf.id, ')');

// 1. DISCONNECT Trigger Backend Sheet Ingestion from SQL / AI Agent
delete wf.connections["Trigger Backend Sheet Ingestion"];
wf.connections["When clicking Execute Workflow"] = {
  main: [[{ node: "Trigger Backend Sheet Ingestion", type: "main", index: 0 }]]
};

// 2. Scheduled Background Sync connects ONLY to Trigger Backend Sheet Ingestion
wf.connections["Scheduled Background Sync (Every 20 Min)"] = {
  main: [[{ node: "Trigger Backend Sheet Ingestion", type: "main", index: 0 }]]
};

// 3. Make Aggregator & Analytics Engine safe against missing webhook data
const aggregatorNode = wf.nodes.find(n => n.name === 'Aggregator & Analytics Engine');
if (aggregatorNode && aggregatorNode.parameters) {
  let code = aggregatorNode.parameters.jsCode || '';

  // Safe webhook retrieval
  if (code.includes('const webhookData = $("Webhook (Incoming AI Query)").first().json.body || {};')) {
    code = code.replace(
      'const webhookData = $("Webhook (Incoming AI Query)").first().json.body || {};',
      `let webhookData = {};
try {
  webhookData = $("Webhook (Incoming AI Query)").first().json.body || {};
} catch (e) {
  try {
    webhookData = $input.first().json.body || $input.first().json || {};
  } catch (err) {
    webhookData = {};
  }
}`
    );
  }

  // Safe check if prompt exists
  if (!code.includes('if (!prompt) {')) {
    code = code.replace(
      'const prompt = String(webhookData.prompt || webhookData.chatInput || webhookData.message || webhookData.query || "").trim();',
      `const prompt = String(webhookData.prompt || webhookData.chatInput || webhookData.message || webhookData.query || "").trim();
if (!prompt) {
  return [{ json: { status: "skipped", message: "No incoming AI query to process (background sync execution)" } }];
}`
    );
  }

  aggregatorNode.parameters.jsCode = code;
  console.log('✅ Aggregator & Analytics Engine code updated with safe try-catch.');
}

// Ensure active is true
wf.active = true;

const fixedOutputPath = path.join(__dirname, '../fixed_workflow_nUjo2ktj7czCLu9E.json');
fs.writeFileSync(fixedOutputPath, JSON.stringify([wf], null, 2));

console.log('✅ Generated fixed_workflow_nUjo2ktj7czCLu9E.json successfully!');
