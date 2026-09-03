import assert from "node:assert/strict";
import { startActionTransaction, transitionActionTransaction } from "../src/transactions.ts";

const started = startActionTransaction("state-1", "@r1", "desktop-pid:42", 3, "tx-1");
assert.deepEqual(started, {
	id: "tx-1",
	phase: "observed",
	baseStateId: "state-1",
	rootRef: "@r1",
	resourceKey: "desktop-pid:42",
	epoch: 3,
});

const executing = transitionActionTransaction(started, "executing");
const delivered = transitionActionTransaction(executing, "delivered");
const verifying = transitionActionTransaction(delivered, "verifying");
const verified = transitionActionTransaction(verifying, "verified");
const successor = transitionActionTransaction(verified, "successor");
assert.equal(successor.phase, "successor");
assert.equal(started.phase, "observed", "transaction transitions must be immutable");

assert.equal(transitionActionTransaction(delivered, "successor").phase, "successor", "transactions without expect may finish after delivery and capture");
assert.equal(transitionActionTransaction(executing, "terminal").phase, "terminal");
assert.throws(() => transitionActionTransaction(started, "verified"), /Invalid action transaction transition/);
assert.throws(() => transitionActionTransaction(successor, "executing"), /Invalid action transaction transition/);

console.log("Action transaction checks passed.");
