import assert from "node:assert/strict";
import { ActionRetryGuard } from "../src/action-retry-guard.ts";

const failure = {
	status: "not_dispatched",
	reason: "visual_observation_unavailable",
	dispatchedActions: 0,
};

const guard = new ActionRetryGuard();
guard.record("act_ui", false, { actionOutcome: failure });
assert.equal(guard.blockReason("act_ui"), undefined);
guard.record("act_ui", false, { actionOutcome: failure });
assert.match(guard.blockReason("act_ui") ?? "", /two consecutive/i);
assert.equal(guard.blockReason("observe_ui"), undefined);

guard.record("observe_ui", false, { status: "ok" });
assert.equal(guard.blockReason("act_ui"), undefined, "a successful observation permits a fresh action attempt");

guard.record("act_ui", false, { actionOutcome: failure });
guard.record("act_ui", false, {
	actionOutcome: { status: "not_dispatched", reason: "target_unavailable", dispatchedActions: 0 },
});
assert.equal(guard.blockReason("act_ui"), undefined, "different failure reasons are not one consecutive class");

guard.record("act_ui", false, { actionOutcome: failure });
guard.record("act_ui", false, { actionOutcome: failure });
guard.record("act_ui", false, {
	actionOutcome: { status: "verified", reason: "successor", dispatchedActions: 1 },
});
assert.equal(guard.blockReason("act_ui"), undefined, "verified actions clear earlier failures");

console.log("Action retry guard checks passed.");
