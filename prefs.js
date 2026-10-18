import Adw from "gi://Adw";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { clearToken, lookupToken, storeToken } from "./lib/secret.js";

export default class PrMonitorPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage();
    window.add(page);

    const connection = new Adw.PreferencesGroup({
      title: "Azure DevOps",
      description: "Press Enter or the apply button to save each field.",
    });
    page.add(connection);

    connection.add(this._stringRow(settings, "organization-url", "Organization URL"));
    connection.add(this._stringRow(settings, "project", "Project"));

    const tokenRow = new Adw.PasswordEntryRow({
      title: "Personal access token",
      show_apply_button: true,
    });
    connection.add(tokenRow);

    const tokenStatus = new Adw.ActionRow({
      title: "Stored token",
      subtitle: "Checking…",
    });
    const clearButton = new Gtk.Button({
      label: "Remove",
      valign: Gtk.Align.CENTER,
      css_classes: ["destructive-action"],
    });
    tokenStatus.add_suffix(clearButton);
    connection.add(tokenStatus);

    const refreshTokenStatus = async () => {
      const token = await lookupToken().catch(() => null);
      tokenStatus.subtitle = token ? "Saved in the keyring" : "Not set";
      clearButton.sensitive = !!token;
    };

    const tokenChanged = async (change) => {
      try {
        await change();
      } catch (e) {
        tokenStatus.subtitle = `Keyring error: ${e.message}`;
        return;
      }
      settings.set_int64("token-changed", GLib.get_real_time());
      await refreshTokenStatus();
    };

    tokenRow.connect("apply", () => {
      const token = tokenRow.text.trim();
      tokenRow.text = "";
      if (token) tokenChanged(() => storeToken(token));
    });
    clearButton.connect("clicked", () => tokenChanged(() => clearToken()));
    refreshTokenStatus();

    const help = new Adw.PreferencesGroup({
      description:
        "Create the token under User settings → Personal access tokens with the Code (Read) " +
        "and Build (Read) scopes.",
    });
    page.add(help);

    const polling = new Adw.PreferencesGroup({ title: "Polling" });
    page.add(polling);

    const interval = Adw.SpinRow.new_with_range(1, 60, 1);
    interval.title = "Check every";
    interval.subtitle = "Minutes";
    interval.value = settings.get_uint("poll-interval");
    interval.connect("notify::value", () => settings.set_uint("poll-interval", interval.value));
    polling.add(interval);
  }

  _stringRow(settings, key, title) {
    const row = new Adw.EntryRow({
      title,
      text: settings.get_string(key),
      show_apply_button: true,
    });
    row.connect("apply", () => settings.set_string(key, row.text.trim()));
    return row;
  }
}
