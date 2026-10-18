# PR Monitor

GNOME Shell extension that watches Azure DevOps pull requests from the top bar.

- **My pull requests**: who approved (✓), is waiting for you (⧗), rejected (✗) or hasn't voted yet (○), build status,
  merge conflicts, unresolved comment threads ("3 active"), draft marker, and a
  green **Ready** when it can be merged
- **To review**: active PRs where you're a reviewer and haven't voted yet (drafts hidden)
- **Recently closed**: your last 5 completed or abandoned PRs, in a collapsed row

Ready means: not a draft, no conflicts, at least one reviewer and every
reviewer (except those who declined) approved, no unresolved comment threads,
build passed or none configured, and every blocking branch policy passes.
Green is used only for Ready; approvals and passed builds are grey.

Hovering an open PR shows a copy button that puts its branch name on the
clipboard; clicking anywhere else on the row opens the PR.

The badge counts what needs you: PRs waiting for your review, plus your PRs
that are blocked (failed build, conflicts, unresolved comments, or a reviewer
waiting/rejected).
The icon turns red when one of your PRs has a failed build or conflicts.

Notifications (click to open the PR):

- you were added as a reviewer
- someone voted on your PR
- new comments on your PR (not system messages, not your own)
- a build failed on your PR
- your PR was completed

Targets GNOME Shell 50 and 51. Checks every 10 minutes by default, and again
when you open the menu if the data is more than a minute old.

## Setup

```sh
./dev.sh install                  # compiles schemas, symlinks into ~/.local/share/gnome-shell/extensions
# log out and back in (Wayland only discovers new extensions at login)
gnome-extensions enable pr-monitor@adaspt
gnome-extensions prefs pr-monitor@adaspt
```

In preferences, set:

- **Organization URL**: `https://dev.azure.com/<org>`
- **Project**: the project name
- **Personal access token**: create one under *User settings → Personal access
  tokens* with **Code (Read)** and **Build (Read)**. It's stored in the GNOME
  keyring, not in GSettings.

## Development

```sh
./dev.sh test      # unit tests for everything under lib/ (plain gjs, no shell needed)
./dev.sh nested    # run a separate GNOME Shell in a window (needs: sudo dnf install mutter-devkit)
./dev.sh log       # follow GNOME Shell's log
```

After changing shell-side code, restart the nested shell, or log out and back
in. Preferences changes only need the window reopened.

## Layout

| File | Role |
|---|---|
| `extension.js` | Entry point: wires monitor, indicator and notifier together |
| `indicator.js` | Panel button and menu |
| `notifier.js` | Desktop notifications |
| `prefs.js` | Preferences window |
| `lib/api.js` | Azure DevOps REST client (Soup) |
| `lib/fetch.js` | Fetches everything one poll needs |
| `lib/snapshot.js` | Turns API responses into a plain snapshot |
| `lib/diff.js` | Compares two snapshots and returns typed events |
| `lib/format.js` | Notification texts, relative times |
| `lib/monitor.js` | Poll timer, settings, state, error handling |
| `lib/state.js` | Last snapshot on disk (`~/.cache/pr-monitor/state.json`) |
| `lib/secret.js` | Token in the keyring (libsecret) |

`lib/` has no GNOME Shell imports, so it can be tested with plain `gjs`.

The first successful check is a silent baseline. Later checks are compared
with the previous snapshot (kept on disk across restarts) and only the
differences produce notifications. A check where any request fails is
discarded as a whole, so a partial result never looks like comments or builds
disappearing and coming back.

To add a feature, add a field to the snapshot (`lib/snapshot.js`), an event
type to the diff (`lib/diff.js`) with its text in `lib/format.js`, and the
row or chip in `indicator.js`.
