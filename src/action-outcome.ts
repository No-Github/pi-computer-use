export type ActionOutcomeReason =
	| "visual_observation_unavailable"
	| "target_unavailable"
	| "delivery_failed"
	| "delivery_unknown"
	| "post_action_observation_failed"
	| "postcondition_failed"
	| "effect_not_verified"
	| "successor"
	| "postcondition"
	| "helper_evidence";

export type ActionOutcome =
	| { status: "not_dispatched"; reason: ActionOutcomeReason; dispatchedActions: 0 }
	| { status: "dispatched_unverified"; reason: ActionOutcomeReason; dispatchedActions: number }
	| { status: "verified"; reason: "successor" | "postcondition" | "helper_evidence"; dispatchedActions: number };

export type ActionExecutionState =
	| { stage: "preflight"; reason: ActionOutcomeReason }
	| { stage: "delivered"; reason: ActionOutcomeReason; dispatchedActions: number }
	| { stage: "verified"; reason: "successor" | "postcondition" | "helper_evidence"; dispatchedActions: number };

export function actionOutcomeFromExecution(state: ActionExecutionState): ActionOutcome {
	if (state.stage === "preflight") {
		return { status: "not_dispatched", reason: state.reason, dispatchedActions: 0 };
	}
	if (state.stage === "verified") {
		return { status: "verified", reason: state.reason, dispatchedActions: state.dispatchedActions };
	}
	return { status: "dispatched_unverified", reason: state.reason, dispatchedActions: state.dispatchedActions };
}

type TraceOutcome = "worked" | "didnt" | "unknown";

export interface ActionOutcomeTrace {
	outcome?: TraceOutcome;
	actionCount?: number;
	steps?: Array<{ outcome?: TraceOutcome }>;
	verification?: {
		status?: "verified" | "preexisting" | "failed" | "not_verified";
		source?: "postcondition" | "successor_state" | "helper_evidence" | "none";
	};
}

function dispatchedActionCount(trace: ActionOutcomeTrace): number {
	if (trace.steps?.length) {
		let count = 0;
		for (const step of trace.steps) {
			if (step.outcome === "didnt") break;
			count += 1;
		}
		return count;
	}
	return trace.outcome === "didnt" ? 0 : Math.max(0, trace.actionCount ?? 0);
}

export function actionOutcomeForTrace(trace: ActionOutcomeTrace): ActionOutcome {
	const dispatchedActions = dispatchedActionCount(trace);
	if (trace.outcome === "didnt") {
		return dispatchedActions === 0
			? actionOutcomeFromExecution({ stage: "preflight", reason: "delivery_failed" })
			: actionOutcomeFromExecution({ stage: "delivered", reason: "delivery_failed", dispatchedActions });
	}
	if (trace.outcome === "unknown") {
		return actionOutcomeFromExecution({ stage: "delivered", reason: "delivery_unknown", dispatchedActions });
	}
	if (trace.verification?.status === "verified") {
		const reason = trace.verification.source === "postcondition"
			? "postcondition"
			: trace.verification.source === "helper_evidence"
				? "helper_evidence"
				: "successor";
		return actionOutcomeFromExecution({ stage: "verified", reason, dispatchedActions });
	}
	const reason = trace.verification?.status === "failed" ? "postcondition_failed" : "effect_not_verified";
	return actionOutcomeFromExecution({ stage: "delivered", reason, dispatchedActions });
}
