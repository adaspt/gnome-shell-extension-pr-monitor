import { describeEvent, nameList, relativeTime, shortName } from "../lib/format.js";
import { assertEqual, test } from "./harness.js";

test("relative time", () => {
  const minute = 60 * 1000;
  assertEqual(relativeTime(0, 30 * 1000), "just now");
  assertEqual(relativeTime(0, 5 * minute), "5 min ago");
  assertEqual(relativeTime(0, 3 * 60 * minute), "3 h ago");
  assertEqual(relativeTime(0, 24 * 60 * minute), "yesterday");
  assertEqual(relativeTime(0, 72 * 60 * minute), "3 days ago");
});

test("event descriptions", () => {
  const pr = { title: "Fix login", author: "Bob", url: "u" };
  assertEqual(describeEvent({ type: "vote-changed", pr, reviewer: "Ann", vote: 10 }).title, "Ann approved");
  assertEqual(describeEvent({ type: "review-requested", pr }).body, "Bob: Fix login");

  const one = describeEvent({ type: "comments-added", pr, comments: [{ author: "Ann", text: "nit" }] });
  assertEqual([one.title, one.body], ["Ann commented", "Fix login\nnit"]);

  const many = describeEvent({
    type: "comments-added",
    pr,
    comments: [{ author: "Ann" }, { author: "Ann" }, { author: "Bob" }],
  });
  assertEqual([many.title, many.body], ["3 new comments", "Fix login\nAnn, Bob"]);
});

test("short names", () => {
  assertEqual(shortName("Ann Smith"), "Ann");
  assertEqual(shortName("Smith, Ann"), "Ann");
  assertEqual(shortName("Ann Smith (Contractor)"), "Ann");
  assertEqual(shortName("[Team] Ann Smith"), "Ann");
  assertEqual(shortName("ann"), "ann");
  assertEqual(shortName("Smith,"), "Smith");
});

test("name lists", () => {
  assertEqual(nameList(["Ann"]), "Ann");
  assertEqual(nameList(["Ann", "Bob"]), "Ann, Bob");
  assertEqual(nameList(["Ann", "Bob", "Carol", "Dan"]), "Ann, Bob +2");
});
