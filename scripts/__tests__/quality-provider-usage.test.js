const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  claudeUsageFile,
  codexUsageFile,
  reviewUsage,
  validUsage,
} = require("../quality-provider-usage");

describe("quality provider usage", () => {
  let directory;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "quality-usage-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("extracts exact Codex turn usage without double-counting cached input", () => {
    const file = path.join(directory, "codex-1.progress");
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 100,
            cached_input_tokens: 80,
            cache_write_input_tokens: 5,
            output_tokens: 20,
            reasoning_output_tokens: 7,
          },
        }),
      ].join("\n"),
    );

    expect(codexUsageFile(file)).toEqual([
      {
        schemaVersion: 1,
        source: "codex-cli",
        inputTokens: 100,
        cachedInputTokens: 80,
        cacheWriteInputTokens: 5,
        outputTokens: 20,
        reasoningOutputTokens: 7,
        totalTokens: 120,
      },
    ]);
  });

  it("extracts the allowlisted Claude usage envelope", () => {
    const file = path.join(directory, "code-reviewer.result.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        result: "untrusted generated text",
        usage: {
          input_tokens: 40,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 2,
          output_tokens: 10,
        },
      }),
    );

    expect(claudeUsageFile(file)).toEqual([
      expect.objectContaining({
        source: "claude-cli",
        inputTokens: 40,
        cachedInputTokens: 30,
        cacheWriteInputTokens: 2,
        outputTokens: 10,
        totalTokens: 50,
      }),
    ]);
  });

  it("aggregates exact samples and reports reviews with missing usage", () => {
    fs.writeFileSync(
      path.join(directory, "codex-1.progress"),
      `${JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 12, output_tokens: 3 },
      })}\n`,
    );
    const missingDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "quality-usage-missing-"),
    );
    try {
      const result = reviewUsage({
        reviews: [
          { status: "success", provider: "codex", artifactDir: directory },
          {
            status: "success",
            provider: "codex",
            artifactDir: missingDirectory,
          },
        ],
      });
      expect(result).toMatchObject({
        reviewsWithUsage: 1,
        reviewCount: 2,
        usage: { totalTokens: 15, samples: 1 },
      });
      expect(validUsage(result.usage, { aggregate: true })).toBe(true);
    } finally {
      fs.rmSync(missingDirectory, { recursive: true, force: true });
    }
  });

  it("rejects malformed or symlinked usage evidence", () => {
    const target = path.join(directory, "target");
    fs.writeFileSync(
      target,
      `${JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 1, output_tokens: 1 },
      })}\n`,
    );
    const link = path.join(directory, "codex-1.progress");
    fs.symlinkSync(target, link);
    expect(codexUsageFile(link)).toEqual([]);
    expect(
      validUsage({
        schemaVersion: 1,
        source: "codex-cli",
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 1,
        reasoningOutputTokens: 0,
        totalTokens: 99,
      }),
    ).toBe(false);
  });
});
