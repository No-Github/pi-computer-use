import assert from "node:assert/strict";
import { classifyVerification } from "../src/verification.ts";

assert.deepEqual(classifyVerification({ expectation: true, conditionFound: true, preexisting: false }), {
	status: "verified",
	evidence: { source: "postcondition", conditionFound: true },
});
assert.deepEqual(classifyVerification({ expectation: true, conditionFound: true, preexisting: true }), {
	status: "preexisting",
	evidence: { source: "postcondition", conditionFound: true, preexisting: true },
});
assert.deepEqual(classifyVerification({ expectation: true, conditionFound: false }), {
	status: "failed",
	evidence: { source: "postcondition", conditionFound: false },
});
assert.deepEqual(classifyVerification({ expectation: false, observedValuesMatch: true }), {
	status: "verified",
	evidence: { source: "successor_state", observedValuesMatch: true },
});
assert.deepEqual(classifyVerification({
	expectation: false,
	effect: { verified: true, source: "helper_evidence", reason: "selection_changed", changedRefs: [] },
}), {
	status: "verified",
	evidence: { source: "helper_evidence", effect: { reason: "selection_changed", changedRefs: [] } },
});
assert.deepEqual(classifyVerification({ expectation: false, observedValuesMatch: false }), {
	status: "not_verified",
	evidence: { source: "none", observedValuesMatch: false },
});
assert.deepEqual(classifyVerification({ expectation: false }), {
	status: "not_verified",
	evidence: { source: "none" },
});
assert.equal(classifyVerification({ expectation: true, conditionFound: true, preexisting: false }).evidence.source, "postcondition");

console.log("Verification checks passed.");
