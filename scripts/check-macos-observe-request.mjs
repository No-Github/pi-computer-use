import assert from "node:assert/strict";
import { buildMacosObserveArgs } from "../src/platform/macos/backend.ts";

const args = buildMacosObserveArgs({
	target: { pid: 717, rootRef: "@r8", windowId: 0 },
	readText: "never",
	includeImage: false,
});

assert.equal(args.pid, 717, "observe must forward the resolved app PID");
assert.equal(args.windowId, undefined, "invalid window IDs must remain omitted");
assert.equal(args.windowRef, "@r8");
console.log("macOS observe request keeps PID fallback for native roots");
