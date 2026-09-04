import assert from "node:assert/strict";
import { findNodeAtPoint, needsVisualRefresh, prepareAction } from "../src/actions.ts";

const node = (overrides = {}) => ({
  ref: "@e1", wireRef: "wire-1", role: "AXButton", subrole: "", identifier: "", title: "", description: "", value: "",
  actions: ["AXPress"], canPress: true, canFocus: false, canSetValue: false, canScroll: false, canIncrement: false, canDecrement: false,
  isTextInput: false, rect: { x: 0, y: 0, w: 200, h: 100 }, focused: false, offscreen: false, pictureOnly: false, truncated: false, text: [], children: [], ...overrides,
});

const outer = node({ ref: "@e1", wireRef: "outer", rect: { x: 0, y: 0, w: 200, h: 100 } });
const inner = node({ ref: "@e2", wireRef: "inner", rect: { x: 20, y: 20, w: 40, h: 20 } });
assert.equal(findNodeAtPoint([outer, inner], 30, 30, "click"), inner, "smallest actionable node wins");
assert.equal(findNodeAtPoint([node({ pictureOnly: true }), inner], 30, 30, "click"), inner, "picture-only nodes are ignored");
assert.equal(findNodeAtPoint([outer], 300, 300, "click"), undefined, "points outside outline do not guess a target");
assert.equal(needsVisualRefresh([{ action: "click", x: 300, y: 300 }], [outer], false), true, "unresolved coordinate requests one visual refresh");
assert.equal(needsVisualRefresh([{ action: "click", x: 30, y: 30 }], [outer, inner], false), false, "semantic coordinate fallback avoids visual refresh");
assert.equal(needsVisualRefresh([{ action: "click", x: 300, y: 300 }], [outer], true), false, "image-bearing observations do not refresh");

const prepared = prepareAction({ action: "click", x: 30, y: 30 }, { currentFocus: false }, {
  headless: false,
  node: (ref) => ref === inner.ref ? inner : outer,
  nodeAtPoint: (x, y, operation) => findNodeAtPoint([outer, inner], x, y, operation),
  center: (value) => ({ x: value.rect.x + value.rect.w / 2, y: value.rect.y + value.rect.h / 2 }),
  validatePoint: () => {},
});
assert.deepEqual(prepared.target, { ref: "inner" }, "coordinate action safely degrades to semantic wire ref");

const textInput = node({ ref: "@e3", wireRef: "input-1", role: "AXTextField", isTextInput: true, canFocus: true, canPress: false, rect: { x: 10, y: 10, w: 100, h: 20 } });
const inputClick = prepareAction({ action: "click", ref: textInput.ref }, { currentFocus: false }, {
  headless: false,
  node: () => textInput,
  center: (value) => ({ x: value.rect.x + value.rect.w / 2, y: value.rect.y + value.rect.h / 2 }),
  validatePoint: () => {},
});
assert.deepEqual(inputClick.target, { ref: "input-1" }, "outline-only text fields use semantic focus instead of requiring pixels");
assert.equal(inputClick.establishesFocus, true, "semantic text-field clicks establish focus for following input");

const focused = prepareAction({ action: "typeText", text: "hello" }, { currentFocus: true, focusRef: "inner" }, {
  headless: false,
  image: undefined,
  node: () => inner,
  center: (value) => ({ x: value.rect.x + value.rect.w / 2, y: value.rect.y + value.rect.h / 2 }),
  validatePoint: () => {},
});
assert.deepEqual(focused.target, { ref: "inner" }, "focused text input keeps the semantic target across an action boundary");

const shortcut = prepareAction({ action: "keypress", ref: "inner", keys: ["CMD", "L"] }, { currentFocus: false }, {
  headless: false,
  image: { width: 100, height: 100 },
  node: () => outer,
  center: (value) => ({ x: value.rect.x + value.rect.w / 2, y: value.rect.y + value.rect.h / 2 }),
  validatePoint: () => {},
});
assert.deepEqual(shortcut.params.keys, ["CMD", "L"], "shortcut keypress remains distinct from literal text input");

console.log("action robustness checks passed");
