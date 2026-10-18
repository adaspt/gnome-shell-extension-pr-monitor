import Gio from "gi://Gio";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { Indicator } from "./indicator.js";
import { describeEvent } from "./lib/format.js";
import { Monitor } from "./lib/monitor.js";
import { Notifier } from "./notifier.js";

function openUrl(url) {
  try {
    Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1));
  } catch (e) {
    console.warn(`PR Monitor: could not open ${url}: ${e}`);
  }
}

export default class PrMonitorExtension extends Extension {
  enable() {
    const gicon = Gio.icon_new_for_string(`${this.path}/icons/pr-monitor-symbolic.svg`);

    this._notifier = new Notifier(gicon, openUrl);

    this._monitor = new Monitor(this.getSettings(), {
      onUpdate: () => this._indicator?.update(this._monitor.status),
      onEvents: (events) => {
        for (const event of events) this._notifier.notify(describeEvent(event));
      },
    });

    this._indicator = new Indicator({
      gicon,
      onOpenUrl: openUrl,
      onRefresh: () => this._monitor.refresh(),
      onMenuOpened: () => this._monitor.refreshIfStale(),
      onOpenSettings: () => this.openPreferences(),
    });
    Main.panel.addToStatusArea(this.uuid, this._indicator);

    this._monitor.start();
  }

  disable() {
    this._monitor.destroy();
    this._indicator.destroy();
    this._notifier.destroy();

    this._monitor = null;
    this._indicator = null;
    this._notifier = null;
  }
}
