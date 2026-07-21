const {
  classifyStructuredFailure,
  hasStructuredExhaustion,
} = require("../quality-provider-error");

describe("structured provider failure classification", () => {
  it("accepts typed exhaustion only on provider error events", () => {
    expect(
      hasStructuredExhaustion(
        '{"type":"error","error":{"status":429,"code":"rate_limit_exceeded"}}\n',
      ),
    ).toBe(true);
  });

  it("ignores review payload and tool output containing quota vocabulary", () => {
    const events = [
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          aggregated_output:
            'provider_exhausted() { grep "429|quota exhausted"; }',
        },
      },
      {
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "The changed source contains line 429 and a quota handler.",
        },
      },
      { type: "turn.failed", error: { code: "internal_error" } },
    ];
    expect(
      hasStructuredExhaustion(
        events.map((event) => JSON.stringify(event)).join("\n"),
      ),
    ).toBe(false);
  });

  it("does not guess from unstructured stderr", () => {
    expect(
      hasStructuredExhaustion(
        "HTTP 429: quota exhausted\nreview prompt line 429\n",
      ),
    ).toBe(false);
  });

  it("preserves a typed reset time for actionable recovery", () => {
    expect(
      classifyStructuredFailure(
        '{"type":"error","error":{"status":429,"code":"rate_limit_exceeded","reset_at":"2026-07-20T03:00:00Z"}}\n',
      ),
    ).toMatchObject({
      category: "provider-exhaustion",
      resetAt: "2026-07-20T03:00:00.000Z",
    });
  });

  it("accepts a formatted CLI error envelope as structured metadata", () => {
    expect(
      classifyStructuredFailure(
        JSON.stringify(
          {
            is_error: true,
            error: {
              status: 429,
              code: "rate_limit_exceeded",
              reset_at: "2026-07-20T03:00:00Z",
            },
          },
          null,
          2,
        ),
      ),
    ).toMatchObject({
      category: "provider-exhaustion",
      resetAt: "2026-07-20T03:00:00.000Z",
    });
  });

  it("recognizes Claude's successful-process API error envelope", () => {
    expect(
      classifyStructuredFailure(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: true,
          api_error_status: 429,
          result: "session limit",
        }),
      ),
    ).toEqual({ category: "provider-exhaustion", resetAt: null });
  });

  it("recognizes Gemini's root API error envelope", () => {
    expect(
      classifyStructuredFailure(
        JSON.stringify({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "Quota exhausted.",
          },
        }),
      ),
    ).toEqual({ category: "provider-exhaustion", resetAt: null });
  });

  it("recognizes Codex's structured usage-limit message after warning events", () => {
    const events = [
      {
        type: "error",
        message: "Under-development features enabled: runtime_metrics.",
      },
      {
        type: "error",
        message:
          "You've hit your usage limit. Purchase more credits or try again at Jul 25th, 2026 10:57 AM.",
      },
      {
        type: "turn.failed",
        error: {
          message:
            "You've hit your usage limit. Purchase more credits or try again at Jul 25th, 2026 10:57 AM.",
        },
      },
    ];
    expect(
      classifyStructuredFailure(
        events.map((event) => JSON.stringify(event)).join("\n"),
      ),
    ).toMatchObject({
      category: "provider-exhaustion",
      resetAt: expect.stringMatching(/^2026-07-25T/),
    });
  });

  it("does not infer recovery metadata from successful review text", () => {
    expect(
      classifyStructuredFailure(
        '{"type":"item.completed","item":{"text":"HTTP 429; reset_at 2026-07-20"}}\n',
      ),
    ).toBeNull();
  });

  it("classifies typed billing failure separately from exhaustion", () => {
    expect(
      classifyStructuredFailure(
        '{"type":"error","error":{"status":402,"code":"payment_required"}}\n',
      ),
    ).toEqual({ category: "provider-billing", resetAt: null });
  });
});
