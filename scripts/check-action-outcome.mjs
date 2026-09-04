import assert from "node:assert/strict";
import { actionOutcomeForTrace, actionOutcomeFromExecution } from "../src/action-outcome.ts";

assert.deepEqual(
	actionOutcomeFromExecution({ stage: "preflight", reason: "visual_observation_unavailable" }),
	{ status: "not_dispatched", reason: "visual_observation_unavailable", dispatchedActions: 0 },
	"a failed preflight must state that zero actions were dispatched",
);

assert.deepEqual(
	actionOutcomeFromExecution({ stage: "delivered", reason: "post_action_observation_failed", dispatchedActions: 2 }),
	{ status: "dispatched_unverified", reason: "post_action_observation_failed", dispatchedActions: 2 },
	"a failed successor observation must not erase successful delivery",
);

assert.deepEqual(
	actionOutcomeFromExecution({ stage: "verified", reason: "successor", dispatchedActions: 1 }),
	{ status: "verified", reason: "successor", dispatchedActions: 1 },
	"verified actions must retain their evidence source",
);

assert.deepEqual(
	actionOutcomeForTrace({ outcome: "didnt", steps: [{ outcome: "didnt" }] }),
	{ status: "not_dispatched", reason: "delivery_failed", dispatchedActions: 0 },
	"a rejected first action must not be reported as dispatched",
);

assert.deepEqual(
	actionOutcomeForTrace({ outcome: "didnt", steps: [{ outcome: "worked" }, { outcome: "didnt" }] }),
	{ status: "dispatched_unverified", reason: "delivery_failed", dispatchedActions: 1 },
	"a successful prefix must be preserved when a later action fails",
);

assert.deepEqual(
	actionOutcomeForTrace({ outcome: "unknown", actionCount: 1 }),
	{ status: "dispatched_unverified", reason: "delivery_unknown", dispatchedActions: 1 },
);

assert.deepEqual(
	actionOutcomeForTrace({ outcome: "worked", actionCount: 1, verification: { status: "verified", source: "successor_state" } }),
	{ status: "verified", reason: "successor", dispatchedActions: 1 },
);

assert.deepEqual(
	actionOutcomeForTrace({ outcome: "worked", actionCount: 1, verification: { status: "preexisting", source: "postcondition" } }),
	{ status: "dispatched_unverified", reason: "effect_not_verified", dispatchedActions: 1 },
	"a preexisting condition must not prove that the action caused an effect",
);

console.log("Action outcome checks passed.");
