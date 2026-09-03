import { randomUUID } from "node:crypto";

export type ActionTransactionPhase = "observed" | "executing" | "delivered" | "verifying" | "verified" | "successor" | "terminal";

export interface ActionTransactionContext {
	id: string;
	phase: ActionTransactionPhase;
	baseStateId: string;
	rootRef?: string;
	resourceKey: string;
	epoch: number;
}

const transitions: Record<ActionTransactionPhase, readonly ActionTransactionPhase[]> = {
	observed: ["executing", "terminal"],
	executing: ["delivered", "terminal"],
	delivered: ["verifying", "successor", "terminal"],
	verifying: ["verified", "terminal"],
	verified: ["successor", "terminal"],
	successor: [],
	terminal: [],
};

export function startActionTransaction(baseStateId: string, rootRef: string | undefined, resourceKey: string, epoch: number, id = randomUUID()): ActionTransactionContext {
	return { id, phase: "observed", baseStateId, rootRef, resourceKey, epoch };
}

export function transitionActionTransaction(context: ActionTransactionContext, phase: ActionTransactionPhase): ActionTransactionContext {
	if (!transitions[context.phase].includes(phase)) {
		throw new Error(`Invalid action transaction transition '${context.phase}' -> '${phase}'.`);
	}
	return { ...context, phase };
}
