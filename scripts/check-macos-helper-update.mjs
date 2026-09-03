import assert from "node:assert/strict";
import { helperVersionNeedsRefresh } from "../src/platform/macos/helper.ts";

assert.equal(helperVersionNeedsRefresh("0.5.3", "0.5.2"), true);
assert.equal(helperVersionNeedsRefresh("0.5.3", "0.5.3"), false);
assert.equal(helperVersionNeedsRefresh(undefined, "0.5.2"), false);
console.log("macOS helper refreshes when the installed bundle is stale");
