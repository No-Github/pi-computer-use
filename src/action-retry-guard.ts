import type { ActionOutcome } from "./action-outcome.ts";

type FailureState = {
	key: string;
	count: number;
};

function actionOutcome(details: unknown): ActionOutcome | undefined {
	if (!details || typeof details !== "object") return undefined;
	const value = (details as { actionOutcome?: unknown }).actionOutcome;
	if (!value || typeof value !== "object") return undefined;
	const outcome = value as Partial<ActionOutcome>;
	if (outcome.status !== "not_dispatched" && outcome.status !== "dispatched_unverified" && outcome.status !== "verified") return undefined;
	if (typeof outcome.reason !== "string" || !Number.isInteger(outcome.dispatchedActions)) return undefined;
	return outcome as ActionOutcome;
}

export class ActionRetryGuard {
	private failure?: FailureState;

	reset(): void {
		this.failure = undefined;
	}

	blockReason(toolName: string): string | undefined {
		if (toolName !== "act_ui" || !this.failure || this.failure.count < 2) return undefined;
		return "act_ui blocked after two consecutive failures of the same kind. Observe the current UI successfully before another attempt, or ask the user to take over.";
	}

	record(toolName: string, isError: boolean, details: unknown): void {
		if (toolName === "observe_ui") {
			if (!isError) this.reset();
			return;
		}
		if (toolName !== "act_ui") return;
		const outcome = actionOutcome(details);
		if (!outcome) return;
		if (outcome.status === "verified") {
			this.reset();
			return;
		}
		const key = `${outcome.status}:${outcome.reason}`;
		this.failure = this.failure?.key === key
			? { key, count: this.failure.count + 1 }
			: { key, count: 1 };
	}
}
