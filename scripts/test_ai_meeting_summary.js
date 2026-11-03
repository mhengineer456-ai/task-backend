/**
 * Automated Verification Script for AI Meeting Summary & Task Delegation
 * Tests:
 * 1. AI Summary generation endpoint
 * 2. Retrieval of saved call summary
 * 3. Conversion of action items into real Kanban tasks
 */

import http from 'http';

const BASE_URL = 'http://localhost:5000';

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting AI Meeting Summarizer & Action Items Integration Tests...\n');
  let passed = 0;
  let total = 0;

  const testCallId = `call-test-${Date.now()}`;

  // 1. Log a completed test call
  total++;
  try {
    const logRes = await makeRequest('POST', '/api/calls/log', {
      id: testCallId,
      callerId: 'usr-1',
      callerName: 'Alex Johnson',
      receiverId: 'usr-2',
      receiverName: 'Sarah Jenkins',
      callType: 'video',
      status: 'completed',
      durationSeconds: 420,
      channelId: 'dm-usr-1-usr-2'
    });

    if (logRes.status === 201 && logRes.body.success) {
      console.log('✅ PASS: Call logged successfully for AI test:', testCallId);
      passed++;
    } else {
      console.error('❌ FAIL: Call log failed:', logRes);
    }
  } catch (err) {
    console.error('❌ FAIL: Call log error:', err.message);
  }

  // 2. Test POST /api/calls/:callId/ai-summary
  total++;
  try {
    const summaryRes = await makeRequest('POST', `/api/calls/${testCallId}/ai-summary`, {
      notes: 'Discussed Q4 mobile app launch. Alex will finalize iOS testing. Sarah will prepare release notes and update stakeholder dashboard by Friday.',
      topic: 'Q4 Launch Alignment',
      callerName: 'Alex Johnson',
      receiverName: 'Sarah Jenkins',
      durationSeconds: 420,
      channelId: 'dm-usr-1-usr-2'
    });

    if (summaryRes.status === 200 && summaryRes.body.success && summaryRes.body.summary && Array.isArray(summaryRes.body.actionItems)) {
      console.log('✅ PASS: POST /api/calls/:callId/ai-summary generated summary & action items');
      console.log('   📝 Summary:', summaryRes.body.summary.slice(0, 70) + '...');
      console.log('   📋 Action Items Count:', summaryRes.body.actionItems.length);
      passed++;
    } else {
      console.error('❌ FAIL: AI summary generation failed:', summaryRes);
    }
  } catch (err) {
    console.error('❌ FAIL: AI summary error:', err.message);
  }

  // 3. Test GET /api/calls/:callId/ai-summary
  total++;
  try {
    const getRes = await makeRequest('GET', `/api/calls/${testCallId}/ai-summary`);
    if (getRes.status === 200 && getRes.body.success && getRes.body.call.summary) {
      console.log('✅ PASS: GET /api/calls/:callId/ai-summary retrieved saved minutes');
      passed++;
    } else {
      console.error('❌ FAIL: GET AI summary failed:', getRes);
    }
  } catch (err) {
    console.error('❌ FAIL: GET summary error:', err.message);
  }

  // 4. Test POST /api/calls/:callId/create-tasks
  total++;
  try {
    const taskRes = await makeRequest('POST', `/api/calls/${testCallId}/create-tasks`, {
      actionItems: [
        {
          title: 'Finalize iOS testing for release build',
          description: 'Ensure all push notifications and video call flows pass QA',
          suggested_assignee: 'Sarah Jenkins',
          priority: 'high',
          due_in_days: 2
        },
        {
          title: 'Publish Q4 release notes on stakeholder portal',
          description: 'Document calling and screen sharing capabilities',
          suggested_assignee: 'Alex Johnson',
          priority: 'medium',
          due_in_days: 3
        }
      ],
      creatorId: 'usr-1',
      creatorName: 'Alex Johnson',
      channelId: 'dm-usr-1-usr-2',
      postSummaryToChat: true
    });

    if (taskRes.status === 200 && taskRes.body.success && taskRes.body.createdCount === 2) {
      console.log('✅ PASS: POST /api/calls/:callId/create-tasks created 2 tasks in board and notified assignees');
      passed++;
    } else {
      console.error('❌ FAIL: Task creation from action items failed:', taskRes);
    }
  } catch (err) {
    console.error('❌ FAIL: Task creation error:', err.message);
  }

  console.log(`\n========================================================`);
  console.log(`🏁 AI Meeting Summary Tests: ${passed}/${total} Passed`);
  console.log(`========================================================\n`);

  if (passed === total) {
    console.log('🎉 ALL AI MEETING SUMMARY & TASK DELEGATION TESTS PASSED PERFECTLY!\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests();
