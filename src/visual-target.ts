export interface VisualTargetRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface VisualTargetReference {
	stateId: string;
	capturedAt: number;
	rootRef?: string;
	rect: VisualTargetRect;
	label?: string;
}

export interface VisualTargetContext {
	stateId: string;
	capturedAt: number;
	rootRef?: string;
	image?: { width: number; height: number };
}

export type VisualTargetFailure = "state_mismatch" | "root_mismatch" | "capture_mismatch" | "invalid_rect" | "out_of_bounds";
export type VisualTargetValidation = { valid: true } | { valid: false; reason: VisualTargetFailure };

export function pointInVisualTarget(target: VisualTargetReference, point: { x: number; y: number }): boolean {
	return point.x >= target.rect.x && point.y >= target.rect.y && point.x < target.rect.x + target.rect.w && point.y < target.rect.y + target.rect.h;
}

export function validateVisualTarget(target: VisualTargetReference, context: VisualTargetContext): VisualTargetValidation {
	if (target.stateId !== context.stateId) return { valid: false, reason: "state_mismatch" };
	if (target.rootRef && context.rootRef && target.rootRef !== context.rootRef) return { valid: false, reason: "root_mismatch" };
	if (target.capturedAt !== context.capturedAt) return { valid: false, reason: "capture_mismatch" };
	const { x, y, w, h } = target.rect;
	if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return { valid: false, reason: "invalid_rect" };
	if (context.image && (x < 0 || y < 0 || x + w > context.image.width || y + h > context.image.height)) return { valid: false, reason: "out_of_bounds" };
	return { valid: true };
}
