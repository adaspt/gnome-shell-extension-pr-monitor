import {
  activeThreadCount,
  attentionCount,
  Build,
  buildSnapshot,
  buildStatus,
  commentsFromThreads,
  hasAlert,
  policiesPassed,
  Vote,
} from "../lib/snapshot.js";
import { assertEqual, test } from "./harness.js";
import { buildEvaluation, comment, ME, PROJECT_URL, rawPr, reviewer, thread } from "./fixtures.js";

function snapshot({ mine = [], reviewing = [], closed = [], details = new Map() } = {}) {
  return buildSnapshot({ userId: ME, projectUrl: PROJECT_URL, mine, reviewing, closed, details, now: 1000, closedLimit: 5 });
}

test("pull request URL points at the web UI", () => {
  assertEqual(snapshot({ mine: [rawPr(7)] }).myPrs[0].url, `${PROJECT_URL}/_git/repo/pullrequest/7`);
});

test("branch name drops refs/heads/", () => {
  const pr = rawPr(7, { sourceRefName: "refs/heads/feature/login-fix" });
  assertEqual(snapshot({ mine: [pr] }).myPrs[0].branch, "feature/login-fix");
  assertEqual(snapshot({ mine: [rawPr(8)] }).myPrs[0].branch, "");
});

test("my own vote is not listed among reviewers of my PR", () => {
  const pr = rawPr(1, { reviewers: [reviewer(ME, Vote.APPROVED), reviewer("jane", Vote.NONE)] });
  assertEqual(snapshot({ mine: [pr] }).myPrs[0].reviewers.map((r) => r.id), ["jane"]);
});

test("to review: only PRs by others, not draft, not voted, not declined", () => {
  const someone = { id: "bob", displayName: "Bob" };
  const reviewing = [
    rawPr(1, { createdBy: someone, reviewers: [reviewer(ME, Vote.NONE)] }),
    rawPr(2, { createdBy: someone, reviewers: [reviewer(ME, Vote.APPROVED)] }),
    rawPr(3, { createdBy: someone, isDraft: true, reviewers: [reviewer(ME, Vote.NONE)] }),
    rawPr(4, { createdBy: someone, reviewers: [reviewer(ME, Vote.NONE, { hasDeclined: true })] }),
    rawPr(5, { reviewers: [reviewer(ME, Vote.NONE)] }),
  ];
  assertEqual(snapshot({ reviewing }).toReview.map((pr) => pr.id), [1]);
});

test("recently closed is sorted by close date and limited", () => {
  const closed = [1, 2, 3, 4, 5, 6].map((id) =>
    rawPr(id, { status: "completed", closedDate: `2026-10-0${id}T00:00:00Z` }),
  );
  assertEqual(snapshot({ closed }).recentlyClosed.map((pr) => pr.id), [6, 5, 4, 3, 2]);
});

test("build status priorities", () => {
  assertEqual(buildStatus([]), Build.NONE);
  assertEqual(buildStatus([buildEvaluation("approved")]), Build.SUCCEEDED);
  assertEqual(buildStatus([buildEvaluation("approved"), buildEvaluation("rejected")]), Build.FAILED);
  assertEqual(buildStatus([buildEvaluation("queued", { buildId: 5 })]), Build.RUNNING);
  assertEqual(buildStatus([buildEvaluation("queued")]), Build.PENDING);
  assertEqual(buildStatus([buildEvaluation("queued", { isExpired: true })]), Build.EXPIRED);
});

test("build status ignores non-build and disabled policies", () => {
  const reviewers = { status: "rejected", configuration: { isEnabled: true, type: { id: "x", displayName: "Minimum number of reviewers" } } };
  const disabled = { ...buildEvaluation("rejected"), configuration: { ...buildEvaluation("rejected").configuration, isEnabled: false } };
  assertEqual(buildStatus([reviewers, disabled, buildEvaluation("approved")]), Build.SUCCEEDED);
});

test("comments skip system, deleted and my own", () => {
  const threads = [
    thread(1, [comment(1, "jane", "looks good"), comment(2, ME, "thanks")]),
    thread(2, [comment(1, "jane", "pushed", undefined, { commentType: "system" })]),
    thread(3, [comment(1, "bob", "gone", undefined, { isDeleted: true })]),
    thread(4, [comment(1, "bob", "whole thread gone")], { isDeleted: true }),
  ];
  assertEqual(commentsFromThreads(threads, ME).map((c) => c.key), ["1:1"]);
});

test("active threads: active or pending with a human comment, mine included", () => {
  const threads = [
    thread(1, [comment(1, "jane", "rename this")], { status: "active" }),
    thread(2, [comment(1, ME, "note to self")], { status: "pending" }),
    thread(3, [comment(1, "jane", "done")], { status: "fixed" }),
    thread(4, [comment(1, "jane", "nah")], { status: "wontFix" }),
    thread(5, [comment(1, "jane", "voted", undefined, { commentType: "system" })], { status: "active" }),
    thread(6, [comment(1, "jane", "gone", undefined, { isDeleted: true })], { status: "active" }),
    thread(7, [comment(1, "jane", "whole thread gone")], { status: "active", isDeleted: true }),
    thread(8, [comment(1, "jane", "no status")]),
  ];
  assertEqual(activeThreadCount(threads), 2);
});

test("policies pass when every enabled blocking policy is approved or not applicable", () => {
  const policy = (status, configuration = {}, context = {}) => ({
    status,
    context,
    configuration: { isEnabled: true, isBlocking: true, type: { id: "x" }, ...configuration },
  });
  assertEqual(policiesPassed([]), true);
  assertEqual(policiesPassed([policy("approved"), policy("notApplicable")]), true);
  assertEqual(policiesPassed([policy("approved"), policy("rejected")]), false);
  assertEqual(policiesPassed([policy("queued")]), false);
  assertEqual(policiesPassed([policy("approved", {}, { isExpired: true })]), false);
  assertEqual(policiesPassed([policy("rejected", { isBlocking: false }), policy("rejected", { isEnabled: false })]), true);
});

test("ready to merge: approved by every reviewer, no threads, build and policies pass", () => {
  const approved = [reviewer("jane", Vote.APPROVED)];
  const activeThread = thread(1, [comment(1, "jane", "fix")], { status: "active" });
  const ready = (raw, detail = {}) =>
    snapshot({ mine: [raw], details: new Map([[raw.pullRequestId, { threads: [], evaluations: [], ...detail }]]) })
      .myPrs[0].ready;

  assertEqual(ready(rawPr(1, { reviewers: approved })), true);
  assertEqual(ready(rawPr(1, { reviewers: approved }), { evaluations: [buildEvaluation("approved")] }), true);
  assertEqual(ready(rawPr(1, { reviewers: [reviewer("jane", Vote.APPROVED_WITH_SUGGESTIONS)] })), true);
  assertEqual(ready(rawPr(1, { reviewers: [...approved, reviewer("bob", Vote.NONE, { hasDeclined: true })] })), true);
  assertEqual(ready(rawPr(1, { reviewers: [reviewer(ME, Vote.APPROVED)] })), false, "only my own vote");
  assertEqual(ready(rawPr(1)), false, "no reviewers");
  assertEqual(ready(rawPr(1, { reviewers: [...approved, reviewer("bob", Vote.NONE)] })), false, "bob not voted");
  assertEqual(ready(rawPr(1, { reviewers: approved }), { threads: [activeThread] }), false, "active thread");
  assertEqual(ready(rawPr(1, { reviewers: approved }), { evaluations: [buildEvaluation("running")] }), false, "build");
  assertEqual(ready(rawPr(1, { reviewers: approved, isDraft: true })), false, "draft");
  assertEqual(ready(rawPr(1, { reviewers: approved, mergeStatus: "conflicts" })), false, "conflicts");
  const minReviewers = { status: "rejected", configuration: { isEnabled: true, isBlocking: true, type: { id: "x" } } };
  assertEqual(ready(rawPr(1, { reviewers: approved }), { evaluations: [minReviewers] }), false, "policy");
});

test("attention count and alert", () => {
  const someone = { id: "bob", displayName: "Bob" };
  const details = new Map([
    [2, { threads: [], evaluations: [buildEvaluation("rejected")] }],
    [5, { threads: [thread(1, [comment(1, "jane", "fix")], { status: "active" })], evaluations: [] }],
  ]);
  const s = snapshot({
    mine: [
      rawPr(1),
      rawPr(2),
      rawPr(3, { mergeStatus: "conflicts" }),
      rawPr(4, { reviewers: [reviewer("jane", Vote.WAITING_FOR_AUTHOR)] }),
      rawPr(5),
    ],
    reviewing: [rawPr(10, { createdBy: someone, reviewers: [reviewer(ME, Vote.NONE)] })],
    details,
  });
  assertEqual(s.myPrs[4].activeThreads, 1);
  assertEqual(attentionCount(s), 5);
  assertEqual(hasAlert(s), true);
  assertEqual(hasAlert(snapshot({ mine: [rawPr(1)] })), false);
});
