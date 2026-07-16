const { hasStructuredExhaustion } = require("../quality-provider-error");

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
});
