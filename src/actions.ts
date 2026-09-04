import type { MouseButtonName, UiAction } from "./contract.ts";
import type { OutlineNode } from "./outline.ts";
import { toFiniteNumber } from "./platform/coerce.ts";

export type ActionTarget = { ref: string } | { x: number; y: number } | { focus: { x: number; y: number } };

export type PreparedAction =
	| { action: "press" | "click"; target: ActionTarget; params: { button?: MouseButtonName; clickCount?: number }; establishesFocus: boolean; usesCurrentFocus: false; needsForeground: boolean }
	| { action: "setText"; target: ActionTarget; params: { text: string }; establishesFocus: false; usesCurrentFocus: false; needsForeground: false }
	| { action: "typeText"; target: ActionTarget; params: { text: string }; establishesFocus: false; usesCurrentFocus: boolean; needsForeground: false }
	| { action: "keypress"; target: ActionTarget; params: { keys: string[] }; establishesFocus: false; usesCurrentFocus: boolean; needsForeground: false }
	| { action: "scroll"; target: ActionTarget; params: { scrollX: number; scrollY: number }; establishesFocus: false; usesCurrentFocus: false; needsForeground: false }
	| { action: "drag"; target: ActionTarget; params: { path: Array<{ x: number; y: number }> }; establishesFocus: false; usesCurrentFocus: false; needsForeground: false }
	| { action: "moveMouse"; target: ActionTarget; params: Record<string, never>; establishesFocus: false; usesCurrentFocus: false; needsForeground: false }
	| { action: "wait"; params: { ms: number }; establishesFocus: false; usesCurrentFocus: false; needsForeground: false };

export interface ActionState {
	currentFocus: boolean;
	focusRef?: string;
}

export interface ActionEnvironment {
	headless: boolean;
	image?: { width: number; height: number };
	node(ref: string): OutlineNode;
	nodeAtPoint?: (x: number, y: number, operation: UiAction["action"]) => OutlineNode | undefined;
	center(node: OutlineNode): { x: number; y: number };
	validatePoint(x: number, y: number, label?: string): void;
}

/** Select the most specific actionable outline node containing a point. */
export function findNodeAtPoint(nodes: OutlineNode[], x: number, y: number, operation: Exclude<UiAction["action"], "wait">): OutlineNode | undefined {
	const candidates = nodes.filter((node) => {
		const rect = node.rect;
		if (!rect || rect.w <= 0 || rect.h <= 0 || node.pictureOnly) return false;
		if (x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h) return false;
		if (operation === "setText" || operation === "typeText") return node.canSetValue || node.isTextInput || node.canFocus;
		if (operation === "keypress") return node.canFocus || node.isTextInput || node.canSetValue;
		if (operation === "click" || operation === "press") return node.canPress || node.canFocus || node.isTextInput;
		return false;
	});
	return candidates.sort((a, b) => (a.rect!.w * a.rect!.h) - (b.rect!.w * b.rect!.h))[0];
}

export function needsVisualRefresh(actions: UiAction[], nodes: OutlineNode[], hasImage: boolean): boolean {
	if (hasImage) return false;
	return actions.some((action) => Number.isFinite(action.x) && Number.isFinite(action.y) && !findNodeAtPoint(nodes, action.x!, action.y!, action.action as Exclude<UiAction["action"], "wait">));
}

function mouseButton(value: unknown): MouseButtonName {
	return value === "right" || value === "middle" ? value : "left";
}

function clickCount(value: unknown, fallback = 1): number {
	return Math.max(1, Math.min(3, Math.round(toFiniteNumber(value, fallback))));
}

function scrollDelta(value: unknown): number {
	return Math.max(-10_000, Math.min(10_000, Math.round(toFiniteNumber(value, 0))));
}

function keys(value: unknown): string[] {
	if (!Array.isArray(value) || value.length === 0) throw new Error("keypress.keys must contain at least one key.");
	return value.map((key) => String(key));
}

function path(value: UiAction["path"], env: ActionEnvironment): Array<{ x: number; y: number }> {
	if (!Array.isArray(value) || value.length < 2) throw new Error("drag.path must contain at least two points.");
	return value.map((point, index) => {
		const x = Array.isArray(point) ? toFiniteNumber(point[0], NaN) : toFiniteNumber(point?.x, NaN);
		const y = Array.isArray(point) ? toFiniteNumber(point[1], NaN) : toFiniteNumber(point?.y, NaN);
		env.validatePoint(x, y, `Drag point ${index + 1}`);
		return { x, y };
	});
}

function nativeTarget(action: UiAction, operation: PreparedAction["action"], env: ActionEnvironment): ActionTarget {
	if (action.ref?.trim()) {
		const node = env.node(action.ref.trim());
		const semanticClick = operation === "click" || operation === "press";
		if (semanticClick && node.isTextInput && env.image) {
			const point = env.center(node);
			env.validatePoint(point.x, point.y);
			return point;
		}
		const onlyIncidentalActions = node.actions.every((candidate) => candidate === "AXShowMenu" || candidate === "AXScrollToVisible");
		if (node.wireRef && !node.pictureOnly && (!semanticClick || node.canPress || node.canFocus || node.canSetValue || !onlyIncidentalActions)) {
			return { ref: node.wireRef };
		}
		const point = env.center(node);
		env.validatePoint(point.x, point.y);
		return point;
	}
	const x = toFiniteNumber(action.x, NaN);
	const y = toFiniteNumber(action.y, NaN);
	if (Number.isFinite(x) && Number.isFinite(y)) {
		// Semantic accessibility geometry is a safe fallback when an outline-only
		// observation omitted a screenshot. This keeps coordinate input useful
		// without guessing a different window or replaying stale pixels.
		const semanticNode = operation === "wait" ? undefined : env.nodeAtPoint?.(x, y, operation);
		if (semanticNode?.wireRef && !semanticNode.pictureOnly) return nativeTarget({ ...action, ref: semanticNode.ref }, operation, env);
		env.validatePoint(x, y);
		return { x, y };
	}
	if (operation === "drag" && action.path?.length) return path(action.path, env)[0];
	throw new Error(`${operation} requires either ref or both x and y.`);
}


function focusedTarget(env: ActionEnvironment, state: ActionState): ActionTarget {
	if (state.focusRef) return { ref: state.focusRef };
	if (!env.image) throw new Error("Focused keyboard input requires an image-bearing state. Re-observe the active window or provide ref.");
	return { focus: { x: Math.floor(env.image.width / 2), y: Math.floor(env.image.height / 2) } };
}

function containsEditable(node: OutlineNode): boolean {
	if (node.canSetValue || node.role.toLowerCase().includes("text")) return true;
	return node.children.some(containsEditable);
}

export function prepareAction(action: UiAction, state: ActionState, env: ActionEnvironment): PreparedAction {
	const operation = action.action;
	const usesCurrentFocus = !env.headless && state.currentFocus && !action.ref && (operation === "typeText" || operation === "keypress");
	const target = usesCurrentFocus ? focusedTarget(env, state) : nativeTarget(action, operation, env);
	const targetRef = "ref" in target ? target.ref : undefined;
	let establishesFocus = false;
	if (!env.headless && (operation === "click" || operation === "press")) {
		const focusRef = action.ref?.trim() || targetRef;
		if (focusRef) {
			try { establishesFocus = containsEditable(env.node(focusRef)); } catch { establishesFocus = false; }
		}
	}
	const needsForeground = !env.headless && (operation === "click" || operation === "press") && "x" in target;

	switch (operation) {
		case "press":
		case "click": return { action: operation, target, params: { button: mouseButton(action.button), clickCount: clickCount(action.clickCount) }, establishesFocus, usesCurrentFocus: false, needsForeground };
		case "setText": return { action: operation, target, params: { text: action.text ?? "" }, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
		case "typeText": return { action: operation, target, params: { text: action.text ?? "" }, establishesFocus: false, usesCurrentFocus, needsForeground: false };
		case "keypress": return { action: operation, target, params: { keys: keys(action.keys) }, establishesFocus: false, usesCurrentFocus, needsForeground: false };
		case "scroll": return { action: operation, target, params: { scrollX: scrollDelta(action.scrollX), scrollY: scrollDelta(action.scrollY) }, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
		case "drag": return { action: operation, target, params: { path: path(action.path, env) }, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
		case "moveMouse": return { action: operation, target, params: {}, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
	}
}

export function canRetryInForeground(action: PreparedAction, outcome: "worked" | "didnt" | "unknown", headless: boolean): boolean {
	return !headless && outcome === "didnt" && (action.action === "typeText" || action.action === "keypress");
}

export function outcomeAfterCheck(current: "worked" | "didnt" | "unknown", check: "verified" | "preexisting" | "failed"): "worked" | "didnt" | "unknown" {
	if (check === "verified") return "worked";
	if (check === "failed") return "didnt";
	return current;
}

export function outcomeAfterObservedValues(
	current: "worked" | "didnt" | "unknown",
	actions: UiAction[],
	valueForRef: (ref: string) => string | undefined,
): "worked" | "didnt" | "unknown" {
	if (actions.length === 0 || actions.some((action) => action.action !== "setText" || !action.ref)) return current;
	const matches = actions.every((action) => valueForRef(action.ref!) === (action.text ?? ""));
	return matches ? "worked" : current;
}
