/**
 * ShopProfit — Phase 7F Private Conversational AI Advisor Interface Controller
 *
 * SECURITY & ISOLATION GUARANTEES:
 * - Private test interface controller only. Never imported by src/app.js or index.html.
 * - Zero AI credentials, account IDs, or HMAC secrets in browser code.
 * - All model inference, HMAC token verification, input-integrity validation,
 *   and financial calculations execute server-side in the private test harness.
 * - Preserves original seller message across clarification turns and allows
 *   sellers to edit or correct extracted values before explicit confirmation.
 */

import {
  SUPPORTED_COUNTRIES,
  FIELD_LABELS,
  buildConfirmationPayloadFromForm,
  buildFollowUpScenarios
} from "./advisor-client.js";

export {
  SUPPORTED_COUNTRIES,
  FIELD_LABELS,
  buildConfirmationPayloadFromForm,
  buildFollowUpScenarios
};

/**
 * Creates a stateful private advisor UI controller that manages:
 * - Conversation transcript history
 * - Loading, error, and retry states
 * - Pending clarification / confirmation state (preserving originalMessage & confirmationToken)
 * - Editable field overrides for unresolved, ambiguous, or corrected values
 *
 * @param {Object} options
 * @param {Function} options.sendRequest - Async function `(payload, headers) => Promise<{ status: number, body: Object }>`
 * @param {string} [options.privateKey] - Optional private prototype Bearer key
 * @param {Function} [options.onStateChange] - Optional callback invoked on every state update
 */
export function createPrivateAdvisorController(options = {}) {
  if (typeof options.sendRequest !== "function") {
    throw new TypeError("createPrivateAdvisorController requires a sendRequest function");
  }

  let state = {
    conversationId: null,
    loading: false,
    error: null,
    lastFailedAction: null,
    transcript: [],
    pendingClarification: null,
    editableFields: {},
    lastCompletedResult: null,
    lastMarketIntelligence: null,
    followUpScenarios: []
  };

  function notify() {
    if (typeof options.onStateChange === "function") {
      options.onStateChange(getState());
    }
  }

  function getState() {
    return {
      ...state,
      transcript: [...state.transcript],
      editableFields: { ...state.editableFields },
      followUpScenarios: [...state.followUpScenarios]
    };
  }

  function populateEditableFieldsFromResponse(body) {
    const candidateArgs = body?.candidateExtraction?.arguments || {};
    const tool = body?.candidateExtraction?.tool || body?.tool || null;

    const nextFields = {
      tool,
      country: candidateArgs.country ?? "",
      itemPrice: candidateArgs.itemPrice ?? "",
      shipping: candidateArgs.shipping ?? "",
      freeShipping: candidateArgs.freeShipping === true,
      production: candidateArgs.production ?? "",
      confirmZeroProduction: candidateArgs.isDigital === true,
      packaging: candidateArgs.packaging ?? "",
      shippingCost: candidateArgs.shippingCost ?? "",
      targetProfit: candidateArgs.targetProfit ?? "",
      targetMarginPct:
        typeof candidateArgs.targetMarginPct === "number"
          ? candidateArgs.targetMarginPct > 0 && candidateArgs.targetMarginPct < 1
            ? Math.round(candidateArgs.targetMarginPct * 10000) / 100
            : candidateArgs.targetMarginPct
          : "",
      orderType: candidateArgs.orderType ?? "domestic",
      offsiteAds: Boolean(candidateArgs.offsiteAds),
      offsiteRate: candidateArgs.offsiteRate ?? ""
    };

    const unresolvedSet = new Set([
      ...(body.missingFields || []),
      ...(body.ambiguousFields || []),
      ...(body.modelAssumptions || [])
    ]);
    if (unresolvedSet.has("shipping") && !nextFields.freeShipping && nextFields.shipping === 0) {
      nextFields.shipping = "";
    }
    if (unresolvedSet.has("production") && !nextFields.confirmZeroProduction && nextFields.production === 0) {
      nextFields.production = "";
    }

    return nextFields;
  }

  async function executeRequest(payload, retryDescriptor) {
    state = {
      ...state,
      loading: true,
      error: null
    };
    notify();

    const headers = {
      "Content-Type": "application/json"
    };
    if (typeof options.privateKey === "string" && options.privateKey.trim().length > 0) {
      headers.Authorization = `Bearer ${options.privateKey.trim()}`;
    }

    try {
      const response = await options.sendRequest(payload, headers);
      const body = response?.body || {};
      const bodyState = body.state || body.status || null;

      if (body.conversationId) {
        state.conversationId = body.conversationId;
      }

      if (!response || response.status >= 400 || body.ok === false) {
        const errMessage =
          body.message ||
          body.explanation ||
          `Request failed with status ${response ? response.status : "unknown"}`;
        state = {
          ...state,
          loading: false,
          error: {
            code: body.error || body.reason || "request_failed",
            status: response?.status || 500,
            message: errMessage
          },
          lastFailedAction: retryDescriptor
        };
        state.transcript.push({
          id: `turn-${state.transcript.length + 1}`,
          role: "system_error",
          status: bodyState || "rejected",
          error: body.error || body.reason || "request_failed",
          text: errMessage,
          timestamp: new Date().toISOString()
        });
        notify();
        return getState();
      }

      if (bodyState === "needs_clarification" || bodyState === "awaiting_confirmation") {
        const editableFields = populateEditableFieldsFromResponse(body);
        const preservedOriginalMessage = body.originalMessage || payload.message || "";
        state = {
          ...state,
          loading: false,
          error: null,
          lastFailedAction: null,
          lastMarketIntelligence: body.marketIntelligence || state.lastMarketIntelligence || null,
          pendingClarification: {
            conversationId: body.conversationId,
            originalMessage: preservedOriginalMessage,
            confirmationToken: body.confirmationToken,
            clarificationQuestion: body.clarificationQuestion,
            missingFields: body.missingFields || [],
            ambiguousFields: body.ambiguousFields || [],
            modelAssumptions: body.modelAssumptions || [],
            candidateExtraction: body.candidateExtraction || null,
            provenance: body.provenance || {},
            marketIntelligence: body.marketIntelligence || null
          },
          editableFields
        };
        state.transcript.push({
          id: `turn-${state.transcript.length + 1}`,
          role: "assistant",
          status: bodyState,
          text: body.explanation || body.clarificationQuestion || body.message,
          missingFields: body.missingFields || [],
          ambiguousFields: body.ambiguousFields || [],
          modelAssumptions: body.modelAssumptions || [],
          originalMessage: preservedOriginalMessage,
          marketIntelligence: body.marketIntelligence || null,
          timestamp: new Date().toISOString()
        });
        notify();
        return getState();
      }

      if (bodyState === "calculation_completed") {
        const normalizedCompleted = {
          ...body,
          status: "calculation_completed",
          state: "calculation_completed",
          calculation: body.result || body.calculation || null,
          marketIntelligence: body.marketIntelligence || null
        };
        const followUps = buildFollowUpScenarios(normalizedCompleted);
        state = {
          ...state,
          loading: false,
          error: null,
          lastFailedAction: null,
          pendingClarification: null,
          lastCompletedResult: normalizedCompleted,
          lastMarketIntelligence: body.marketIntelligence || null,
          followUpScenarios: followUps
        };
        state.transcript.push({
          id: `turn-${state.transcript.length + 1}`,
          role: "assistant",
          status: "calculation_completed",
          tool: body.tool,
          text: body.explanation || body.message,
          verifiedArguments: body.verifiedArguments,
          provenance: body.provenance,
          calculation: normalizedCompleted.calculation,
          marketIntelligence: body.marketIntelligence || null,
          timestamp: new Date().toISOString()
        });
        notify();
        return getState();
      }

      // Refused or temporarily_unavailable states (e.g. prompt injection refusal, AI timeout fallback)
      const isTemporaryUnavailable =
        bodyState === "temporarily_unavailable" || bodyState === "ai_unavailable";
      const displayMsg = body.explanation || body.message || "Unable to complete calculation.";
      state = {
        ...state,
        loading: false,
        error: isTemporaryUnavailable
          ? {
              code: body.reason || "temporarily_unavailable",
              status: response?.status || 200,
              message: displayMsg
            }
          : null,
        lastFailedAction: isTemporaryUnavailable ? retryDescriptor : null,
        pendingClarification: null,
        lastMarketIntelligence: body.marketIntelligence || null
      };
      state.transcript.push({
        id: `turn-${state.transcript.length + 1}`,
        role: "assistant",
        status: bodyState || "refused",
        reason: body.reason || null,
        text: displayMsg,
        fallback: body.fallback || null,
        marketIntelligence: body.marketIntelligence || null,
        timestamp: new Date().toISOString()
      });
      notify();
      return getState();
    } catch (err) {
      const netMessage =
        err instanceof Error ? err.message : "Network error while contacting private advisor endpoint.";
      state = {
        ...state,
        loading: false,
        error: {
          code: "network_error",
          status: 0,
          message: netMessage
        },
        lastFailedAction: retryDescriptor
      };
      state.transcript.push({
        id: `turn-${state.transcript.length + 1}`,
        role: "system_error",
        status: "network_error",
        error: "network_error",
        text: netMessage,
        timestamp: new Date().toISOString()
      });
      notify();
      return getState();
    }
  }

  async function submitQuestion(messageText) {
    const trimmed = typeof messageText === "string" ? messageText.trim() : "";
    if (!trimmed) {
      state = {
        ...state,
        error: {
          code: "empty_message",
          status: 400,
          message: "Please enter a pricing or profit question before sending."
        }
      };
      notify();
      return getState();
    }

    state.transcript.push({
      id: `turn-${state.transcript.length + 1}`,
      role: "seller",
      type: "question",
      text: trimmed,
      timestamp: new Date().toISOString()
    });

    const payload = {
      message: trimmed
    };

    return executeRequest(payload, { type: "question", payload });
  }

  function updateEditableField(fieldName, value) {
    state = {
      ...state,
      editableFields: {
        ...state.editableFields,
        [fieldName]: value
      },
      error: null
    };
    notify();
    return getState();
  }

  async function submitConfirmation(customOverrides = null) {
    if (!state.pendingClarification) {
      state = {
        ...state,
        error: {
          code: "no_pending_confirmation",
          status: 400,
          message: "There is no pending clarification or confirmation to submit."
        }
      };
      notify();
      return getState();
    }

    const mergedForm = customOverrides
      ? { ...state.editableFields, ...customOverrides }
      : { ...state.editableFields };

    const built = buildConfirmationPayloadFromForm(mergedForm);
    if (!built.ok) {
      state = {
        ...state,
        error: {
          code: "invalid_form_input",
          status: 400,
          message: built.error
        }
      };
      notify();
      return getState();
    }

    const { conversationId, originalMessage, confirmationToken } = state.pendingClarification;
    state.transcript.push({
      id: `turn-${state.transcript.length + 1}`,
      role: "seller",
      type: "confirmation",
      text: `Confirmed inputs: ${JSON.stringify(built.confirmedInputs)}`,
      confirmedInputs: built.confirmedInputs,
      timestamp: new Date().toISOString()
    });

    const payload = {
      conversationId,
      message: originalMessage,
      confirmationToken,
      confirmedInputs: built.confirmedInputs
    };

    return executeRequest(payload, { type: "confirmation", payload });
  }

  async function retryLastAction() {
    if (!state.lastFailedAction) {
      return getState();
    }
    const { payload, type } = state.lastFailedAction;
    return executeRequest(payload, { type, payload });
  }

  function resetConversation() {
    state = {
      conversationId: null,
      loading: false,
      error: null,
      lastFailedAction: null,
      transcript: [],
      pendingClarification: null,
      editableFields: {},
      lastCompletedResult: null,
      lastMarketIntelligence: null,
      followUpScenarios: []
    };
    notify();
    return getState();
  }

  return Object.freeze({
    getState,
    submitQuestion,
    updateEditableField,
    submitConfirmation,
    retryLastAction,
    resetConversation
  });
}
