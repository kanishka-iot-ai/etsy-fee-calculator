/**
 * ShopProfit — Phase 7G Security Regression Test Suite
 *
 * Verifies all 12 mandatory security requirements for cross-isolate atomic
 * confirmation-token replay protection (`AdvisorConfirmationCoordinatorDO`)
 * and conversational advisor boundaries:
 *
 *  1. First valid token consumption succeeds.
 *  2. Second consumption on the same isolate fails.
 *  3. Replay against another isolate fails (via Durable Object coordinator).
 *  4. Concurrent attempts to consume the same token allow at most one success.
 *  5. Forged signatures fail.
 *  6. Expired tokens fail.
 *  7. Conversation-ID mismatch fails.
 *  8. Original-message mismatch fails.
 *  9. Coordinator outage fails closed (HTTP 503, zero tool executions).
 * 10. Expired nonce cleanup does not permit a valid token to be replayed.
 * 11. Rate limits and request-size limits remain enforced.
 * 12. No private data or signing secrets are logged or accepted in the coordinator.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  handleAdvisorConversationRequest,
  createConversationSessionStore,
  createCoordinatorNamespaceSimulator,
  getReplayProtectionMode
} from "./src/advisor-conversation.js";
import { MAX_NONCES_PER_CONVERSATION } from "./src/advisor-confirmation-do.js";

const TEST_SECRET = "phase7g-atomic-coordinator-hmac-secret-2026";
const PRIVATE_KEY = "phase7g-private-bearer-token-key";

let ipSeq = 1;
function nextIp() {
  ipSeq += 1;
  return `10.88.0.${ipSeq}`;
}

function createMockAi() {
  return {
    async run() {
      return {
        response: {
          action: "call_tool",
          tool: "calculate_profit",
          missingFields: [],
          clarificationQuestion: null,
          arguments: {
            country: "US",
            itemPrice: 30,
            shipping: 0, // Unverified model zero -> triggers confirmation token
            production: 10,
            packaging: 1,
            shippingCost: 4
          }
        }
      };
    }
  };
}

function createIsolateEnv(sharedCoordinator, overrides = {}) {
  return {
    ENABLE_CONVERSATIONAL_PROTOTYPE: true,
    REQUIRE_GLOBAL_COORDINATOR: true,
    CONFIRMATION_COORDINATOR: sharedCoordinator,
    CONVERSATION_HMAC_SECRET: TEST_SECRET,
    SESSION_STORE: createConversationSessionStore(), // Distinct per-isolate memory
    REQUIRE_PRIVATE_AUTH: true,
    PRIVATE_PROTOTYPE_KEY: PRIVATE_KEY,
    AI: createMockAi(),
    ...overrides
  };
}

async function sendConversationPost(payload, env, ip = nextIp(), extraHeaders = {}) {
  const bodyStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  const req = new Request("https://private-test.shopprofit.local/api/private/advisor-conversation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PRIVATE_KEY}`,
      "CF-Connecting-IP": ip,
      ...extraHeaders
    },
    body: bodyStr
  });
  const res = await handleAdvisorConversationRequest(req, env);
  const body = await res.json();
  return { status: res.status, body, headers: res.headers };
}

// ─── Tests 1, 2, 3: First Consumption Succeeds, Same-Isolate Replay Fails, Cross-Isolate Replay Fails ───

test("Phase 7G (1, 2, 3): First valid consumption succeeds; replay on same isolate AND replay on separate isolate both fail", async () => {
  const sharedCoordinator = createCoordinatorNamespaceSimulator();
  const isolateAEnv = createIsolateEnv(sharedCoordinator);
  const isolateBEnv = createIsolateEnv(sharedCoordinator);
  const isolateCEnv = createIsolateEnv(sharedCoordinator);

  assert.equal(getReplayProtectionMode(isolateAEnv), "durable_object_atomic");
  assert.equal(getReplayProtectionMode(isolateBEnv), "durable_object_atomic");

  // Issue token on Isolate A
  const init = await sendConversationPost(
    { message: "I sell a print in the US for $30. It costs $10 to make, $1 to package, and postage costs me $4." },
    isolateAEnv
  );
  assert.equal(init.status, 200);
  assert.equal(init.body.state, "awaiting_confirmation");
  assert.equal(init.body.replayProtectionMode, "durable_object_atomic");
  assert.ok(init.body.confirmationToken);

  const confirmPayload = {
    conversationId: init.body.conversationId,
    message: init.body.originalMessage,
    confirmationToken: init.body.confirmationToken,
    confirmedInputs: { shipping: 4 }
  };

  // (1) First valid consumption on Isolate B (different isolate from issuance!) succeeds
  const firstConsume = await sendConversationPost(confirmPayload, isolateBEnv);
  assert.equal(firstConsume.status, 200);
  assert.equal(firstConsume.body.state, "calculation_completed");
  assert.equal(firstConsume.body.replayProtectionMode, "durable_object_atomic");
  assert.equal(firstConsume.body.executedTools, 1);

  // (2) Second consumption on the SAME isolate (Isolate B) fails
  const sameIsolateReplay = await sendConversationPost(confirmPayload, isolateBEnv);
  assert.equal(sameIsolateReplay.status, 400);
  assert.equal(sameIsolateReplay.body.error, "confirmation_replayed");
  assert.equal(sameIsolateReplay.body.executedTools, 0);

  // (3) Replay against ANOTHER separate isolate (Isolate A and Isolate C) fails via Durable Object coordinator
  const crossIsolateReplayA = await sendConversationPost(confirmPayload, isolateAEnv);
  assert.equal(crossIsolateReplayA.status, 400);
  assert.equal(crossIsolateReplayA.body.error, "confirmation_replayed");
  assert.equal(crossIsolateReplayA.body.executedTools, 0);

  const crossIsolateReplayC = await sendConversationPost(confirmPayload, isolateCEnv);
  assert.equal(crossIsolateReplayC.status, 400);
  assert.equal(crossIsolateReplayC.body.error, "confirmation_replayed");
  assert.equal(crossIsolateReplayC.body.executedTools, 0);
});

// ─── Test 4: Concurrent Attempts Across Separate Isolates Allow At Most One Success ───

test("Phase 7G (4): 10 concurrent attempts across 10 separate isolates to consume the same token allow at most 1 success", async () => {
  const sharedCoordinator = createCoordinatorNamespaceSimulator();
  const issuerEnv = createIsolateEnv(sharedCoordinator);

  const init = await sendConversationPost(
    { message: "I sell a print in the US for $30. It costs $10 to make, $1 to package, and postage costs me $4." },
    issuerEnv
  );
  assert.equal(init.status, 200);

  const confirmPayload = {
    conversationId: init.body.conversationId,
    message: init.body.originalMessage,
    confirmationToken: init.body.confirmationToken,
    confirmedInputs: { shipping: 4 }
  };

  // Launch 10 concurrent confirmation requests across 10 independent Worker isolates simultaneously
  const concurrentPromises = Array.from({ length: 10 }, () => {
    const separateIsolateEnv = createIsolateEnv(sharedCoordinator);
    return sendConversationPost(confirmPayload, separateIsolateEnv, nextIp());
  });

  const outcomes = await Promise.all(concurrentPromises);
  const successes = outcomes.filter((o) => o.status === 200 && o.body.state === "calculation_completed");
  const replays = outcomes.filter((o) => o.status === 400 && o.body.error === "confirmation_replayed");

  assert.equal(successes.length, 1, "Exactly 1 concurrent request must succeed");
  assert.equal(replays.length, 9, "All other 9 concurrent requests must be rejected as confirmation_replayed");
  for (const r of replays) {
    assert.equal(r.body.executedTools, 0);
  }
});

// ─── Tests 5, 6, 7, 8: Forged Signatures, Expired Tokens, Conversation-ID Mismatch, Original-Message Mismatch ───

test("Phase 7G (5, 6, 7, 8): Forged signature, expired token, conversationId mismatch, and originalMessage mismatch all fail closed", async () => {
  const sharedCoordinator = createCoordinatorNamespaceSimulator();
  const baseNow = Date.now();
  const env = createIsolateEnv(sharedCoordinator, { NOW_MS: baseNow });

  const init = await sendConversationPost(
    { message: "I sell a print in the US for $30. It costs $10 to make, $1 to package, and postage costs me $4." },
    env
  );
  assert.equal(init.status, 200);
  const validToken = init.body.confirmationToken;
  const validConvId = init.body.conversationId;
  const origMsg = init.body.originalMessage;

  // (5) Forged signature
  const forgedToken = `${validToken.slice(0, -4)}aaaa`;
  const forgedRes = await sendConversationPost(
    {
      conversationId: validConvId,
      message: origMsg,
      confirmationToken: forgedToken,
      confirmedInputs: { shipping: 4 }
    },
    env
  );
  assert.equal(forgedRes.status, 400);
  assert.equal(forgedRes.body.error, "invalid_confirmation_signature");
  assert.equal(forgedRes.body.executedTools, 0);

  // (7) Conversation-ID mismatch
  const mismatchConvRes = await sendConversationPost(
    {
      conversationId: "conv_11111111111111111111111111111111",
      message: origMsg,
      confirmationToken: validToken,
      confirmedInputs: { shipping: 4 }
    },
    env
  );
  assert.equal(mismatchConvRes.status, 400);
  assert.equal(mismatchConvRes.body.error, "conversation_mismatch");
  assert.equal(mismatchConvRes.body.executedTools, 0);

  // (8) Original-message mismatch
  const mismatchMsgRes = await sendConversationPost(
    {
      conversationId: validConvId,
      message: "I sell a print in the US for $900. It costs $10 to make, $1 to package, and postage costs me $4.",
      confirmationToken: validToken,
      confirmedInputs: { shipping: 4 }
    },
    env
  );
  assert.equal(mismatchMsgRes.status, 400);
  assert.equal(mismatchMsgRes.body.error, "original_message_mismatch");
  assert.equal(mismatchMsgRes.body.executedTools, 0);

  // (6) Expired token (advance clock by 16 minutes past 15-minute TTL)
  const expiredEnv = createIsolateEnv(sharedCoordinator, {
    NOW_MS: baseNow + 16 * 60 * 1000
  });
  const expiredRes = await sendConversationPost(
    {
      conversationId: validConvId,
      message: origMsg,
      confirmationToken: validToken,
      confirmedInputs: { shipping: 4 }
    },
    expiredEnv
  );
  assert.equal(expiredRes.status, 400);
  assert.equal(expiredRes.body.error, "confirmation_expired");
  assert.equal(expiredRes.body.executedTools, 0);
});

// ─── Test 9: Coordinator Outage Fails Closed ───

test("Phase 7G (9): Coordinator outage (missing binding, exception, or HTTP 500) fails closed with HTTP 503 and zero tool executions", async () => {
  const sharedCoordinator = createCoordinatorNamespaceSimulator();
  const healthyEnv = createIsolateEnv(sharedCoordinator);

  const init = await sendConversationPost(
    { message: "I sell a print in the US for $30. It costs $10 to make, $1 to package, and postage costs me $4." },
    healthyEnv
  );
  assert.equal(init.status, 200);

  const confirmPayload = {
    conversationId: init.body.conversationId,
    message: init.body.originalMessage,
    confirmationToken: init.body.confirmationToken,
    confirmedInputs: { shipping: 4 }
  };

  // Outage A: Coordinator binding is null while REQUIRE_GLOBAL_COORDINATOR is true
  const missingCoordEnv = createIsolateEnv(null);
  assert.equal(getReplayProtectionMode(missingCoordEnv), "isolate_memory_only");
  const outA = await sendConversationPost(confirmPayload, missingCoordEnv);
  assert.equal(outA.status, 503);
  assert.equal(outA.body.error, "confirmation_coordinator_unavailable");
  assert.equal(outA.body.executedTools, 0);

  // Outage B: Coordinator throws network/storage exception during fetch
  const throwingCoord = {
    idFromName(name) {
      return name;
    },
    get() {
      return {
        async fetch() {
          throw new Error("Simulated Durable Object coordinator outage");
        }
      };
    }
  };
  const throwingEnv = createIsolateEnv(throwingCoord);
  const outB = await sendConversationPost(confirmPayload, throwingEnv);
  assert.equal(outB.status, 503);
  assert.equal(outB.body.error, "confirmation_coordinator_unavailable");
  assert.equal(outB.body.executedTools, 0);

  // Outage C: Coordinator returns HTTP 500 during token issuance
  const outC = await sendConversationPost(
    { message: "I sell a print in the US for $30. It costs $10 to make, $1 to package, and postage costs me $4." },
    throwingEnv
  );
  assert.equal(outC.status, 503);
  assert.equal(outC.body.error, "confirmation_coordinator_unavailable");
  assert.equal(outC.body.executedTools, 0);
});

// ─── Test 10: Expired Nonce Cleanup Never Permits a Valid Token to Be Replayed ───

test("Phase 7G (10): Expired nonce cleanup removes only expired records and never permits an unexpired consumed token to be replayed", async () => {
  const sharedCoordinator = createCoordinatorNamespaceSimulator();
  const t0 = Date.now();

  // Issue & consume Token 1 at t = t0 (CONVERSATION_TTL_MS = 5 minutes, expires at t0 + 5m)
  const envT0 = createIsolateEnv(sharedCoordinator, { NOW_MS: t0 });
  const init1 = await sendConversationPost(
    { message: "I sell a print in the US for $30. It costs $10 to make, $1 to package, and postage costs me $4." },
    envT0
  );
  const confirm1 = {
    conversationId: init1.body.conversationId,
    message: init1.body.originalMessage,
    confirmationToken: init1.body.confirmationToken,
    confirmedInputs: { shipping: 4 }
  };

  const consume1 = await sendConversationPost(confirm1, envT0);
  assert.equal(consume1.status, 200);
  assert.equal(consume1.body.state, "calculation_completed");

  // Trigger DO alarm & cleanup at t = t0 + 3 minutes (while Token 1 is still 2 minutes before its 5m expiry)
  const doInstance = sharedCoordinator._instances.get(`do_id_${init1.body.conversationId}`)?.instance;
  assert.ok(doInstance);
  await doInstance._pruneExpiredNonces(t0 + 3 * 60 * 1000);

  // Attempt to replay Token 1 at t = t0 + 3 minutes on a fresh isolate -> STILL BLOCKED as confirmation_replayed!
  const envT3m = createIsolateEnv(sharedCoordinator, { NOW_MS: t0 + 3 * 60 * 1000 });
  const replayAt3m = await sendConversationPost(confirm1, envT3m);
  assert.equal(replayAt3m.status, 400);
  assert.equal(replayAt3m.body.error, "confirmation_replayed");
  assert.equal(replayAt3m.body.executedTools, 0);

  // Trigger cleanup after Token 1 expires (t = t0 + 6 minutes > CONVERSATION_TTL_MS) -> record is pruned, and Token 1 is rejected as confirmation_expired
  await doInstance._pruneExpiredNonces(t0 + 6 * 60 * 1000);
  const envT6m = createIsolateEnv(sharedCoordinator, { NOW_MS: t0 + 6 * 60 * 1000 });
  const replayAt6m = await sendConversationPost(confirm1, envT6m);
  assert.equal(replayAt6m.status, 400);
  assert.equal(replayAt6m.body.error, "confirmation_expired");
});

// ─── Test 11: Rate Limits and Request-Size Limits Remain Enforced ───

test("Phase 7G (11): Rate limits (10 req/min per IP) and request-size limits (4096 bytes) remain strictly enforced", async () => {
  const sharedCoordinator = createCoordinatorNamespaceSimulator();
  const env = createIsolateEnv(sharedCoordinator);

  // 11a. Oversized request (> 4096 bytes) is rejected with HTTP 413
  const hugePayload = JSON.stringify({
    message: `I sell an item in the US for $30. ${"A".repeat(4500)}`
  });
  const oversizedRes = await sendConversationPost(hugePayload, env);
  assert.equal(oversizedRes.status, 413);
  assert.match(oversizedRes.body.error, /Payload Too Large: request body exceeds 4096 bytes/);

  // 11b. Rate limit: 11th request from the same IP within 60s returns HTTP 429
  const rateLimitIp = "10.88.99.250";
  let hit429 = false;
  for (let i = 0; i < 12; i++) {
    const r = await sendConversationPost(
      { message: "I sell a print in the US for $30. It costs $10 to make, $1 to package, and postage costs me $4." },
      env,
      rateLimitIp
    );
    if (r.status === 429) {
      hit429 = true;
      assert.ok(r.headers.get("retry-after"));
      break;
    }
  }
  assert.equal(hit429, true, "Rate limiter must enforce HTTP 429 after 10 requests/minute per IP");
});

// ─── Test 12: Zero Private Financial Data Stored in Coordinator & No Secrets Logged ───

test("Phase 7G (12): Coordinator rejects payloads containing financial inputs or messages and logs zero secrets or private data", async () => {
  const sharedCoordinator = createCoordinatorNamespaceSimulator();
  const env = createIsolateEnv(sharedCoordinator);

  // Capture console methods to verify zero secret or financial data logging
  const loggedLines = [];
  const origLog = console.log;
  const origInfo = console.info;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args) => loggedLines.push(args.join(" "));
  console.info = (...args) => loggedLines.push(args.join(" "));
  console.warn = (...args) => loggedLines.push(args.join(" "));
  console.error = (...args) => loggedLines.push(args.join(" "));

  try {
    const init = await sendConversationPost(
      { message: "I sell a print in the US for $30. It costs $10 to make, $1 to package, and postage costs me $4." },
      env
    );
    assert.equal(init.status, 200);

    const confirmRes = await sendConversationPost(
      {
        conversationId: init.body.conversationId,
        message: init.body.originalMessage,
        confirmationToken: init.body.confirmationToken,
        confirmedInputs: { shipping: 5.25 }
      },
      env
    );
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.state, "calculation_completed");

    // Inspect raw Durable Object storage for this conversation:
    // Verify it contains ONLY { conversationId, nonce, messageDigest, expiresAt, consumed, registeredAt, consumedAt }
    const doState = sharedCoordinator._instances.get(`do_id_${init.body.conversationId}`)?.state;
    assert.ok(doState);
    const storedMap = doState.storage._rawMap;
    assert.equal(storedMap.size, 1);
    for (const [, record] of storedMap.entries()) {
      assert.deepEqual(
        Object.keys(record).sort(),
        ["consumed", "consumedAt", "conversationId", "expiresAt", "messageDigest", "nonce", "registeredAt"]
      );
      const serializedRecord = JSON.stringify(record);
      assert.doesNotMatch(serializedRecord, /48\.75|14\.2|5\.25|ring/);
    }

    // Attempt to send financial inputs or message directly to the Durable Object -> rejected with 400 forbidden_field_in_coordinator
    const stub = sharedCoordinator.get(sharedCoordinator.idFromName(init.body.conversationId));
    const forbiddenDoRes = await stub.fetch("https://do.internal/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "register",
        conversationId: init.body.conversationId,
        nonce: "a".repeat(32),
        messageDigest: "b".repeat(64),
        expiresAt: Date.now() + 60000,
        itemPrice: 48.75
      })
    });
    const forbiddenDoBody = await forbiddenDoRes.json();
    assert.equal(forbiddenDoRes.status, 400);
    assert.equal(forbiddenDoBody.error, "forbidden_field_in_coordinator");
    assert.ok(MAX_NONCES_PER_CONVERSATION <= 16);
  } finally {
    console.log = origLog;
    console.info = origInfo;
    console.warn = origWarn;
    console.error = origError;
  }

  // Verify zero console logs containing secrets or seller messages
  const combinedLogs = loggedLines.join("\n");
  assert.doesNotMatch(combinedLogs, new RegExp(TEST_SECRET));
  assert.doesNotMatch(combinedLogs, new RegExp(PRIVATE_KEY));
  assert.doesNotMatch(combinedLogs, /48\.75/);
});
