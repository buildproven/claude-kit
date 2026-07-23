const {
  reconcilePr,
  remainingBudget,
  planPanel,
  planBatch,
} = require("../merge-train-batch");

const sha = (character) => character.repeat(40);

describe("merge-train batch controller", () => {
  it("requires a fresh exact-HEAD review when either the PR code or base moved", () => {
    expect(
      reconcilePr(
        { number: 42, headSha: sha("a"), baseSha: sha("b") },
        { number: 42, headSha: sha("a"), baseSha: sha("c") },
      ),
    ).toMatchObject({
      changed: { head: false, base: true },
      requiresFreshReview: true,
    });
    expect(
      reconcilePr(
        { number: 42, headSha: sha("a"), baseSha: sha("b") },
        { number: 42, headSha: sha("c"), baseSha: sha("b") },
      ),
    ).toMatchObject({
      changed: { head: true, base: false },
      requiresFreshReview: true,
    });
  });

  it("shares one batch clock instead of granting every PR a new campaign budget", () => {
    const plan = planBatch({
      startedAtEpoch: 1_000,
      budgetSeconds: 600,
      nowEpoch: 1_100,
      candidates: [
        {
          discovered: { number: 1, headSha: sha("a"), baseSha: sha("b") },
          current: { number: 1, headSha: sha("a"), baseSha: sha("b") },
          tier: "high",
          fullAgents: 4,
          reviewSeconds: 300,
        },
        {
          discovered: { number: 2, headSha: sha("c"), baseSha: sha("b") },
          current: { number: 2, headSha: sha("c"), baseSha: sha("b") },
          tier: "high",
          fullAgents: 4,
          reviewSeconds: 300,
        },
      ],
    });
    expect(plan.candidates[0].panel).toMatchObject({
      action: "start",
      incomplete: false,
    });
    expect(plan.candidates[1].panel).toMatchObject({
      action: "start",
      incomplete: true,
      selectedAgents: 2,
    });
    expect(plan.remainingSeconds).toBe(50);
    expect(
      remainingBudget({ startedAtEpoch: 1_000, budgetSeconds: 600 }, 1_100),
    ).toBe(500);
  });

  it("refuses a critical panel that cannot finish its full planned review", () => {
    expect(
      planPanel({
        tier: "critical",
        fullAgents: 6,
        reviewSeconds: 540,
        remainingSeconds: 539,
      }),
    ).toMatchObject({
      action: "defer",
      reason: "critical-panel-cannot-finish-within-batch-budget",
      minimumSeconds: 540,
    });
  });

  it("makes a deliberate reduced panel visible instead of pretending it was full", () => {
    expect(
      planPanel({
        tier: "high",
        fullAgents: 5,
        reviewSeconds: 300,
        remainingSeconds: 190,
      }),
    ).toMatchObject({
      action: "start",
      reason: "reduced-panel-fits-batch-budget",
      selectedAgents: 3,
      fullAgents: 5,
      reservedSeconds: 180,
      incomplete: true,
    });
  });
});
