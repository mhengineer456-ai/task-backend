import { io as ioClient } from 'socket.io-client';

const BACKEND_URL = 'http://localhost:5000';

async function runCallingTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 Starting WebRTC Calling Full-Stack Verification Tests');
  console.log('🧪 ========================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, testName) {
    totalTests++;
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passedTests++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
    }
  }

  // ---------------------------------------------------------------
  // 1. Test GET /api/calls/ice-servers
  // ---------------------------------------------------------------
  try {
    const iceRes = await fetch(`${BACKEND_URL}/api/calls/ice-servers`);
    const iceJson = await iceRes.json();
    assert(iceJson.success === true && Array.isArray(iceJson.iceServers) && iceJson.iceServers.length > 0, 'GET /api/calls/ice-servers returns STUN servers');
  } catch (err) {
    assert(false, `GET /api/calls/ice-servers error: ${err.message}`);
  }

  // ---------------------------------------------------------------
  // 2. Test POST /api/calls/log
  // ---------------------------------------------------------------
  const testCallId = `testcall-${Date.now()}`;
  try {
    const logRes = await fetch(`${BACKEND_URL}/api/calls/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: testCallId,
        callerId: 'usr-1',
        callerName: 'Alex Johnson',
        callerAvatar: '',
        receiverId: 'usr-2',
        receiverName: 'Sarah Jenkins',
        receiverAvatar: '',
        callType: 'video',
        status: 'completed',
        durationSeconds: 195,
        channelId: 'dm-usr-1-usr-2',
        postToChat: true
      })
    });
    const logJson = await logRes.json();
    assert(logJson.success === true && logJson.call?.id === testCallId, 'POST /api/calls/log records call');
  } catch (err) {
    assert(false, `POST /api/calls/log error: ${err.message}`);
  }

  // ---------------------------------------------------------------
  // 3. Test GET /api/calls/history
  // ---------------------------------------------------------------
  try {
    const histRes = await fetch(`${BACKEND_URL}/api/calls/history?userId=usr-1`);
    const histJson = await histRes.json();
    const foundLog = (histJson.calls || []).find(c => c.id === testCallId);
    assert(histJson.success === true && foundLog !== undefined, 'GET /api/calls/history retrieves logged calls for user');
  } catch (err) {
    assert(false, `GET /api/calls/history error: ${err.message}`);
  }

  // ---------------------------------------------------------------
  // 4. Test Socket.IO Real-Time WebRTC Signalling Flow
  // ---------------------------------------------------------------
  console.log('\n🔌 Testing Real-Time Socket.IO WebRTC Signalling...');

  await new Promise((resolve) => {
    const socketUserA = ioClient(BACKEND_URL, { transports: ['websocket'] });
    const socketUserB = ioClient(BACKEND_URL, { transports: ['websocket'] });

    let connectedCount = 0;
    const onConnect = () => {
      connectedCount++;
      if (connectedCount === 2) {
        setTimeout(startSocketTests, 100);
      }
    };

    socketUserA.on('connect', () => {
      socketUserA.emit('user:join', 'usr-test-a');
      onConnect();
    });

    socketUserB.on('connect', () => {
      socketUserB.emit('user:join', 'usr-test-b');
      onConnect();
    });

    function startSocketTests() {
      const liveCallId = `livecall-${Date.now()}`;

      // Step 1: User B expects incoming call
      socketUserB.on('call:incoming', (incoming) => {
        assert(incoming.callId === liveCallId && incoming.caller?.id === 'usr-test-a', 'User B receives call:incoming event');

        // Step 2: User B sends ringing
        socketUserB.emit('call:ringing', {
          callId: liveCallId,
          callerId: 'usr-test-a'
        });

        // Step 3: User B accepts call
        setTimeout(() => {
          socketUserB.emit('call:accept', {
            callId: liveCallId,
            callerId: 'usr-test-a',
            receiver: { id: 'usr-test-b', name: 'User B' }
          });
        }, 100);
      });

      // Step 4: User A gets ringing
      socketUserA.on('call:ringing', (data) => {
        assert(data.callId === liveCallId, 'User A receives call:ringing confirmation');
      });

      // Step 5: User A gets accept -> sends SDP Offer
      socketUserA.on('call:accept', (data) => {
        assert(data.callId === liveCallId, 'User A receives call:accept event');

        // User A emits SDP offer
        socketUserA.emit('call:offer', {
          callId: liveCallId,
          targetUserId: 'usr-test-b',
          offer: { type: 'offer', sdp: 'mock-sdp-offer-data' }
        });
      });

      // Step 6: User B gets SDP Offer -> sends SDP Answer
      socketUserB.on('call:offer', (data) => {
        assert(data.offer?.sdp === 'mock-sdp-offer-data', 'User B receives call:offer SDP');

        socketUserB.emit('call:answer', {
          callId: liveCallId,
          targetUserId: 'usr-test-a',
          answer: { type: 'answer', sdp: 'mock-sdp-answer-data' }
        });

        // Also test ICE candidate exchange
        socketUserB.emit('call:ice-candidate', {
          callId: liveCallId,
          targetUserId: 'usr-test-a',
          candidate: { candidate: 'candidate:1 1 UDP ...' }
        });
      });

      // Step 7: User A gets SDP Answer
      socketUserA.on('call:answer', (data) => {
        assert(data.answer?.sdp === 'mock-sdp-answer-data', 'User A receives call:answer SDP');
      });

      // Step 8: User A gets ICE candidate
      socketUserA.on('call:ice-candidate', (data) => {
        assert(data.candidate?.candidate !== undefined, 'User A receives call:ice-candidate');

        // Step 9: User A ends call
        socketUserA.emit('call:end', {
          callId: liveCallId,
          targetUserId: 'usr-test-b',
          durationSeconds: 45,
          reason: 'Call completed normally'
        });
      });

      // Step 10: User B gets call:end
      socketUserB.on('call:end', (data) => {
        assert(data.callId === liveCallId, 'User B receives call:end event');

        // Disconnect sockets and finish test
        socketUserA.disconnect();
        socketUserB.disconnect();
        resolve();
      });

      // Initiate Call from User A
      socketUserA.emit('call:initiate', {
        callId: liveCallId,
        caller: { id: 'usr-test-a', name: 'User A', avatar: '', role: 'Lead' },
        receiverId: 'usr-test-b',
        receiverName: 'User B',
        receiverAvatar: '',
        callType: 'video',
        channelId: 'dm-usr-test-a-usr-test-b'
      });
    }
  });

  // ---------------------------------------------------------------
  // 5. Test Edge Case: Busy State when participant is already in call
  // ---------------------------------------------------------------
  console.log('\n⏳ Testing Edge Case: Call Busy...');
  await new Promise((resolve) => {
    const socketUserX = ioClient(BACKEND_URL, { transports: ['websocket'] });
    const socketUserY = ioClient(BACKEND_URL, { transports: ['websocket'] });
    const socketUserZ = ioClient(BACKEND_URL, { transports: ['websocket'] });

    let readyCount = 0;
    const onReady = () => {
      readyCount++;
      if (readyCount === 3) runBusyTest();
    };

    socketUserX.on('connect', () => { socketUserX.emit('user:join', 'usr-busy-x'); onReady(); });
    socketUserY.on('connect', () => { socketUserY.emit('user:join', 'usr-busy-y'); onReady(); });
    socketUserZ.on('connect', () => { socketUserZ.emit('user:join', 'usr-busy-z'); onReady(); });

    function runBusyTest() {
      const call1 = `call1-${Date.now()}`;
      const call2 = `call2-${Date.now()}`;

      // User X calls User Y
      socketUserX.emit('call:initiate', {
        callId: call1,
        caller: { id: 'usr-busy-x', name: 'User X' },
        receiverId: 'usr-busy-y',
        receiverName: 'User Y',
        callType: 'voice'
      });

      // While User Y is ringing/busy, User Z calls User Y
      setTimeout(() => {
        socketUserZ.on('call:busy', (data) => {
          assert(data.callId === call2 && data.receiverId === 'usr-busy-y', 'User Z receives call:busy when calling User Y');

          // Clean up
          socketUserX.emit('call:end', { callId: call1, targetUserId: 'usr-busy-y' });
          socketUserX.disconnect();
          socketUserY.disconnect();
          socketUserZ.disconnect();
          resolve();
        });

        socketUserZ.emit('call:initiate', {
          callId: call2,
          caller: { id: 'usr-busy-z', name: 'User Z' },
          receiverId: 'usr-busy-y',
          receiverName: 'User Y',
          callType: 'voice'
        });
      }, 150);
    }
  });

  console.log('\n========================================================');
  console.log(`🏁 Calling Tests Completed: ${passedTests}/${totalTests} Passed`);
  console.log('========================================================\n');

  if (passedTests === totalTests) {
    console.log('🎉 ALL CALLING TESTS PASSED PERFECTLY!');
    process.exit(0);
  } else {
    console.error('❌ SOME TESTS FAILED');
    process.exit(1);
  }
}

runCallingTests();
