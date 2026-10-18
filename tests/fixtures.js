export const ME = "me-id";
export const PROJECT_URL = "https://dev.azure.com/org/Project";

export function rawPr(id, overrides = {}) {
  return {
    pullRequestId: id,
    title: `PR ${id}`,
    status: "active",
    createdBy: { id: ME, displayName: "Me" },
    repository: { id: "repo-id", name: "repo", project: { id: "project-id" } },
    reviewers: [],
    mergeStatus: "succeeded",
    isDraft: false,
    ...overrides,
  };
}

export function reviewer(id, vote, extra = {}) {
  return { id, displayName: id, vote, ...extra };
}

export function thread(id, comments, extra = {}) {
  return { id, comments, ...extra };
}

export function comment(id, authorId, content, publishedDate = "2026-10-17T10:00:00Z", extra = {}) {
  return { id, author: { id: authorId, displayName: authorId }, content, publishedDate, commentType: "text", ...extra };
}

export function buildEvaluation(status, context = {}) {
  return {
    status,
    context,
    configuration: { isEnabled: true, type: { id: "0609b952-1397-4640-95ec-e00a01b2c241", displayName: "Build" } },
  };
}
