import Gio from "gi://Gio";
import GLib from "gi://GLib";

Gio._promisify(Gio.File.prototype, "load_contents_async");
Gio._promisify(Gio.File.prototype, "replace_contents_bytes_async", "replace_contents_finish");

// The last snapshot is kept on disk so a restart or re-login diffs against
// what was seen before, instead of re-notifying or silently re-baselining.
const DIRECTORY = GLib.build_filenamev([GLib.get_user_cache_dir(), "pr-monitor"]);
const FILE = Gio.File.new_for_path(GLib.build_filenamev([DIRECTORY, "state.json"]));

export async function loadState() {
  try {
    const [contents] = await FILE.load_contents_async(null);
    return JSON.parse(new TextDecoder().decode(contents));
  } catch {
    return null;
  }
}

export async function saveState(state) {
  GLib.mkdir_with_parents(DIRECTORY, 0o700);
  const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(state)));
  await FILE.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}
