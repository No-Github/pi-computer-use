import type { Outline, OutlineNode } from "./outline.ts";
import type { UiAction } from "./contract.ts";

export interface ActionEffectAssessment {
	verified: boolean;
	source: "successor_state" | "helper_evidence" | "none";
	changedRefs: string[];
	reason?: "target_changed" | "target_removed" | "root_appeared" | "root_closed" | "root_focused" | "value_changed" | "selection_changed" | "toggle_changed" | "scrolled" | "window_changed";
}

interface RootDelta {
	change: "appeared" | "closed" | "focused";
}

function nodeSignature(node: OutlineNode): string {
	return JSON.stringify({
		role: node.role,
		subrole: node.subrole,
		identifier: node.identifier,
		title: node.title,
		description: node.description,
		value: node.value,
		actions: node.actions,
		canPress: node.canPress,
		canFocus: node.canFocus,
		canSetValue: node.canSetValue,
		canScroll: node.canScroll,
		canIncrement: node.canIncrement,
		canDecrement: node.canDecrement,
		focused: node.focused,
		offscreen: node.offscreen,
		scrollExtent: node.scrollExtent,
		childCount: node.children.length,
	});
}

function actionCanUseRootEvidence(action: UiAction): boolean {
	return action.action === "click" || action.action === "press";
}

function actionCanUseHelperEvidence(action: UiAction): boolean {
	return action.action === "click" || action.action === "press" || action.action === "scroll" || action.action === "typeText" || action.action === "keypress";
}

function actionCanUseSuccessorState(action: UiAction): boolean {
	return action.action === "click" || action.action === "press" || action.action === "typeText" || action.action === "keypress" || action.action === "scroll";
}

export function assessActionEffect(input: {
	actions: UiAction[];
	before: Pick<Outline, "nodes">;
	after: Pick<Outline, "nodes">;
	helperEvidence?: Record<string, unknown>;
	rootDelta?: RootDelta[];
}): ActionEffectAssessment {
	const beforeByRef = new Map(input.before.nodes.map((node) => [node.ref, node]));
	const afterByRef = new Map(input.after.nodes.map((node) => [node.ref, node]));
	const changedRefs: string[] = [];
	for (const action of input.actions) {
		const ref = action.ref?.trim();
		if (!ref || changedRefs.includes(ref)) continue;
		const before = beforeByRef.get(ref);
		const after = afterByRef.get(ref);
		if (action.action === "setText") {
			if (after && after.value === (action.text ?? "")) {
				changedRefs.push(ref);
				return { verified: true, source: "successor_state", changedRefs, reason: "value_changed" };
			}
			continue;
		}
		if (!actionCanUseSuccessorState(action)) continue;
		if (before && !after) {
			changedRefs.push(ref);
			continue;
		}
		if (before && after && nodeSignature(before) !== nodeSignature(after)) changedRefs.push(ref);
	}
	if (changedRefs.length > 0) {
		return { verified: true, source: "successor_state", changedRefs };
	}

	const evidence = input.helperEvidence ?? {};
	for (const action of input.actions) {
		if (!actionCanUseHelperEvidence(action)) continue;
		if ((action.action === "typeText" || action.action === "keypress") && evidence.valueChanged === true) {
			return { verified: true, source: "helper_evidence", changedRefs, reason: "value_changed" };
		}
		if ((action.action === "click" || action.action === "press") && evidence.selected === true) {
			return { verified: true, source: "helper_evidence", changedRefs, reason: "selection_changed" };
		}
		if ((action.action === "click" || action.action === "press") && evidence.toggleState !== undefined) {
			return { verified: true, source: "helper_evidence", changedRefs, reason: "toggle_changed" };
		}
		if (action.action === "scroll" && evidence.scrolled === true) {
			return { verified: true, source: "helper_evidence", changedRefs, reason: "scrolled" };
		}
		if (actionCanUseRootEvidence(action) && evidence.windowChanged === true) {
			return { verified: true, source: "helper_evidence", changedRefs, reason: "window_changed" };
		}
	}

	if (input.actions.some(actionCanUseRootEvidence)) {
		const delta = input.rootDelta?.find((item) => item.change === "appeared" || item.change === "closed" || item.change === "focused");
		if (delta) return { verified: true, source: "helper_evidence", changedRefs, reason: `root_${delta.change}` };
	}

	return { verified: false, source: "none", changedRefs };
}
