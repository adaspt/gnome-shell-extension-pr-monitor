import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { AzureDevOpsClient } from "./api.js";
import { diffSnapshots } from "./diff.js";
import { fetchSnapshot } from "./fetch.js";
import { lookupToken } from "./secret.js";
import { loadState, saveState } from "./state.js";

// Opening the menu refreshes when the last attempt is older than this.
const STALE_AFTER_MS = 60 * 1000;
const SETTINGS_KEYS = ["organization-url", "project", "poll-interval", "token-changed"];

class ConfigError extends Error {}

/**
 * Polls Azure DevOps on a timer, keeps the latest snapshot and reports
 * changes. onUpdate() fires whenever `status` changes, onEvents(events)
 * when the diff against the previous snapshot found something.
 */
export class Monitor {
  constructor(settings, { onUpdate, onEvents }) {
    this._settings = settings;
    this._onUpdate = onUpdate;
    this._onEvents = onEvents;

    this._snapshot = null;
    this._error = null;
    this._lastAttempt = 0;
    this._refreshing = null;
    this._cancellable = null;
    this._timerId = 0;
    this._destroyed = false;

    this._settingsIds = SETTINGS_KEYS.map((key) =>
      settings.connect(`changed::${key}`, () => this._onSettingsChanged(key)),
    );
  }

  get status() {
    return { snapshot: this._snapshot, error: this._error, refreshing: !!this._refreshing };
  }

  async start() {
    const state = await loadState();
    if (this._destroyed) return;

    if (state?.key === this._key()) this._snapshot = state.snapshot;
    this._schedule();
    this.refresh();
  }

  refresh() {
    if (!this._refreshing) {
      this._refreshing = this._poll().finally(() => {
        this._refreshing = null;
        if (!this._destroyed) this._onUpdate();
      });
      this._onUpdate();
    }
    return this._refreshing;
  }

  refreshIfStale() {
    if (Date.now() - this._lastAttempt > STALE_AFTER_MS) this.refresh();
  }

  destroy() {
    this._destroyed = true;
    this._cancellable?.cancel();
    if (this._timerId) GLib.source_remove(this._timerId);
    this._timerId = 0;
    for (const id of this._settingsIds) this._settings.disconnect(id);
    this._settingsIds = [];
  }

  _key() {
    const url = this._settings.get_string("organization-url").trim().replace(/\/+$/, "");
    const project = this._settings.get_string("project").trim();
    return `${url}|${project}`.toLowerCase();
  }

  _schedule() {
    if (this._timerId) GLib.source_remove(this._timerId);

    const minutes = this._settings.get_uint("poll-interval");
    this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
      this.refresh();
      return GLib.SOURCE_CONTINUE;
    });
  }

  _onSettingsChanged(key) {
    if (key === "poll-interval") {
      this._schedule();
      return;
    }

    if (key === "organization-url" || key === "project") {
      this._snapshot = null;
      this._error = null;
    }

    this._cancellable?.cancel();
    this._schedule();
    this._onUpdate();

    // Restart once the cancelled poll has wound down.
    Promise.resolve(this._refreshing).then(() => {
      if (!this._destroyed) this.refresh();
    });
  }

  async _poll() {
    this._lastAttempt = Date.now();
    const key = this._key();
    const cancellable = new Gio.Cancellable();
    this._cancellable = cancellable;

    let client = null;
    try {
      const organizationUrl = this._settings.get_string("organization-url").trim();
      const project = this._settings.get_string("project").trim();
      if (!organizationUrl || !project)
        throw new ConfigError("Set the organization URL and project in Settings");

      const token = await lookupToken();
      if (!token) throw new ConfigError("Set a personal access token in Settings");

      client = new AzureDevOpsClient({ organizationUrl, project, token, cancellable });
      const next = await fetchSnapshot(client, { now: Date.now() });
      if (this._destroyed || cancellable.is_cancelled() || key !== this._key()) return;

      const prev = this._snapshot?.userId === next.userId ? this._snapshot : null;
      const events = diffSnapshots(prev, next);

      this._snapshot = next;
      this._error = null;
      saveState({ key, snapshot: next }).catch((e) => console.warn(`PR Monitor: saving state failed: ${e}`));

      if (events.length) this._onEvents(events);
    } catch (e) {
      if (this._destroyed || cancellable.is_cancelled()) return;
      if (!(e instanceof ConfigError)) console.warn(`PR Monitor: refresh failed: ${e}`);
      this._error = e.message ?? String(e);
    } finally {
      client?.destroy();
      if (this._cancellable === cancellable) this._cancellable = null;
    }
  }
}
