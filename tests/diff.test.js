import { diffSnapshots } from "../lib/diff.js";
import { Build, Vote } from "../lib/snapshot.js";
import { assertEqual, test } from "./harness.js";

function pr(id, overrides = {}) {
  return { id, title: `PR ${id}`, status: "active", reviewers: [], comments: [], build: Build.NONE, ...overrides };
}

function snap({ myPrs = [], toReview = [], recentlyClosed = [], fetchedAt = 1000 } = {}) {
  return { userId: "me", fetchedAt, myPrs, toReview, recentlyClosed };
}

const types = (events) => events.map((e) => e.type);

test("first run is a silent baseline", () => {
  assertEqual(diffSnapshots(null, snap({ toReview: [pr(1)] })), []);
});

test("no changes, no events", () => {
  const s = snap({ myPrs: [pr(1, { build: Build.FAILED })], toReview: [pr(2)] });
  assertEqual(diffSnapshots(s, s), []);
});

test("new PR to review", () => {
  const events = diffSnapshots(snap({ toReview: [pr(1)] }), snap({ toReview: [pr(1), pr(2)] }));
  assertEqual(types(events), ["review-requested"]);
  assertEqual(events[0].pr.id, 2);
});

test("vote changes on my PR, ignoring resets to no vote", () => {
  const before = snap({ myPrs: [pr(1, { reviewers: [{ id: "a", name: "Ann", vote: 0 }, { id: "b", name: "Bob", vote: 10 }] })] });
  const after = snap({ myPrs: [pr(1, { reviewers: [{ id: "a", name: "Ann", vote: Vote.WAITING_FOR_AUTHOR }, { id: "b", name: "Bob", vote: 0 }] })] });
  const events = diffSnapshots(before, after);
  assertEqual(events.map((e) => [e.type, e.reviewer, e.vote]), [["vote-changed", "Ann", -5]]);
});

test("new comments are grouped per PR", () => {
  const c = (key) => ({ key, author: "Ann", text: key, published: 2000 });
  const before = snap({ myPrs: [pr(1, { comments: [c("1:1")] })] });
  const after = snap({ myPrs: [pr(1, { comments: [c("1:1"), c("1:2"), c("2:1")] })] });
  const events = diffSnapshots(before, after);
  assertEqual(types(events), ["comments-added"]);
  assertEqual(events[0].comments.map((x) => x.key), ["1:2", "2:1"]);
});

test("a PR seen for the first time only reports comments since the last check", () => {
  const old = { key: "1:1", author: "Ann", text: "old", published: 500 };
  const fresh = { key: "1:2", author: "Ann", text: "new", published: 1500 };
  const events = diffSnapshots(snap({ fetchedAt: 1000 }), snap({ myPrs: [pr(1, { comments: [old, fresh] })] }));
  assertEqual(events[0].comments.map((x) => x.key), ["1:2"]);
});

test("build failure is reported once", () => {
  const failed = snap({ myPrs: [pr(1, { build: Build.FAILED })] });
  assertEqual(types(diffSnapshots(snap({ myPrs: [pr(1, { build: Build.RUNNING })] }), failed)), ["build-failed"]);
  assertEqual(diffSnapshots(failed, failed), []);
});

test("completed PR is reported, abandoned is not", () => {
  const before = snap({ myPrs: [pr(1), pr(2)] });
  const after = snap({
    recentlyClosed: [pr(1, { status: "completed" }), pr(2, { status: "abandoned" }), pr(3, { status: "completed" })],
  });
  const events = diffSnapshots(before, after);
  assertEqual(events.map((e) => [e.type, e.pr.id]), [["pr-completed", 1]]);
});
