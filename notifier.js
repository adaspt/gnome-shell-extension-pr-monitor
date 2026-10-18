import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

export class Notifier {
  constructor(gicon, onOpenUrl) {
    this._gicon = gicon;
    this._onOpenUrl = onOpenUrl;
    this._source = null;
  }

  notify({ title, body, url }) {
    const source = this._getSource();
    const notification = new MessageTray.Notification({ source, title, body });
    if (url) notification.connect("activated", () => this._onOpenUrl(url));
    source.addNotification(notification);
  }

  destroy() {
    this._source?.destroy();
    this._source = null;
  }

  _getSource() {
    if (!this._source) {
      this._source = new MessageTray.Source({ title: "PR Monitor", icon: this._gicon });
      this._source.connect("destroy", () => {
        this._source = null;
      });
      Main.messageTray.add(this._source);
    }
    return this._source;
  }
}
