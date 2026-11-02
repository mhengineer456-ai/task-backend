import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const originalWorkflowPath = path.join(__dirname, '../workflow_updated_full.json');
const raw = fs.readFileSync(originalWorkflowPath, 'utf8');
const parsed = JSON.parse(raw);
const workflow = Array.isArray(parsed) ? parsed[0] : parsed;

// 1. Fast local cache HTTP Request node for AI queries (< 5ms response)
const fastContextNode = {
  parameters: {
    method: "POST",
    url: "http://host.docker.internal:5000/api/chat/ai-context",
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json.body) }}",
    options: {}
  },
  id: "node-fast-ai-context-cache",
  name: "Fetch Pre-Aggregated Context (Local Cache)",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [-420, -144]
};

// 2. Background Scheduled Sync Trigger node
const scheduleSyncTriggerNode = {
  parameters: {
    rule: {
      interval: [
        {
          field: "minutes",
          minutesInterval: 20
        }
      ]
    }
  },
  id: "node-schedule-sync-trigger",
  name: "Scheduled Background Sync (Every 20 Min)",
  type: "n8n-nodes-base.scheduleTrigger",
  typeVersion: 1.2,
  position: [-420, 260]
};

const triggerSyncNode = {
  parameters: {
    method: "POST",
    url: "http://host.docker.internal:5000/api/sheets/sync",
    options: {}
  },
  id: "node-trigger-backend-sheet-sync",
  name: "Trigger Backend Sheet Ingestion",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [-160, 260]
};

// 3. Native MySQL Nodes for Accessory Inventory & Lot Trims
const mysqlAccessoryNode = {
  parameters: {
    operation: "executeQuery",
    query: "SELECT id, name, category, stock, unit, cost, threshold, color, packets, poNumber, invoiceNo, location FROM materials ORDER BY category ASC, stock DESC;"
  },
  id: "node-mysql-accessory-inventory",
  name: "SQL - Fetch Accessory Inventory",
  type: "n8n-nodes-base.mySql",
  typeVersion: 2.5,
  position: [120, 260],
  credentials: {
    mySql: {
      id: "mysql-accessory-db",
      name: "MySQL - NewData Accessory DB"
    }
  }
};

const mysqlLotAccessoriesNode = {
  parameters: {
    operation: "executeQuery",
    query: "SELECT z.Lot_Number, z.Garment_Type, z.Style, z.Total_Pieces, z.Zip_Selections, z.Zip_Quality_Data, z.Supplier_Name AS zip_supplier, z.po_number AS zip_po, d.Dori_Selections, d.Total_Pieces AS dori_pieces, d.Supplier_Name AS dori_supplier, d.po_number AS dori_po FROM zip z LEFT JOIN doori d ON z.Lot_Number = d.Lot_Number ORDER BY z.id DESC;"
  },
  id: "node-mysql-lot-accessories",
  name: "SQL - Fetch Lot Accessories (Zip & Dori)",
  type: "n8n-nodes-base.mySql",
  typeVersion: 2.5,
  position: [380, 260],
  credentials: {
    mySql: {
      id: "mysql-accessory-db",
      name: "MySQL - NewData Accessory DB"
    }
  }
};

// 4. Manual Trigger Node so user can test SQL directly inside n8n UI
const manualTriggerNode = {
  parameters: {},
  id: "node-manual-test-trigger",
  name: "When clicking Execute Workflow",
  type: "n8n-nodes-base.manualTrigger",
  typeVersion: 1,
  position: [-160, 440]
};

// Update Respond to Webhook1 message
const respondNode = workflow.nodes.find(n => n.name === 'Respond to Webhook1');
if (respondNode) {
  respondNode.parameters.responseBody = '={\n  "success": true,\n  "answer": {{ JSON.stringify($json.output) }},\n  "source": "n8n_optimized_local_cache"\n}';
}

// Update Aggregator & Analytics Engine code to also read SQL Accessory data and safely handle missing webhook
const aggregatorNode = workflow.nodes.find(n => n.name === 'Aggregator & Analytics Engine');
if (aggregatorNode && aggregatorNode.parameters) {
  let code = aggregatorNode.parameters.jsCode || '';
  if (code.includes('$("Webhook (Incoming AI Query)")')) {
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
  if (!code.includes('if (!prompt) {')) {
    code = code.replace(
      'const prompt = String(webhookData.prompt || webhookData.chatInput || webhookData.message || webhookData.query || "").trim();',
      `const prompt = String(webhookData.prompt || webhookData.chatInput || webhookData.message || webhookData.query || "").trim();
if (!prompt) {
  return [{ json: { status: "skipped", message: "No incoming AI query to process (background sync execution)" } }];
}`
    );
  }
  if (!code.includes('sqlMaterials')) {
    code = code.replace(
      'try { doriPurchaseData = $("Fetch DoriPurchaseOrders Sheet").all().map(item => item.json); } catch (e) {}',
      `try { doriPurchaseData = $("Fetch DoriPurchaseOrders Sheet").all().map(item => item.json); } catch (e) {}
let sqlMaterials = [];
let sqlLotAccessories = [];
try { sqlMaterials = $("SQL - Fetch Accessory Inventory").all().map(item => item.json); } catch (e) {}
try { sqlLotAccessories = $("SQL - Fetch Lot Accessories (Zip & Dori)").all().map(item => item.json); } catch (e) {}`
    );
  }
  aggregatorNode.parameters.jsCode = code;
}

// Ensure nodes list contains the new nodes (replacing if already existing)
const newNodesMap = new Map([
  [fastContextNode.name, fastContextNode],
  [scheduleSyncTriggerNode.name, scheduleSyncTriggerNode],
  [triggerSyncNode.name, triggerSyncNode],
  [mysqlAccessoryNode.name, mysqlAccessoryNode],
  [mysqlLotAccessoriesNode.name, mysqlLotAccessoriesNode],
  [manualTriggerNode.name, manualTriggerNode]
]);

workflow.nodes = workflow.nodes.filter(n => !newNodesMap.has(n.name));
workflow.nodes.push(
  fastContextNode,
  scheduleSyncTriggerNode,
  triggerSyncNode,
  mysqlAccessoryNode,
  mysqlLotAccessoriesNode,
  manualTriggerNode
);

// Update connections:
// FAST CHAT PATH: Webhook -> Fetch Pre-Aggregated Context -> Factory AI Agent -> Respond to Webhook1
workflow.connections["Webhook (Incoming AI Query)"] = {
  main: [[{ node: "Fetch Pre-Aggregated Context (Local Cache)", type: "main", index: 0 }]]
};

workflow.connections["Fetch Pre-Aggregated Context (Local Cache)"] = {
  main: [[{ node: "Factory AI Agent", type: "main", index: 0 }]]
};

// BACKGROUND SYNC PATH: Schedule Trigger -> Trigger Backend Sheet Ingestion (STANDALONE)
workflow.connections["Scheduled Background Sync (Every 20 Min)"] = {
  main: [[{ node: "Trigger Backend Sheet Ingestion", type: "main", index: 0 }]]
};

// Disconnect Trigger Backend Sheet Ingestion from SQL/AI so background sync doesn't run AI Agent
delete workflow.connections["Trigger Backend Sheet Ingestion"];

// MANUAL TEST PATH: Manual Trigger -> Trigger Backend Sheet Ingestion
workflow.connections["When clicking Execute Workflow"] = {
  main: [[{ node: "Trigger Backend Sheet Ingestion", type: "main", index: 0 }]]
};

// FULL SHEET + SQL CHAIN (Fallback): Sheet chain flows into SQL nodes then Aggregator
workflow.connections["Fetch DoriPurchaseOrders Sheet"] = {
  main: [[{ node: "SQL - Fetch Accessory Inventory", type: "main", index: 0 }]]
};

workflow.connections["SQL - Fetch Accessory Inventory"] = {
  main: [[{ node: "SQL - Fetch Lot Accessories (Zip & Dori)", type: "main", index: 0 }]]
};

workflow.connections["SQL - Fetch Lot Accessories (Zip & Dori)"] = {
  main: [[{ node: "Aggregator & Analytics Engine", type: "main", index: 0 }]]
};

// Ensure workflow is marked active
workflow.active = true;

const outputPath = path.join(__dirname, '../workflow_optimized.json');
fs.writeFileSync(outputPath, JSON.stringify([workflow], null, 2));

console.log('✅ Generated workflow_optimized.json with', workflow.nodes.length, 'nodes.');
