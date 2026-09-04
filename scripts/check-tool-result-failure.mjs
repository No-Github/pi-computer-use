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
assert.equal(toolResultFailureMessage("act_ui", result({ execution: { outcome: "worked" } })), undefined);
assert.equal(toolResultFailureMessage("observe_ui", result({ execution: { outcome: "didnt" } })), undefined);

console.log("Tool result failure checks passed.");
