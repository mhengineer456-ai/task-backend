import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const originalWorkflowPath = path.join(__dirname, '../workflow_nUjo2ktj7czCLu9E.json');
const raw = fs.readFileSync(originalWorkflowPath, 'utf8');
const parsed = JSON.parse(raw);

const workflow = Array.isArray(parsed) ? parsed[0] : parsed;

// 1. Define the 6 new Google Sheet Nodes
const newNodes = [
  {
    parameters: {
      documentId: {
        __rl: true,
        value: "1IMhmYlJ3s2PPRgEQs1Ikd4O1OBXK4EYL1oV_-kWAkyg",
        mode: "id"
      },
      sheetName: {
        __rl: true,
        value: "KajButton",
        mode: "name"
      },
      options: {}
    },
    id: "node-fetch-kajbutton-01",
    name: "Fetch KajButton Sheet",
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position: [-480, 240],
    credentials: {
      googleSheetsOAuth2Api: {
        id: "lvaWKk4ZeIR45COl",
        name: "Google Sheets account 3"
      }
    },
    onError: "continueRegularOutput"
  },
  {
    parameters: {
      documentId: {
        __rl: true,
        value: "1IMhmYlJ3s2PPRgEQs1Ikd4O1OBXK4EYL1oV_-kWAkyg",
        mode: "id"
      },
      sheetName: {
        __rl: true,
        value: "Washing",
        mode: "name"
      },
      options: {}
    },
    id: "node-fetch-washing-01",
    name: "Fetch Washing Sheet",
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position: [-480, 400],
    credentials: {
      googleSheetsOAuth2Api: {
        id: "lvaWKk4ZeIR45COl",
        name: "Google Sheets account 3"
      }
    },
    onError: "continueRegularOutput"
  },
  {
    parameters: {
      documentId: {
        __rl: true,
        value: "1IMhmYlJ3s2PPRgEQs1Ikd4O1OBXK4EYL1oV_-kWAkyg",
        mode: "id"
      },
      sheetName: {
        __rl: true,
        value: "Overlock",
        mode: "name"
      },
      options: {}
    },
    id: "node-fetch-overlock-01",
    name: "Fetch Overlock Sheet",
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position: [-280, 240],
    credentials: {
      googleSheetsOAuth2Api: {
        id: "lvaWKk4ZeIR45COl",
        name: "Google Sheets account 3"
      }
    },
    onError: "continueRegularOutput"
  },
  {
    parameters: {
      documentId: {
        __rl: true,
        value: "1IMhmYlJ3s2PPRgEQs1Ikd4O1OBXK4EYL1oV_-kWAkyg",
        mode: "id"
      },
      sheetName: {
        __rl: true,
        value: "Folding",
        mode: "name"
      },
      options: {}
    },
    id: "node-fetch-folding-01",
    name: "Fetch Folding Sheet",
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position: [-280, 400],
    credentials: {
      googleSheetsOAuth2Api: {
        id: "lvaWKk4ZeIR45COl",
        name: "Google Sheets account 3"
      }
    },
    onError: "continueRegularOutput"
  },
  {
    parameters: {
      documentId: {
        __rl: true,
        value: "1IMhmYlJ3s2PPRgEQs1Ikd4O1OBXK4EYL1oV_-kWAkyg",
        mode: "id"
      },
      sheetName: {
        __rl: true,
        value: "Elastic",
        mode: "name"
      },
      options: {}
    },
    id: "node-fetch-elastic-01",
    name: "Fetch Elastic Sheet",
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position: [-480, 560],
    credentials: {
      googleSheetsOAuth2Api: {
        id: "lvaWKk4ZeIR45COl",
        name: "Google Sheets account 3"
      }
    },
    onError: "continueRegularOutput"
  },
  {
    parameters: {
      documentId: {
        __rl: true,
        value: "1dOCjNFwaAel5qun0_ZJVIGmREqjI76CJBBFIjM3NHv8",
        mode: "id"
      },
      sheetName: {
        __rl: true,
        value: "LotBarcodeData",
        mode: "name"
      },
      options: {}
    },
    id: "node-fetch-barcode-01",
    name: "Fetch Barcode Data Sheet",
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position: [-280, 560],
    credentials: {
      googleSheetsOAuth2Api: {
        id: "lvaWKk4ZeIR45COl",
        name: "Google Sheets account 3"
      }
    },
    onError: "continueRegularOutput"
  },
  {
    parameters: {
      documentId: {
        __rl: true,
        value: "16miFNw0WMllnZ1XRHtsuH_8kVUM_6Y1O3uVsoM-Hjppo",
        mode: "id"
      },
      sheetName: {
        __rl: true,
        value: "ZipPurchaseOrders",
        mode: "name"
      },
      options: {}
    },
    id: "node-fetch-zippurchase-01",
    name: "Fetch ZipPurchaseOrders Sheet",
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position: [-480, 720],
    credentials: {
      googleSheetsOAuth2Api: {
        id: "lvaWKk4ZeIR45COl",
        name: "Google Sheets account 3"
      }
    },
    onError: "continueRegularOutput"
  },
  {
    parameters: {
      documentId: {
        __rl: true,
        value: "1LjwZqU26I-OxwL1tTyps8bxSM1qS8LLUuL-sy_4COK6k",
        mode: "id"
      },
      sheetName: {
        __rl: true,
        value: "DoriPurchaseOrders",
        mode: "name"
      },
      options: {}
    },
    id: "node-fetch-doripurchase-01",
    name: "Fetch DoriPurchaseOrders Sheet",
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position: [-280, 720],
    credentials: {
      googleSheetsOAuth2Api: {
        id: "lvaWKk4ZeIR45COl",
        name: "Google Sheets account 3"
      }
    },
    onError: "continueRegularOutput"
  }
];

// 2. Remove any previously added new nodes to avoid duplicates
const existingNodeNames = new Set(newNodes.map(n => n.name));
workflow.nodes = workflow.nodes.filter(n => !existingNodeNames.has(n.name));
workflow.nodes.push(...newNodes);

// 3. Ensure Fetch Issues Sheet strictly targets 'Issues' tab on '1uo14nKO_yHu4AJ2rOgaJajuprcinj6xw1AUMFJ6_zYM'
const issuesNode = workflow.nodes.find(n => n.name === 'Fetch Issues Sheet');
if (issuesNode) {
  issuesNode.parameters.documentId = {
    __rl: true,
    value: "1uo14nKO_yHu4AJ2rOgaJajuprcinj6xw1AUMFJ6_zYM",
    mode: "id"
  };
  issuesNode.parameters.sheetName = {
    __rl: true,
    value: "Issues",
    mode: "name"
  };
}

// 4. Update the Code node: 'Aggregator & Analytics Engine'
const codeNode = workflow.nodes.find(n => n.name === 'Aggregator & Analytics Engine');
if (codeNode) {
  const aggregatorCodePath = path.join(__dirname, 'n8n_aggregator_code.js');
  codeNode.parameters.jsCode = fs.readFileSync(aggregatorCodePath, 'utf8');
}

// 5. Update Connections:
// Chain all 12 sheet nodes sequentially so Aggregator runs only after ALL 12 sheets have finished fetching
const allSheetNodes = [
  "Fetch JobOrder Sheet",
  "Fetch Issues Sheet",
  "Fetch LotLogs Sheet",
  "Fetch Index Sheet",
  "Fetch KajButton Sheet",
  "Fetch Washing Sheet",
  "Fetch Overlock Sheet",
  "Fetch Folding Sheet",
  "Fetch Elastic Sheet",
  "Fetch Barcode Data Sheet",
  "Fetch ZipPurchaseOrders Sheet",
  "Fetch DoriPurchaseOrders Sheet"
];

// Reset sheet connections
allSheetNodes.forEach(name => {
  delete workflow.connections[name];
});

// Webhook -> First Sheet Node
workflow.connections["Webhook (Incoming AI Query)"] = {
  main: [[{ node: allSheetNodes[0], type: "main", index: 0 }]]
};

// Chain: Sheet[i] -> Sheet[i+1]
for (let i = 0; i < allSheetNodes.length - 1; i++) {
  workflow.connections[allSheetNodes[i]] = {
    main: [[{ node: allSheetNodes[i + 1], type: "main", index: 0 }]]
  };
}

// Last Sheet Node -> Aggregator & Analytics Engine
workflow.connections[allSheetNodes[allSheetNodes.length - 1]] = {
  main: [[{ node: "Aggregator & Analytics Engine", type: "main", index: 0 }]]
};

// Save updated workflow
const updatedPath = path.join(__dirname, '../workflow_updated_full.json');
fs.writeFileSync(updatedPath, JSON.stringify([workflow], null, 2));

console.log('✅ Updated workflow generated successfully with', workflow.nodes.length, 'nodes!');
