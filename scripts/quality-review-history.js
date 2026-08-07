"use strict";

const COVERED_STATUSES = new Set([
  "success",
  "advisory",
  "exempt",
  "incomplete",
]);
const COMPLETED_STATUSES = new Set(["success", "advisory", "exempt"]);

function coveredReviews(manifest) {
  return (manifest.reviews || []).filter((review) =>
    COVERED_STATUSES.has(review.status),
  );
}

function completedReviews(manifest) {
  return coveredReviews(manifest).filter(
    (review) =>
      COMPLETED_STATUSES.has(review.status) ||
      (review.status === "incomplete" && !isRetryableIncomplete(review)),
  );
}

function sameRange(left, right) {
  return left.from === right.from && left.to === right.to;
}

function isRetryableIncomplete(review) {
  return (
    review.status === "incomplete" && review.provider === "review-incomplete"
  );
}

function authorizationReviews(manifest) {
  const covered = coveredReviews(manifest);
  return covered.filter((review, index) => {
    if (!isRetryableIncomplete(review)) return true;
    return !covered.slice(index + 1).some((later) => sameRange(later, review));
  });
}

function exhaustedIncompleteReviews(manifest) {
  const covered = coveredReviews(manifest);
  const authorized = authorizationReviews(manifest);
  return authorized.filter(
    (review) =>
      isRetryableIncomplete(review) &&
      covered.filter(
        (candidate) =>
          isRetryableIncomplete(candidate) && sameRange(candidate, review),
      ).length > 1,
  );
}

function incompleteRetryStatus(manifest) {
  const authorized = authorizationReviews(manifest);
  const unresolved = authorized.filter(isRetryableIncomplete);
  if (unresolved.length === 0) return { state: "none" };
  const exhausted = exhaustedIncompleteReviews(manifest);
  const review = exhausted.at(-1) || unresolved.at(-1);
  const attempts = coveredReviews(manifest).filter(
    (candidate) =>
      isRetryableIncomplete(candidate) && sameRange(candidate, review),
  ).length;
  return {
    state: exhausted.length > 0 ? "exhausted" : "pending",
    from: review.from,
    to: review.to,
    attempts,
  };
}

module.exports = {
  authorizationReviews,
  completedReviews,
  coveredReviews,
  exhaustedIncompleteReviews,
  incompleteRetryStatus,
};
