import { Build, Vote } from "./snapshot.js";

/**
 * Compares two snapshots and returns what happened in between as typed events.
 * A missing previous snapshot is the first run: it becomes the baseline and
 * produces no events.
 */
export function diffSnapshots(prev, next) {
  if (!prev) return [];

  const events = [];

  const prevToReview = new Set(prev.toReview.map((pr) => pr.id));
  for (const pr of next.toReview)
    if (!prevToReview.has(pr.id)) events.push({ type: "review-requested", pr });

  const prevMine = new Map(prev.myPrs.map((pr) => [pr.id, pr]));
  for (const pr of next.myPrs) {
    const old = prevMine.get(pr.id);

    const oldVotes = new Map((old?.reviewers ?? []).map((reviewer) => [reviewer.id, reviewer.vote]));
    for (const reviewer of pr.reviewers) {
      if (reviewer.vote === Vote.NONE) continue;
      if (reviewer.vote === (oldVotes.get(reviewer.id) ?? Vote.NONE)) continue;
      events.push({ type: "vote-changed", pr, reviewer: reviewer.name, vote: reviewer.vote });
    }

    // A PR we haven't seen before (new, or reactivated) only reports comments
    // written since the last check, not its whole history.
    const oldComments = new Set((old?.comments ?? []).map((comment) => comment.key));
    const added = pr.comments.filter(
      (comment) => !oldComments.has(comment.key) && (old || comment.published > prev.fetchedAt),
    );
    if (added.length) events.push({ type: "comments-added", pr, comments: added });

    if (pr.build === Build.FAILED && old?.build !== Build.FAILED)
      events.push({ type: "build-failed", pr });
  }

  const nextMine = new Set(next.myPrs.map((pr) => pr.id));
  for (const pr of next.recentlyClosed) {
    if (pr.status === "completed" && prevMine.has(pr.id) && !nextMine.has(pr.id))
      events.push({ type: "pr-completed", pr });
  }

  return events;
}
