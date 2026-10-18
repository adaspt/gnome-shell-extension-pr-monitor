import { fetchSnapshot } from "../lib/fetch.js";
import { assertEqual, test } from "./harness.js";
import { buildEvaluation, comment, ME, PROJECT_URL, rawPr, reviewer, thread } from "./fixtures.js";

class FakeClient {
  constructor() {
    this.organizationUrl = "https://dev.azure.com/org";
    this.projectUrl = PROJECT_URL;
    this.calls = [];
  }

  async getCurrentUserId() {
    return ME;
  }

  async listPullRequests(criteria) {
    this.calls.push(criteria);
    const bob = { id: "bob", displayName: "Bob" };
    if (criteria.reviewerId) return [rawPr(20, { createdBy: bob, reviewers: [reviewer(ME, 0)] })];
    if (criteria.status === "active") return [rawPr(1), rawPr(2)];
    if (criteria.status === "completed") return [rawPr(9, { status: "completed", closedDate: "2026-10-01T00:00:00Z" })];
    return [];
  }

  async listThreads(_repo, id) {
    return id === 1 ? [thread(1, [comment(1, "bob", "hi")])] : [];
  }

  async listPolicyEvaluations(_project, id) {
    return id === 2 ? [buildEvaluation("rejected")] : [];
  }
}

test("fetch assembles a snapshot from the client", async () => {
  const client = new FakeClient();
  const s = await fetchSnapshot(client, { now: 42 });

  assertEqual(s.myPrs.map((pr) => [pr.id, pr.build, pr.comments.length]), [[1, "none", 1], [2, "failed", 0]]);
  assertEqual(s.toReview.map((pr) => pr.id), [20]);
  assertEqual(s.recentlyClosed.map((pr) => pr.id), [9]);
  assertEqual(s.pullsUrl, "https://dev.azure.com/org/_pulls");
  assertEqual(s.fetchedAt, 42);
});

test("a failed detail request fails the whole fetch", async () => {
  const client = new FakeClient();
  client.listThreads = async () => {
    throw new Error("boom");
  };

  let error = null;
  await fetchSnapshot(client, { now: 0 }).catch((e) => (error = e));
  assertEqual(error?.message, "boom");
});
