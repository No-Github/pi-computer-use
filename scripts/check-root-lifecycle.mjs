import assert from "node:assert/strict";
import { resolveRootReference, rootIdentityKey, rootResolutionError, updateRootReference } from "../src/root-lifecycle.ts";

const root = (overrides = {}) => ({
	pid: 42,
	windowId: 7,
	nativeWindowRef: "AX-7",
	title: "Editor",
	framePoints: { x: 0, y: 0, w: 800, h: 600 },
	...overrides,
});

const first = updateRootReference(undefined, root(), 1000, "@r1");
assert.equal(first.generation, 1);
assert.equal(first.firstSeenAt, 1000);
assert.equal(first.lastSeenAt, 1000);
assert.equal(rootIdentityKey(root()), "pid:42|id:7");

const refreshed = updateRootReference(first, root({ title: "Editor - file.ts" }), 2000);
assert.equal(refreshed.ref, "@r1");
assert.equal(refreshed.generation, 1, "same stable identity should keep its generation");
assert.equal(refreshed.lastSeenAt, 2000);

const sameWindow = resolveRootReference(refreshed, [root({ title: "Editor - file.ts" })]);
assert.equal(sameWindow.kind, "matched");

const rebuilt = resolveRootReference(refreshed, [root({ windowId: 8, nativeWindowRef: "AX-8" })]);
assert.equal(rebuilt.kind, "replaced", "a missing stable identity with a same-title root is a replacement");
assert.equal(rebuilt.retryable, true);
const rebuiltError = rootResolutionError(refreshed, rebuilt);
assert.equal(rebuiltError.code, "root_replaced");
assert.equal(rebuiltError.rootRef, "@r1");
assert.equal(rebuiltError.expectedIdentity, "pid:42|id:7");
assert.equal(rebuiltError.retryable, true);

const closed = resolveRootReference(refreshed, []);
assert.equal(closed.kind, "closed");
assert.equal(closed.retryable, true);

const weak = updateRootReference(undefined, root({ windowId: undefined, nativeWindowRef: undefined }), 3000, "@r2");
assert.equal(rootIdentityKey(weak), "pid:42|title:editor|frame:0,0,800,600");
assert.equal(resolveRootReference(weak, [root({ windowId: undefined, nativeWindowRef: undefined })]).kind, "matched");
assert.equal(resolveRootReference(weak, [
	root({ windowId: undefined, nativeWindowRef: undefined, framePoints: { x: 20, y: 20, w: 500, h: 400 } }),
	root({ windowId: undefined, nativeWindowRef: undefined, framePoints: { x: 40, y: 40, w: 500, h: 400 } }),
]).kind, "ambiguous");

console.log("Root lifecycle checks passed.");
