export type VerificationStatus = "verified" | "preexisting" | "failed" | "not_verified";

export interface VerificationResult {
	status: VerificationStatus;
	evidence: {
		source: "postcondition" | "successor_state" | "helper_evidence" | "none";
		conditionFound?: boolean;
		preexisting?: boolean;
		observedValuesMatch?: boolean;
		effect?: {
			reason?: string;
			changedRefs?: string[];
		};
	};
}

export function classifyVerification(input: {
	expectation: boolean;
	conditionFound?: boolean;
	preexisting?: boolean;
	observedValuesMatch?: boolean;
	effect?: {
		verified: boolean;
		source: "successor_state" | "helper_evidence" | "none";
		reason?: string;
		changedRefs: string[];
	};
}): VerificationResult {
	if (input.expectation) {
		const conditionFound = input.conditionFound === true;
		return {
			status: conditionFound ? (input.preexisting ? "preexisting" : "verified") : "failed",
			evidence: {
				source: "postcondition",
				conditionFound,
				...(input.preexisting ? { preexisting: true } : {}),
			},
		};
	}
	if (input.effect?.verified) {
		return {
			status: "verified",
			evidence: {
				source: input.effect.source,
				effect: { reason: input.effect.reason, changedRefs: input.effect.changedRefs },
			},
		};
	}
	if (input.observedValuesMatch === true) {
		return { status: "verified", evidence: { source: "successor_state", observedValuesMatch: true } };
	}
	return {
		status: "not_verified",
		evidence: {
			source: "none",
			...(input.observedValuesMatch === false ? { observedValuesMatch: false } : {}),
		},
	};
}
