// Turns raw API responses into the plain, JSON-serializable snapshot the UI
// renders and the diff compares. No GNOME imports, so it runs under plain gjs.

export const Vote = {
  APPROVED: 10,
  APPROVED_WITH_SUGGESTIONS: 5,
  NONE: 0,
  WAITING_FOR_AUTHOR: -5,
  REJECTED: -10,
};

export const Build = {
  NONE: "none",
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  EXPIRED: "expired",
};

const BUILD_POLICY_TYPE_ID = "0609b952-1397-4640-95ec-e00a01b2c241";
const COMMENT_EXCERPT_LENGTH = 200;

export function normalizePullRequest(raw, projectUrl) {
  const repository = raw.repository?.name ?? "";

  return {
    id: raw.pullRequestId,
    title: raw.title ?? "",
    repository,
    url: `${projectUrl}/_git/${encodeURIComponent(repository)}/pullrequest/${raw.pullRequestId}`,
    author: raw.createdBy?.displayName ?? "",
    authorId: raw.createdBy?.id ?? "",
    status: raw.status,
    branch: (raw.sourceRefName ?? "").replace(/^refs\/heads\//, ""),
    isDraft: !!raw.isDraft,
    hasConflicts: raw.mergeStatus === "conflicts",
    closedDate: raw.closedDate ?? null,
    reviewers: (raw.reviewers ?? []).map((reviewer) => ({
      id: reviewer.id,
      name: reviewer.displayName ?? "",
      vote: reviewer.vote ?? Vote.NONE,
      declined: !!reviewer.hasDeclined,
    })),
  };
}

export function buildStatus(evaluations) {
  const builds = evaluations.filter(
    (evaluation) =>
      evaluation.configuration?.isEnabled !== false &&
      (evaluation.configuration?.type?.id === BUILD_POLICY_TYPE_ID ||
        evaluation.configuration?.type?.displayName === "Build"),
  );

  const states = builds.map((evaluation) => {
    if (evaluation.context?.isExpired) return Build.EXPIRED;

    switch (evaluation.status) {
      case "approved":
        return Build.SUCCEEDED;
      case "rejected":
      case "broken":
        return Build.FAILED;
      case "running":
        return Build.RUNNING;
      case "queued":
        // Queued with a build id means it is actually running; without one,
        // the policy is waiting for a build to be started.
        return evaluation.context?.buildId ? Build.RUNNING : Build.PENDING;
      default:
        return Build.NONE;
    }
  });

  for (const state of [Build.FAILED, Build.EXPIRED, Build.RUNNING, Build.PENDING, Build.SUCCEEDED])
    if (states.includes(state)) return state;

  return Build.NONE;
}

// Every enabled blocking branch policy passes. True when the branch has none.
export function policiesPassed(evaluations) {
  return evaluations
    .filter(
      (evaluation) =>
        evaluation.configuration?.isEnabled !== false && evaluation.configuration?.isBlocking !== false,
    )
    .every(
      (evaluation) =>
        evaluation.status === "notApplicable" ||
        (evaluation.status === "approved" && !evaluation.context?.isExpired),
    );
}

// Our own bar on top of branch policies: at least one reviewer, every
// reviewer who hasn't declined approved, no unresolved threads, build passed
// (or none configured).
export function isReadyToMerge(pr) {
  const reviewers = pr.reviewers.filter((reviewer) => !reviewer.declined);
  return (
    !pr.isDraft &&
    !pr.hasConflicts &&
    pr.policiesPassed &&
    pr.activeThreads === 0 &&
    (pr.build === Build.SUCCEEDED || pr.build === Build.NONE) &&
    reviewers.length > 0 &&
    reviewers.every((reviewer) => reviewer.vote >= Vote.APPROVED_WITH_SUGGESTIONS)
  );
}

// Human comments from other people. System threads (pushes, vote changes,
// policy updates) carry commentType "system" and are skipped.
export function commentsFromThreads(threads, userId) {
  const comments = [];

  for (const thread of threads) {
    if (thread.isDeleted) continue;

    for (const comment of thread.comments ?? []) {
      if (comment.isDeleted || comment.commentType === "system") continue;
      if (comment.author?.id === userId) continue;

      comments.push({
        key: `${thread.id}:${comment.id}`,
        author: comment.author?.displayName ?? "",
        text: (comment.content ?? "").slice(0, COMMENT_EXCERPT_LENGTH),
        published: Date.parse(comment.publishedDate) || 0,
      });
    }
  }

  return comments;
}

// Unresolved threads, as the web UI counts them: active or pending, with at
// least one human comment (from anyone, me included). These block completion
// under the comment resolution policy.
export function activeThreadCount(threads) {
  return threads.filter(
    (thread) =>
      !thread.isDeleted &&
      (thread.status === "active" || thread.status === "pending") &&
      (thread.comments ?? []).some((comment) => !comment.isDeleted && comment.commentType !== "system"),
  ).length;
}

function isAwaitingMyVote(raw, userId) {
  if (raw.isDraft || raw.createdBy?.id === userId) return false;

  const me = (raw.reviewers ?? []).find((reviewer) => reviewer.id === userId);
  return !!me && !me.hasDeclined && (me.vote ?? Vote.NONE) === Vote.NONE;
}

/**
 * @param {object} input
 * @param {string} input.userId
 * @param {string} input.projectUrl
 * @param {object[]} input.mine - my active pull requests
 * @param {object[]} input.reviewing - active pull requests I'm a reviewer on
 * @param {object[]} input.closed - my completed and abandoned pull requests
 * @param {Map<number, {threads: object[], evaluations: object[]}>} input.details
 * @param {number} input.now
 * @param {number} input.closedLimit
 */
export function buildSnapshot({ userId, projectUrl, mine, reviewing, closed, details, now, closedLimit }) {
  const myPrs = mine.map((raw) => {
    const pr = normalizePullRequest(raw, projectUrl);
    const detail = details.get(pr.id) ?? { threads: [], evaluations: [] };

    const myPr = {
      ...pr,
      reviewers: pr.reviewers.filter((reviewer) => reviewer.id !== userId),
      build: buildStatus(detail.evaluations),
      policiesPassed: policiesPassed(detail.evaluations),
      comments: commentsFromThreads(detail.threads, userId),
      activeThreads: activeThreadCount(detail.threads),
    };
    return { ...myPr, ready: isReadyToMerge(myPr) };
  });

  const toReview = reviewing
    .filter((raw) => isAwaitingMyVote(raw, userId))
    .map((raw) => normalizePullRequest(raw, projectUrl));

  const recentlyClosed = closed
    .map((raw) => normalizePullRequest(raw, projectUrl))
    .sort((a, b) => (Date.parse(b.closedDate) || 0) - (Date.parse(a.closedDate) || 0))
    .slice(0, closedLimit);

  return { userId, fetchedAt: now, myPrs, toReview, recentlyClosed };
}

export function isBlocked(pr) {
  return (
    pr.build === Build.FAILED ||
    pr.hasConflicts ||
    pr.activeThreads > 0 ||
    pr.reviewers.some(
      (reviewer) => reviewer.vote === Vote.WAITING_FOR_AUTHOR || reviewer.vote === Vote.REJECTED,
    )
  );
}

export function attentionCount(snapshot) {
  return snapshot.toReview.length + snapshot.myPrs.filter(isBlocked).length;
}

export function hasAlert(snapshot) {
  return snapshot.myPrs.some((pr) => pr.build === Build.FAILED || pr.hasConflicts);
}
