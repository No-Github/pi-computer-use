import assert from "node:assert/strict";
import { toolResultFailureMessage } from "../src/bridge.ts";

const result = (details, text = "tool output") => ({
	content: [{ type: "text", text }],
	details,
});

assert.match(
	toolResultFailureMessage("act_ui", result({ execution: { outcome: "didnt" } })) ?? "",
	/not delivered/,
);
assert.match(
	toolResultFailureMessage("act_ui", result({ execution: { outcome: "didnt", error: { message: "valueChanged=false" } } })) ?? "",
	/valueChanged=false/,
);
assert.match(
	toolResultFailureMessage("act_ui", result({ execution: { outcome: "unknown" } })) ?? "",
	/uncertain/,
);
assert.match(
	toolResultFailureMessage("act_ui", result({ status: "post_action_observation_failed", error: { message: "capture unavailable" } })) ?? "",
	/capture unavailable/,
);
assert.match(
	toolResultFailureMessage("act_ui", result({ execution: { verification: { status: "failed" } } })) ?? "",
	/postcondition/,
);
assert.match(
	toolResultFailureMessage("act_ui", result({ execution: { verification: { status: "not_verified" } } })) ?? "",
	/not verify an observable effect/,
);
assert.match(
	toolResultFailureMessage("act_ui", result({ actionOutcome: { status: "not_dispatched", reason: "visual_observation_unavailable", dispatchedActions: 0 }, execution: { outcome: "worked" } })) ?? "",
	/zero UI actions were executed/i,
);
assert.match(
	toolResultFailureMessage("act_ui", result({ actionOutcome: { status: "dispatched_unverified", reason: "post_action_observation_failed", dispatchedActions: 2 } })) ?? "",
	/2 UI actions were dispatched but not verified/i,
);
assert.equal(
	toolResultFailureMessage("act_ui", result({ status: "target_closed", actionOutcome: { status: "verified", reason: "postcondition", dispatchedActions: 1 } })),
	undefined,
	"a structured verified outcome takes precedence over compatibility status fields",
);
assert.equal(toolResultFailureMessage("act_ui", result({ execution: { outcome: "worked" } })), undefined);
assert.equal(toolResultFailureMessage("observe_ui", result({ execution: { outcome: "didnt" } })), undefined);

console.log("Tool result failure checks passed.");
