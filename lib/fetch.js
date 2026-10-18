import { buildSnapshot } from "./snapshot.js";

const ACTIVE_LIMIT = 100;
const CLOSED_LIMIT = 5;
const DETAIL_CONCURRENCY = 4;

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Fetches everything one poll needs and returns a snapshot. Any failed
 * request fails the whole poll, so a partial snapshot never reaches the diff
 * (it would look like comments and builds disappeared and came back).
 *
 * @param {import("./api.js").AzureDevOpsClient} client
 */
export async function fetchSnapshot(client, { now }) {
  const userId = await client.getCurrentUserId();

  const [mine, reviewing, completed, abandoned] = await Promise.all([
    client.listPullRequests({ creatorId: userId, status: "active" }, ACTIVE_LIMIT),
    client.listPullRequests({ reviewerId: userId, status: "active" }, ACTIVE_LIMIT),
    client.listPullRequests({ creatorId: userId, status: "completed" }, CLOSED_LIMIT),
    client.listPullRequests({ creatorId: userId, status: "abandoned" }, CLOSED_LIMIT),
  ]);

  const details = await mapLimit(mine, DETAIL_CONCURRENCY, async (raw) => {
    const [threads, evaluations] = await Promise.all([
      client.listThreads(raw.repository.id, raw.pullRequestId),
      client.listPolicyEvaluations(raw.repository.project.id, raw.pullRequestId),
    ]);
    return [raw.pullRequestId, { threads, evaluations }];
  });

  const snapshot = buildSnapshot({
    userId,
    projectUrl: client.projectUrl,
    mine,
    reviewing,
    closed: [...completed, ...abandoned],
    details: new Map(details),
    now,
    closedLimit: CLOSED_LIMIT,
  });

  return { ...snapshot, pullsUrl: `${client.organizationUrl}/_pulls` };
}
