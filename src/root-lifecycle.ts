import type { FramePoints, PlatformRoot } from "./platform/types.ts";

export interface RootIdentityInput {
	pid: number;
	windowId?: number;
	nativeWindowRef?: string;
	title: string;
	framePoints: FramePoints;
}

export interface RootReference extends RootIdentityInput {
	ref: string;
	generation: number;
	firstSeenAt: number;
	lastSeenAt: number;
}

export type RootFailureCode = "root_closed" | "root_replaced" | "root_ambiguous";

export class RootResolutionError extends Error {
	readonly code: RootFailureCode;
	readonly rootRef: string;
	readonly expectedIdentity: string;
	readonly retryable = true;

	constructor(code: RootFailureCode, rootRef: string, expectedIdentity: string, message: string) {
		super(message);
		this.name = "RootResolutionError";
		this.code = code;
		this.rootRef = rootRef;
		this.expectedIdentity = expectedIdentity;
	}
}

export type RootResolution =
	| { kind: "matched"; root: PlatformRoot }
	| { kind: "closed"; retryable: true; message: string }
	| { kind: "replaced"; retryable: true; message: string }
	| { kind: "ambiguous"; retryable: true; message: string };

export function rootResolutionError(reference: RootReference, resolution: Exclude<RootResolution, { kind: "matched" }>): RootResolutionError {
	const code: RootFailureCode = resolution.kind === "closed" ? "root_closed" : resolution.kind === "replaced" ? "root_replaced" : "root_ambiguous";
	return new RootResolutionError(code, reference.ref, rootIdentityKey(reference), resolution.message);
}

function normalizedTitle(value: string): string {
	return value.trim().toLowerCase();
}

function hasStableWindowId(input: Pick<RootIdentityInput, "windowId">): boolean {
	return typeof input.windowId === "number" && input.windowId > 0;
}

function hasNativeRef(input: Pick<RootIdentityInput, "nativeWindowRef">): boolean {
	return typeof input.nativeWindowRef === "string" && input.nativeWindowRef.length > 0;
}

/** Returns the strongest identity available for a platform root. */
export function rootIdentityKey(input: RootIdentityInput): string {
	if (hasStableWindowId(input)) return `pid:${input.pid}|id:${input.windowId}`;
	if (hasNativeRef(input)) return `pid:${input.pid}|ref:${input.nativeWindowRef}`;
	const { x, y, w, h } = input.framePoints;
	return `pid:${input.pid}|title:${normalizedTitle(input.title)}|frame:${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}`;
}

function inputFromRoot(root: PlatformRoot): RootIdentityInput {
	return {
		pid: root.pid ?? 0,
		windowId: root.windowId,
		nativeWindowRef: root.windowRef ?? root.rootRef,
		title: root.title || "(untitled)",
		framePoints: root.framePoints,
	};
}

export function updateRootReference(
	previous: RootReference | undefined,
	observed: RootIdentityInput,
	now = Date.now(),
	ref = previous?.ref,
): RootReference {
	const generation = previous && rootIdentityKey(previous) === rootIdentityKey(observed) ? previous.generation : (previous?.generation ?? 0) + 1;
	return {
		...observed,
		ref: ref ?? "@r1",
		generation,
		firstSeenAt: previous?.firstSeenAt ?? now,
		lastSeenAt: now,
	};
}

function titleMatches(reference: RootReference, root: PlatformRoot): boolean {
	return (root.pid ?? 0) === reference.pid && normalizedTitle(root.title || "(untitled)") === normalizedTitle(reference.title);
}

/** Resolves a previously issued root without silently retargeting stable identities. */
export function resolveRootReference(reference: RootReference, roots: PlatformRoot[]): RootResolution {
	const samePid = roots.filter((root) => (root.pid ?? 0) === reference.pid);
	const stableMatch = hasStableWindowId(reference)
		? samePid.find((root) => root.windowId === reference.windowId)
		: hasNativeRef(reference)
			? samePid.find((root) => (root.windowRef ?? root.rootRef) === reference.nativeWindowRef)
			: undefined;
	if (stableMatch) return { kind: "matched", root: stableMatch };

	if (hasStableWindowId(reference) || hasNativeRef(reference)) {
		const replacement = samePid.filter((root) => titleMatches(reference, root));
		if (replacement.length > 0) {
			return {
				kind: "replaced",
				retryable: true,
				message: `Root '${reference.ref}' was replaced. Its stable identity is no longer present; observe the replacement before acting.`,
			};
		}
		return {
			kind: samePid.length === 0 ? "closed" : "replaced",
			retryable: true,
			message: samePid.length === 0
				? `Root '${reference.ref}' is closed or its application is no longer running.`
				: `Root '${reference.ref}' is no longer available with its stable identity. Observe the current root before acting.`,
		};
	}

	const titleMatchesFound = samePid.filter((root) => titleMatches(reference, root));
	if (titleMatchesFound.length === 1) return { kind: "matched", root: titleMatchesFound[0] };
	if (titleMatchesFound.length > 1) {
		return { kind: "ambiguous", retryable: true, message: `Root '${reference.ref}' has multiple weak identity matches. Observe and select an exact root.` };
	}
	return {
		kind: samePid.length === 0 ? "closed" : "replaced",
		retryable: true,
		message: samePid.length === 0
			? `Root '${reference.ref}' is closed or its application is no longer running.`
			: `Root '${reference.ref}' is no longer available. Observe the current root before acting.`,
	};
}

export function rootIdentityFromPlatformRoot(root: PlatformRoot): RootIdentityInput {
	return inputFromRoot(root);
}
