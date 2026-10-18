import System from "system";

import { run } from "./harness.js";

import "./diff.test.js";
import "./fetch.test.js";
import "./format.test.js";
import "./snapshot.test.js";

const failed = await run();
if (failed) System.exit(1);
