import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Pango from "gi://Pango";
import St from "gi://St";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { nameList, relativeTime, shortName } from "./lib/format.js";
import { Build, Vote, attentionCount, hasAlert } from "./lib/snapshot.js";

const MAX_ITEMS_PER_SECTION = 10;
const COPY_ICON = "edit-copy-symbolic";
const COPIED_ICON = "object-select-symbolic";
const COPIED_FEEDBACK_MS = 1500;

const BUILD_CHIPS = {
  [Build.FAILED]: ["build failed", "bad"],
  [Build.EXPIRED]: ["build expired", "warn"],
  [Build.RUNNING]: ["build running", "dim"],
  [Build.PENDING]: ["build not started", "dim"],
  [Build.SUCCEEDED]: ["build passed", "dim"],
};

// Green is reserved for "Ready": everything else that is fine stays dim.
function myPrChips(pr) {
  const chips = [];
  if (pr.ready) chips.push(["Ready", "ok"]);
  if (pr.isDraft) chips.push(["draft", "dim"]);
  if (!pr.reviewers.length) chips.push(["no reviewers", "dim"]);

  const names = (predicate) => pr.reviewers.filter(predicate).map((reviewer) => shortName(reviewer.name));
  const approved = names((reviewer) => reviewer.vote >= Vote.APPROVED_WITH_SUGGESTIONS);
  const waiting = names((reviewer) => reviewer.vote === Vote.WAITING_FOR_AUTHOR);
  const rejected = names((reviewer) => reviewer.vote === Vote.REJECTED);
  const notVoted = names((reviewer) => reviewer.vote === Vote.NONE && !reviewer.declined);
  if (approved.length) chips.push([`✓ ${nameList(approved)}`, "dim"]);
  if (waiting.length) chips.push([`⧗ ${nameList(waiting)}`, "warn"]);
  if (rejected.length) chips.push([`✗ ${nameList(rejected)}`, "bad"]);
  if (notVoted.length) chips.push([`○ ${nameList(notVoted)}`, "dim"]);

  if (pr.activeThreads) chips.push([`${pr.activeThreads} active`, "warn"]);
  if (BUILD_CHIPS[pr.build]) chips.push(BUILD_CHIPS[pr.build]);
  if (pr.hasConflicts) chips.push(["conflicts", "bad"]);
  return chips;
}

function reviewChips(pr) {
  return [[pr.author, "dim"]];
}

function closedChips(pr, now) {
  const merged = pr.status === "completed";
  return [
    merged ? ["merged", "ok"] : ["abandoned", "dim"],
    [relativeTime(Date.parse(pr.closedDate) || now, now), "dim"],
  ];
}

export const Indicator = GObject.registerClass(
  class Indicator extends PanelMenu.Button {
    _init({ gicon, onOpenUrl, onRefresh, onMenuOpened, onOpenSettings }) {
      super._init(0.0, "PR Monitor");

      this._onOpenUrl = onOpenUrl;
      this._status = { snapshot: null, error: null, refreshing: false };

      const box = new St.BoxLayout({ style_class: "panel-status-menu-box" });
      this._icon = new St.Icon({ gicon, style_class: "system-status-icon" });
      this._badge = new St.Label({
        style_class: "pr-monitor-badge",
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
      });
      box.add_child(this._icon);
      box.add_child(this._badge);
      this.add_child(box);

      this._mine = this._addSection("My pull requests");
      this._review = this._addSection("To review");
      // Collapsed by default; the shell closes it again whenever the menu closes.
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      const closedItem = new PopupMenu.PopupSubMenuMenuItem("Recently closed");
      this.menu.addMenuItem(closedItem);
      this._closed = closedItem.menu;

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._errorItem = new PopupMenu.PopupMenuItem("", { reactive: false });
      this._errorItem.label.add_style_class_name("pr-monitor-bad");
      this._errorItem.label.clutter_text.line_wrap = true;
      this.menu.addMenuItem(this._errorItem);

      // One row: "Updated 3 min ago" on the left, refresh and settings buttons on the right.
      const footer = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
      this._statusLabel = new St.Label({
        style_class: "pr-monitor-dim",
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._refreshButton = this._createFooterButton("view-refresh-symbolic", "Refresh now", onRefresh);
      const settingsButton = this._createFooterButton("emblem-system-symbolic", "Settings", () => {
        this.menu.close();
        onOpenSettings();
      });
      footer.add_child(this._statusLabel);
      footer.add_child(this._refreshButton);
      footer.add_child(settingsButton);
      this.menu.addMenuItem(footer);

      this.menu.connect("open-state-changed", (_menu, open) => {
        if (!open) return;
        this._updateFooter();
        onMenuOpened();
      });

      this.update(this._status);
    }

    update(status) {
      this._status = status;
      const { snapshot } = status;
      const now = Date.now();

      this._fillSection(this._mine, snapshot?.myPrs, myPrChips, "No open pull requests", snapshot);
      this._fillSection(this._review, snapshot?.toReview, reviewChips, "Nothing to review", snapshot);
      this._fillSection(
        this._closed,
        snapshot?.recentlyClosed,
        (pr) => closedChips(pr, now),
        "Nothing closed recently",
        snapshot,
      );

      const count = snapshot ? attentionCount(snapshot) : 0;
      this._badge.text = String(count);
      this._badge.visible = count > 0;

      if (snapshot && hasAlert(snapshot)) this._icon.add_style_class_name("pr-monitor-alert");
      else this._icon.remove_style_class_name("pr-monitor-alert");

      this._updateFooter();
    }

    _addSection(title) {
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(title));
      const section = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(section);
      return section;
    }

    _fillSection(section, prs, chipsFor, emptyText, snapshot) {
      section.removeAll();

      if (!prs) return;
      if (!prs.length) {
        const empty = new PopupMenu.PopupMenuItem(emptyText, { reactive: false });
        empty.label.add_style_class_name("pr-monitor-dim");
        section.addMenuItem(empty);
        return;
      }

      for (const pr of prs.slice(0, MAX_ITEMS_PER_SECTION))
        section.addMenuItem(this._createPrItem(pr, chipsFor(pr)));

      const hidden = prs.length - MAX_ITEMS_PER_SECTION;
      if (hidden > 0)
        section.addAction(`${hidden} more in browser…`, () => this._onOpenUrl(snapshot.pullsUrl));
    }

    _createPrItem(pr, chips) {
      const item = new PopupMenu.PopupBaseMenuItem();

      const box = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: "pr-monitor-item-box",
        x_expand: true,
      });

      const title = new St.Label({ text: pr.title, style_class: "pr-monitor-title" });
      title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      box.add_child(title);

      if (chips.length) {
        const meta = new St.BoxLayout({ style_class: "pr-monitor-meta" });
        for (const [text, kind] of chips)
          meta.add_child(new St.Label({ text, style_class: `pr-monitor-${kind}` }));
        box.add_child(meta);
      }

      item.add_child(box);
      // Closed PRs have no copy button: their branch is usually deleted.
      if (pr.status === "active" && pr.branch) item.add_child(this._createCopyBranchButton(item, pr.branch));
      item.connect("activate", () => this._onOpenUrl(pr.url));
      return item;
    }

    // Visible while the row is hovered or keyboard-selected. The button takes
    // the click, so copying neither opens the PR nor closes the menu.
    _createCopyBranchButton(item, branch) {
      const icon = new St.Icon({ icon_name: COPY_ICON });
      const button = new St.Button({
        style_class: "icon-button pr-monitor-row-button",
        accessible_name: `Copy branch name ${branch}`,
        can_focus: false,
        y_align: Clutter.ActorAlign.CENTER,
        opacity: 0,
        child: icon,
      });

      let resetId = 0;
      button.connect("clicked", () => {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, branch);
        icon.icon_name = COPIED_ICON;
        if (resetId) GLib.source_remove(resetId);
        resetId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, COPIED_FEEDBACK_MS, () => {
          resetId = 0;
          icon.icon_name = COPY_ICON;
          return GLib.SOURCE_REMOVE;
        });
      });
      button.connect("destroy", () => {
        if (resetId) GLib.source_remove(resetId);
      });

      item.connect("notify::active", () => (button.opacity = item.active ? 255 : 0));
      return button;
    }

    _createFooterButton(iconName, accessibleName, onClicked) {
      const button = new St.Button({
        style_class: "icon-button pr-monitor-footer-button",
        accessible_name: accessibleName,
        can_focus: true,
        child: new St.Icon({ icon_name: iconName }),
      });
      button.connect("clicked", () => onClicked());
      return button;
    }

    _updateFooter() {
      const { snapshot, error, refreshing } = this._status;

      this._errorItem.label.text = error ?? "";
      this._errorItem.visible = !!error;

      this._refreshButton.reactive = !refreshing;
      if (refreshing) this._statusLabel.text = "Checking…";
      else if (snapshot) this._statusLabel.text = `Updated ${relativeTime(snapshot.fetchedAt, Date.now())}`;
      else this._statusLabel.text = "Not checked yet";
    }
  },
);
