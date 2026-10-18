import { Vote } from "./snapshot.js";

export function voteLabel(vote) {
  switch (vote) {
    case Vote.APPROVED:
      return "approved";
    case Vote.APPROVED_WITH_SUGGESTIONS:
      return "approved with suggestions";
    case Vote.WAITING_FOR_AUTHOR:
      return "is waiting for author";
    case Vote.REJECTED:
      return "rejected";
    default:
      return "reset their vote";
  }
}

// "Ann Smith", "Smith, Ann" and "Ann Smith (Contractor)" all become "Ann".
export function shortName(displayName) {
  let name = displayName.replace(/\s*[([].*?[)\]]/g, "").trim();
  if (name.includes(",")) {
    const [last, first] = name.split(",", 2).map((part) => part.trim());
    name = first || last;
  }
  return name.split(/\s+/)[0] || displayName;
}

// "Ann, Bob" or, past `max` names, "Ann, Bob +2".
export function nameList(names, max = 2) {
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}

export function relativeTime(then, now) {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Notification title and body for one diff event. */
export function describeEvent(event) {
  const { pr } = event;

  switch (event.type) {
    case "review-requested":
      return { title: "Review requested", body: `${pr.author}: ${pr.title}`, url: pr.url };

    case "vote-changed":
      return { title: `${event.reviewer} ${voteLabel(event.vote)}`, body: pr.title, url: pr.url };

    case "comments-added": {
      const { comments } = event;
      if (comments.length === 1) {
        const [comment] = comments;
        return { title: `${comment.author} commented`, body: `${pr.title}\n${comment.text}`, url: pr.url };
      }

      const authors = [...new Set(comments.map((comment) => comment.author))].join(", ");
      return { title: `${comments.length} new comments`, body: `${pr.title}\n${authors}`, url: pr.url };
    }

    case "build-failed":
      return { title: "Build failed", body: pr.title, url: pr.url };

    case "pr-completed":
      return { title: "Pull request completed", body: pr.title, url: pr.url };

    default:
      return { title: event.type, body: pr.title, url: pr.url };
  }
}
