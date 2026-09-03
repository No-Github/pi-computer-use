import assert from "node:assert/strict";
import { pointInVisualTarget, validateVisualTarget } from "../src/visual-target.ts";

const target = {
	stateId: "state-1",
	capturedAt: 1000,
	rootRef: "@r1",
	rect: { x: 10, y: 20, w: 100, h: 80 },
	label: "editor canvas",
};

assert.equal(validateVisualTarget(target, { stateId: "state-1", capturedAt: 1000, rootRef: "@r1", image: { width: 800, height: 600 } }).valid, true);
assert.equal(pointInVisualTarget(target, { x: 10, y: 20 }), true);
assert.equal(pointInVisualTarget(target, { x: 110, y: 100 }), false, "the bottom-right edge is exclusive");
assert.equal(validateVisualTarget({ ...target, stateId: "state-0" }, { stateId: "state-1", capturedAt: 1000, rootRef: "@r1", image: { width: 800, height: 600 } }).reason, "state_mismatch");
assert.equal(validateVisualTarget({ ...target, rootRef: "@r2" }, { stateId: "state-1", capturedAt: 1000, rootRef: "@r1", image: { width: 800, height: 600 } }).reason, "root_mismatch");
assert.equal(validateVisualTarget({ ...target, capturedAt: 999 }, { stateId: "state-1", capturedAt: 1000, rootRef: "@r1", image: { width: 800, height: 600 } }).reason, "capture_mismatch");
assert.equal(validateVisualTarget({ ...target, rect: { x: -1, y: 20, w: 100, h: 80 } }, { stateId: "state-1", capturedAt: 1000, rootRef: "@r1", image: { width: 800, height: 600 } }).reason, "out_of_bounds");

console.log("Visual target checks passed.");
