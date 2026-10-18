import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup?version=3.0";

Gio._promisify(Soup.Session.prototype, "send_and_read_async");

const API_VERSION = "7.1";
const POLICY_API_VERSION = "7.1-preview.1";

export class ApiError extends Error {
  constructor(message, { status = 0, auth = false } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.auth = auth;
  }
}

/**
 * Thin read-only client for the Azure DevOps REST API, scoped to one project.
 * All requests share the cancellable passed in, so destroy() or cancelling it
 * aborts everything in flight.
 */
export class AzureDevOpsClient {
  constructor({ organizationUrl, project, token, cancellable = null }) {
    this.organizationUrl = organizationUrl.replace(/\/+$/, "");
    this.projectUrl = `${this.organizationUrl}/${encodeURIComponent(project)}`;
    this._cancellable = cancellable;
    this._authorization = `Basic ${GLib.base64_encode(new TextEncoder().encode(`:${token}`))}`;
    this._session = new Soup.Session({ timeout: 30 });
  }

  destroy() {
    this._session.abort();
    this._session = null;
  }

  async getCurrentUserId() {
    const data = await this._get(`${this.organizationUrl}/_apis/connectionData`);
    const id = data.authenticatedUser?.id;
    if (!id) throw new ApiError("Could not determine the signed-in user", { auth: true });
    return id;
  }

  async listPullRequests(criteria, top) {
    const params = { $top: top, "api-version": API_VERSION };
    for (const [key, value] of Object.entries(criteria)) params[`searchCriteria.${key}`] = value;

    const data = await this._get(`${this.projectUrl}/_apis/git/pullrequests`, params);
    return data.value ?? [];
  }

  async listThreads(repositoryId, pullRequestId) {
    const data = await this._get(
      `${this.projectUrl}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/threads`,
      { "api-version": API_VERSION },
    );
    return data.value ?? [];
  }

  async listPolicyEvaluations(projectId, pullRequestId) {
    const data = await this._get(`${this.projectUrl}/_apis/policy/evaluations`, {
      artifactId: `vstfs:///CodeReview/CodeReviewId/${projectId}/${pullRequestId}`,
      "api-version": POLICY_API_VERSION,
    });
    return data.value ?? [];
  }

  async _get(url, params = {}) {
    const query = Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");

    const message = Soup.Message.new("GET", query ? `${url}?${query}` : url);
    if (!message) throw new ApiError(`Invalid URL: ${url}`);

    message.request_headers.append("Authorization", this._authorization);
    message.request_headers.append("Accept", "application/json");

    const bytes = await this._session.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      this._cancellable,
    );

    const status = message.get_status();
    // An invalid or expired PAT gets 401, or 203 with an HTML sign-in page.
    if (status === Soup.Status.UNAUTHORIZED || status === Soup.Status.NON_AUTHORITATIVE)
      throw new ApiError("Authentication failed, check your token", { status, auth: true });
    if (status === Soup.Status.NOT_FOUND)
      throw new ApiError("Not found, check the organization URL and project", { status });
    if (status !== Soup.Status.OK)
      throw new ApiError(`HTTP ${status} ${message.get_reason_phrase() ?? ""}`.trim(), { status });

    const [contentType] = message.response_headers.get_content_type();
    if (!contentType?.includes("json"))
      throw new ApiError("Authentication failed, check your token", { status, auth: true });

    return JSON.parse(new TextDecoder().decode(bytes.toArray()));
  }
}
