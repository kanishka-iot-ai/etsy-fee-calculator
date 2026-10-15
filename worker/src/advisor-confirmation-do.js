/**
 * ShopProfit — Phase 7G Durable Object Confirmation Nonce Coordinator
 *
 * PURPOSE:
 * Provides globally strongly consistent, atomic single-use confirmation token
 * nonce consumption per `conversationId` across distributed Worker isolates.
 *
 * SECURITY & PRIVACY GUARANTEES:
 * 1. Atomic Single-Use Enforcement: Serializes all operations per conversationId
 *    so concurrent replay attempts across multiple Worker isolates allow at most
 *    ONE successful consumption.
 * 2. Cryptographic Binding: Binds each nonce to `conversationId`, `messageDigest`
 *    (SHA-256 of the original seller message), and `expiresAt`.
 * 3. Zero PII / Zero Financial Data Stored: Never accepts or stores seller financial
 *    inputs (`itemPrice`, `shipping`, `production`, `confirmedInputs`, etc.) or full
 *    seller messages. Any request containing extra/sensitive fields is rejected.
 * 4. Safe Expiry & Bounded Storage: Consumed nonces are retained until at least
 *    their token's `expiresAt` timestamp. Pruning only removes records where
 *    `expiresAt <= now` (when the token itself is already expired), guaranteeing
 *    that cleanup never permits a still-valid token to be replayed.
 * 5. Fail-Closed Capacity: Bounds nonces per conversation (`MAX_NONCES_PER_CONVERSATION = 16`)
 *    and fails closed rather than evicting unexpired consumed nonces.
 */

export const MAX_NONCES_PER_CONVERSATION = 16;
export const MAX_COORDINATOR_TTL_MS = 15 * 60 * 1000; // 15 minutes max token lifetime

const CONVERSATION_ID_RE = /^conv_[a-f0-9]{32}$/;
const NONCE_HEX_RE = /^[a-f0-9]{32,64}$/;
const DIGEST_HEX_RE = /^[a-f0-9]{64}$/;

const ALLOWED_COORDINATOR_KEYS = new Set([
  "action",
  "conversationId",
  "nonce",
  "messageDigest",
  "turnCount",
  "expiresAt",
  "now"
]);

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

/**
 * Cloudflare Durable Object class for atomic confirmation-token nonce coordination.
 *
 * NOTE: Not deployed to production automatically in Phase 7G. See deployment plan
 * for isolated Durable Object migration and binding configuration.
 */
export class AdvisorConfirmationCoordinatorDO {
  constructor(state, env = {}) {
    this.state = state;
    this.env = env;
    this._mutex = Promise.resolve();
  }

  /**
   * Serializes all state transitions within the Durable Object instance so that
   * concurrent requests across separate Worker isolates execute strictly one-at-a-time.
   */
  _runExclusive(fn) {
    const run = async () => {
      if (typeof this.state?.blockConcurrencyWhile === "function") {
        return this.state.blockConcurrencyWhile(fn);
      }
      return fn();
    };
    const next = this._mutex.then(run, run);
    this._mutex = next.catch(() => {});
    return next;
  }

  async _pruneExpiredNonces(now) {
    const entries = await this.state.storage.list({ prefix: "nonce:" });
    const expiredKeys = [];
    let activeCount = 0;

    for (const [key, record] of entries.entries()) {
      if (!record || typeof record.expiresAt !== "number" || now >= record.expiresAt) {
        expiredKeys.push(key);
      } else {
        activeCount += 1;
      }
    }

    if (expiredKeys.length > 0) {
      await this.state.storage.delete(expiredKeys);
    }

    return activeCount;
  }

  async fetch(request) {
    if (request.method !== "POST") {
      return jsonResponse(405, {
        ok: false,
        error: "method_not_allowed",
        message: "Coordinator only accepts POST requests"
      });
    }

    let payload;
    try {
      const rawText = await request.text();
      if (rawText.length > 1024) {
        return jsonResponse(413, {
          ok: false,
          error: "coordinator_payload_too_large",
          message: "Coordinator payload exceeds 1024 bytes"
        });
      }
      payload = JSON.parse(rawText);
    } catch {
      return jsonResponse(400, {
        ok: false,
        error: "invalid_coordinator_json",
        message: "Coordinator request body must be valid JSON"
      });
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return jsonResponse(400, {
        ok: false,
        error: "invalid_coordinator_payload",
        message: "Coordinator payload must be a plain JSON object"
      });
    }

    // Strict allowlist check: reject any attempt to store financial inputs or seller messages
    for (const key of Object.keys(payload)) {
      if (!ALLOWED_COORDINATOR_KEYS.has(key)) {
        return jsonResponse(400, {
          ok: false,
          error: "forbidden_field_in_coordinator",
          message: `Coordinator refuses to accept field '${String(key).slice(0, 32)}' (no financial inputs or messages permitted)`
        });
      }
    }

    const { action, conversationId, nonce, messageDigest, expiresAt } = payload;
    const now = Number.isFinite(Number(payload.now)) ? Number(payload.now) : Date.now();

    if (action !== "register" && action !== "consume") {
      return jsonResponse(400, {
        ok: false,
        error: "invalid_coordinator_action",
        message: "Action must be 'register' or 'consume'"
      });
    }

    if (typeof conversationId !== "string" || !CONVERSATION_ID_RE.test(conversationId)) {
      return jsonResponse(400, {
        ok: false,
        error: "invalid_conversation_id",
        message: "Invalid conversationId format"
      });
    }

    if (typeof nonce !== "string" || !NONCE_HEX_RE.test(nonce)) {
      return jsonResponse(400, {
        ok: false,
        error: "invalid_confirmation_nonce",
        message: "Invalid confirmation nonce format"
      });
    }

    if (typeof messageDigest !== "string" || !DIGEST_HEX_RE.test(messageDigest)) {
      return jsonResponse(400, {
        ok: false,
        error: "invalid_message_digest",
        message: "Invalid SHA-256 message digest format"
      });
    }

    if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
      return jsonResponse(400, {
        ok: false,
        error: "invalid_expiration",
        message: "Invalid token expiration timestamp"
      });
    }

    if (now >= expiresAt) {
      return jsonResponse(400, {
        ok: false,
        error: "confirmation_expired",
        message: "Confirmation token has expired"
      });
    }

    if (expiresAt - now > MAX_COORDINATOR_TTL_MS + 5000) {
      return jsonResponse(400, {
        ok: false,
        error: "expiration_exceeds_max_ttl",
        message: "Confirmation token TTL exceeds maximum allowed window"
      });
    }

    return this._runExclusive(async () => {
      // 1. Prune only strictly expired nonces (where now >= record.expiresAt).
      // Because any valid token has now < expiresAt, pruning expired nonces can NEVER
      // delete a consumed record for a token that is still within its validity window.
      const activeCount = await this._pruneExpiredNonces(now);
      const storageKey = `nonce:${nonce}`;
      const existing = await this.state.storage.get(storageKey);

      if (action === "register") {
        if (existing) {
          return jsonResponse(409, {
            ok: false,
            error: "nonce_already_exists",
            message: "Confirmation nonce is already registered"
          });
        }
        if (activeCount >= MAX_NONCES_PER_CONVERSATION) {
          return jsonResponse(429, {
            ok: false,
            error: "nonce_capacity_exceeded",
            message: "Maximum confirmation nonces reached for this conversation"
          });
        }

        const record = {
          conversationId,
          nonce,
          messageDigest,
          expiresAt,
          consumed: false,
          registeredAt: now,
          consumedAt: null
        };
        await this.state.storage.put(storageKey, record);
        if (typeof this.state.storage.setAlarm === "function") {
          await this.state.storage.setAlarm(expiresAt);
        }

        return jsonResponse(200, {
          ok: true,
          status: "registered",
          conversationId,
          nonce,
          expiresAt
        });
      }

      // action === "consume"
      if (existing) {
        // Verify binding invariants before checking consumed state
        if (
          existing.conversationId !== conversationId ||
          existing.messageDigest !== messageDigest ||
          existing.expiresAt !== expiresAt
        ) {
          return jsonResponse(400, {
            ok: false,
            error: "nonce_binding_mismatch",
            message: "Confirmation nonce binding does not match conversation, message digest, or expiration"
          });
        }

        if (existing.consumed === true) {
          return jsonResponse(409, {
            ok: false,
            error: "confirmation_replayed",
            message: "Confirmation token has already been used and cannot be replayed"
          });
        }
      } else if (activeCount >= MAX_NONCES_PER_CONVERSATION) {
        // Fail closed if capacity is reached; never evict unexpired consumed nonces
        return jsonResponse(429, {
          ok: false,
          error: "nonce_capacity_exceeded",
          message: "Maximum confirmation nonces reached for this conversation"
        });
      }

      const consumedRecord = {
        conversationId,
        nonce,
        messageDigest,
        expiresAt,
        consumed: true,
        registeredAt: existing?.registeredAt ?? now,
        consumedAt: now
      };
      await this.state.storage.put(storageKey, consumedRecord);
      if (typeof this.state.storage.setAlarm === "function") {
        await this.state.storage.setAlarm(expiresAt);
      }

      return jsonResponse(200, {
        ok: true,
        status: "consumed",
        conversationId,
        nonce,
        expiresAt
      });
    });
  }

  async alarm() {
    await this._runExclusive(async () => {
      await this._pruneExpiredNonces(Date.now());
    });
  }
}

/**
 * Creates an in-memory DurableObjectState mock that implements Cloudflare's
 * transactional storage API (`get`, `put`, `delete`, `list`, `setAlarm`, `blockConcurrencyWhile`)
 * for local harness and multi-isolate simulation testing.
 */
export function createLocalDurableObjectState() {
  const map = new Map();
  let currentAlarm = null;
  let lock = Promise.resolve();

  const storage = {
    async get(key) {
      const val = map.get(key);
      return val !== undefined ? structuredClone(val) : undefined;
    },
    async put(key, value) {
      map.set(key, structuredClone(value));
    },
    async delete(keyOrKeys) {
      if (Array.isArray(keyOrKeys)) {
        let count = 0;
        for (const k of keyOrKeys) {
          if (map.delete(k)) count += 1;
        }
        return count;
      }
      return map.delete(keyOrKeys);
    },
    async list(options = {}) {
      const prefix = typeof options.prefix === "string" ? options.prefix : "";
      const out = new Map();
      for (const [k, v] of map.entries()) {
        if (k.startsWith(prefix)) {
          out.set(k, structuredClone(v));
        }
      }
      return out;
    },
    async setAlarm(timestampMs) {
      currentAlarm = timestampMs;
    },
    getAlarm() {
      return currentAlarm;
    },
    _rawMap: map
  };

  return {
    storage,
    blockConcurrencyWhile(fn) {
      const next = lock.then(fn, fn);
      lock = next.catch(() => {});
      return next;
    }
  };
}

/**
 * Creates a Cloudflare-compatible `DurableObjectNamespace` simulator (`idFromName`, `get`)
 * that can be shared across simulated separate Worker isolates (`isolateAEnv`, `isolateBEnv`)
 * to test cross-isolate and concurrent atomic nonce consumption locally without mutating
 * production Cloudflare configuration.
 */
export function createCoordinatorNamespaceSimulator() {
  const instances = new Map();

  return {
    idFromName(name) {
      return {
        toString() {
          return `do_id_${String(name)}`;
        },
        name: String(name)
      };
    },
    get(id) {
      const key = typeof id === "object" && id !== null ? id.toString() : String(id);
      let entry = instances.get(key);
      if (!entry) {
        const state = createLocalDurableObjectState();
        const instance = new AdvisorConfirmationCoordinatorDO(state);
        entry = { state, instance };
        instances.set(key, entry);
      }
      return {
        fetch(requestOrUrl, init) {
          const req =
            requestOrUrl instanceof Request
              ? requestOrUrl
              : new Request(String(requestOrUrl), init);
          return entry.instance.fetch(req);
        }
      };
    },
    _instances: instances
  };
}
