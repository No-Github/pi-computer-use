import assert from "node:assert/strict";
import { MacosHelperClient, helperBinaryNeedsRefresh, helperInstallNeedsRefresh, helperVersionNeedsRefresh, selectHelperSourceHash } from "../src/platform/macos/helper.ts";

assert.equal(helperVersionNeedsRefresh("0.5.3", "0.5.2"), true);
assert.equal(helperVersionNeedsRefresh("0.5.3", "0.5.3"), false);
assert.equal(helperVersionNeedsRefresh(undefined, "0.5.2"), false);
assert.equal(helperBinaryNeedsRefresh("new-hash", "old-hash"), true);
assert.equal(helperBinaryNeedsRefresh("same-hash", "same-hash"), false);
assert.equal(helperBinaryNeedsRefresh(undefined, "old-hash"), false);
assert.equal(helperBinaryNeedsRefresh("new-hash", undefined), true);
assert.equal(selectHelperSourceHash("source-marker", "signed-app", "loose-binary"), "source-marker");
assert.equal(selectHelperSourceHash(undefined, "signed-app", "loose-binary"), "signed-app");
assert.equal(selectHelperSourceHash(undefined, undefined, "loose-binary"), "loose-binary");
assert.equal(helperInstallNeedsRefresh({
	expectedVersion: "0.5.5",
	installedVersion: "0.5.5",
	expectedSourceHash: "source-hash",
	installedSourceHash: "source-hash",
}), false, "a post-install signature may change executable bytes without making the installed source stale");
assert.equal(helperInstallNeedsRefresh({
	expectedVersion: "0.5.5",
	installedVersion: "0.5.5",
	expectedSourceHash: "source-hash",
	installedSourceHash: "old-source-hash",
}), true);

let setupCalls = 0;
let shutdownCalls = 0;
let diagnosticsCalls = 0;
const client = new MacosHelperClient({
	isExecutable: async () => true,
	packageVersion: async () => "0.5.5",
	installedHelperVersion: async () => "0.5.4",
	bundledHelperSourceHash: async () => "source-hash",
	installedHelperSourceHash: async () => "old-source-hash",
	runSetup: async () => { setupCalls += 1; },
	wait: async () => {},
});
client.daemonCommand = async (command) => {
	if (command === "shutdown") {
		shutdownCalls += 1;
		return {};
	}
	if (command === "diagnostics") {
		diagnosticsCalls += 1;
		return {};
	}
	throw new Error(`Unexpected command: ${command}`);
};
client.daemonAvailable = true;
await client.ensureInstalled();
assert.equal(shutdownCalls, 1);
assert.equal(setupCalls, 1);
await client.ensureDaemon();
assert.equal(diagnosticsCalls, 1, "replacement must invalidate the cached daemon before the next tool call");
console.log("macOS helper refreshes when the installed bundle is stale");
