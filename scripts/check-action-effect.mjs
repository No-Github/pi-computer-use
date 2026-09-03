import assert from "node:assert/strict";
import { assessActionEffect } from "../src/action-effect.ts";

const node = (ref, overrides = {}) => ({
	ref,
	role: "AXButton",
	title: "Open",
	description: "",
	value: "",
	focused: false,
	actions: ["AXPress"],
	canPress: true,
	canFocus: false,
	canSetValue: false,
	canScroll: false,
	canIncrement: false,
	canDecrement: false,
	isTextInput: false,
	pictureOnly: false,
	truncated: false,
	text: [],
	children: [],
	...overrides,
});
const outline = (target) => ({ root: target, nodes: [target] });

const focused = assessActionEffect({
	actions: [{ action: "click", ref: "@e1" }],
	before: outline(node("@e1")),
	after: outline(node("@e1", { focused: true })),
});
assert.deepEqual(focused, { verified: true, source: "successor_state", changedRefs: ["@e1"] });

const disappeared = assessActionEffect({
	actions: [{ action: "press", ref: "@e1" }],
	before: outline(node("@e1")),
	after: outline(node("@root")),
});
assert.deepEqual(disappeared, { verified: true, source: "successor_state", changedRefs: ["@e1"] });

const openedWindow = assessActionEffect({
	actions: [{ action: "click", x: 20, y: 30 }],
	before: outline(node("@root", { role: "AXWindow", title: "Main" })),
	after: outline(node("@root", { role: "AXWindow", title: "Main" })),
	rootDelta: [{ change: "appeared", kind: "window", pid: 7 }],
});
assert.deepEqual(openedWindow, { verified: true, source: "helper_evidence", changedRefs: [], reason: "root_appeared" });

const navigated = assessActionEffect({
	actions: [{ action: "click", x: 20, y: 30 }],
	before: outline(node("@root", { role: "AXWebArea", title: "Before" })),
	after: outline(node("@root", { role: "AXWebArea", title: "After" })),
	helperEvidence: { windowChanged: true },
});
assert.deepEqual(navigated, { verified: true, source: "helper_evidence", changedRefs: [], reason: "window_changed" });

const ambiguous = assessActionEffect({
	actions: [{ action: "click", x: 20, y: 30 }],
	before: outline(node("@root", { role: "AXWindow", title: "Main" })),
	after: outline(node("@root", { role: "AXWindow", title: "Main", description: "unrelated" })),
});
assert.deepEqual(ambiguous, { verified: false, source: "none", changedRefs: [] });

const typed = assessActionEffect({
	actions: [{ action: "typeText", text: "hello" }],
	before: outline(node("@root", { role: "AXTextArea" })),
	after: outline(node("@root", { role: "AXTextArea" })),
	helperEvidence: { valueChanged: true },
});
assert.deepEqual(typed, { verified: true, source: "helper_evidence", changedRefs: [], reason: "value_changed" });

const setText = assessActionEffect({
	actions: [{ action: "setText", ref: "@e1", text: "done" }],
	before: outline(node("@e1", { role: "AXTextField", canSetValue: true, value: "draft" })),
	after: outline(node("@e1", { role: "AXTextField", canSetValue: true, value: "done" })),
});
assert.deepEqual(setText, { verified: true, source: "successor_state", changedRefs: ["@e1"], reason: "value_changed" });

const setTextMismatch = assessActionEffect({
	actions: [{ action: "setText", ref: "@e1", text: "done" }],
	before: outline(node("@e1", { role: "AXTextField", canSetValue: true, value: "draft" })),
	after: outline(node("@e1", { role: "AXTextField", canSetValue: true, value: "still draft" })),
});
assert.deepEqual(setTextMismatch, { verified: false, source: "none", changedRefs: [] });

console.log("Action effect checks passed.");
