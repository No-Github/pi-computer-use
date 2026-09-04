import { getComputerUseConfig } from "../../config.ts";
import { parseLookResponse, type LookResponse } from "../../outline.ts";
import { toBoolean, toFiniteNumber, toOptionalString } from "../coerce.ts";
import type { ComputerUsePlatformBackend, FramePoints, HelperActResult, PlatformActRequest, PlatformApp, PlatformFocusWindowResult, PlatformFrontmostResult, PlatformObserveRequest, PlatformReadTextRequest, PlatformReadTextResponse, PlatformRoot, PlatformRootKind, PlatformRootQuery, PlatformTarget, PlatformWaitForRequest, PlatformWaitForResponse } from "../types.ts";
import { HelperCommandError, macosHelper } from "./helper.ts";

function parseApps(result: unknown): PlatformApp[] {
	const array = Array.isArray(result) ? result : (result as any)?.apps;
	if (!Array.isArray(array)) return [];

	return array
		.map((raw) => {
			const pid = Math.trunc(toFiniteNumber((raw as any)?.pid, NaN));
			if (!Number.isFinite(pid) || pid <= 0) return undefined;
			const appName = toOptionalString((raw as any)?.appName) ?? "Unknown App";
			return {
				appName,
				bundleId: toOptionalString((raw as any)?.bundleId),
				pid,
				isFrontmost: toBoolean((raw as any)?.isFrontmost),
			} as PlatformApp;
		})
		.filter((item): item is PlatformApp => Boolean(item));
}

function parseFramePoints(raw: unknown): FramePoints {
	const frame = (raw as any)?.framePoints ?? {};
	return {
		x: toFiniteNumber(frame.x, 0),
		y: toFiniteNumber(frame.y, 0),
		w: Math.max(1, toFiniteNumber(frame.w, 1)),
		h: Math.max(1, toFiniteNumber(frame.h, 1)),
	};
}

function parseRoots(result: unknown): PlatformRoot[] {
	const array = Array.isArray(result) ? result : (result as any)?.roots;
	if (!Array.isArray(array)) return [];

	return array.map((raw) => {
		const metadata = typeof (raw as any)?.metadata === "object" && (raw as any).metadata !== null ? (raw as any).metadata as Record<string, unknown> : {};
		const kind = ["window", "menu", "sheet", "popover", "dialog"].includes((raw as any)?.kind) ? (raw as any).kind as PlatformRootKind : "window";
		return {
			kind,
			rootRef: toOptionalString((raw as any)?.rootRef ?? (raw as any)?.windowRef),
			windowRef: toOptionalString((raw as any)?.windowRef ?? (raw as any)?.rootRef),
			windowId: Number.isFinite((raw as any)?.windowId) ? Math.trunc((raw as any).windowId) : undefined,
			pid: Number.isFinite((raw as any)?.pid) ? Math.trunc((raw as any).pid) : undefined,
			appName: toOptionalString((raw as any)?.appName),
			bundleId: toOptionalString((raw as any)?.bundleId),
			title: toOptionalString((raw as any)?.title) ?? "",
			role: toOptionalString((raw as any)?.role),
			subrole: toOptionalString((raw as any)?.subrole),
			framePoints: parseFramePoints(raw),
			scaleFactor: Math.max(1, toFiniteNumber((raw as any)?.scaleFactor, 1)),
			zOrder: Math.trunc(toFiniteNumber((raw as any)?.zOrder, 0)),
			isMinimized: toBoolean((raw as any)?.isMinimized),
			isOnscreen: toBoolean((raw as any)?.isOnscreen),
			isMain: toBoolean((raw as any)?.isMain),
			isFocused: toBoolean((raw as any)?.isFocused),
			isModal: toBoolean((raw as any)?.isModal),
			metadata,
		};
	});
}

function helperAction(request: PlatformActRequest): Record<string, unknown> {
	if (!("focus" in request.target)) return { ...request };
	return { ...request, target: request.target.focus, params: { ...request.params, preserveFocus: true } };
}

export function buildMacosObserveArgs(request: PlatformObserveRequest): Record<string, unknown> {
	return {
		...(request.target.pid && request.target.pid > 0 ? { pid: request.target.pid } : {}),
		baseLookId: request.baseLookId,
		...(request.target.windowId && request.target.windowId > 0 ? { windowId: request.target.windowId } : {}),
		windowRef: request.target.rootRef,
		maxDimension: request.maxDimension,
		readText: request.readText,
		scopeRef: request.scopeRef,
		includeImage: request.includeImage,
	};
}

function normalizedTitle(value: string | undefined): string {
	return value?.trim().toLocaleLowerCase() ?? "";
}

function geometryScore(candidate: FramePoints, expected: FramePoints | undefined): number {
	if (!expected || expected.w <= 1 || expected.h <= 1) return 0;
	const difference = Math.abs(candidate.x - expected.x) + Math.abs(candidate.y - expected.y)
		+ Math.abs(candidate.w - expected.w) + Math.abs(candidate.h - expected.h);
	const normalizedDifference = difference / Math.max(1, expected.w + expected.h);
	return normalizedDifference <= 0.02 ? 100 : normalizedDifference <= 0.1 ? 50 : 0;
}

export function selectMacosCaptureRoot(roots: PlatformRoot[], target: PlatformTarget): PlatformRoot | undefined {
	const eligible = roots.filter((root) => root.pid === target.pid
		&& Number.isFinite(root.windowId) && root.windowId! > 0
		&& root.isOnscreen
		&& root.framePoints.w > 1 && root.framePoints.h > 1);
	const exactRef = eligible.filter((root) => target.rootRef && (root.rootRef === target.rootRef || root.windowRef === target.rootRef));
	if (exactRef.length === 1) return exactRef[0];

	const expectedTitle = normalizedTitle(target.windowTitle);
	const ranked = eligible.map((root) => {
		const title = normalizedTitle(root.title);
		const titleScore = expectedTitle && title
			? expectedTitle === title ? 100 : expectedTitle.includes(title) || title.includes(expectedTitle) ? 50 : 0
			: 0;
		return { root, score: titleScore + geometryScore(root.framePoints, target.framePoints) };
	}).filter(({ score }) => score >= 100).sort((left, right) => right.score - left.score);
	if (ranked.length === 0 || (ranked[1] && ranked[0].score < ranked[1].score + 25)) return undefined;
	return ranked[0].root;
}

async function resolveImageCaptureTarget(request: PlatformObserveRequest, signal?: AbortSignal): Promise<PlatformObserveRequest> {
	if (!request.includeImage || ((request.target.windowId ?? 0) > 0 && request.target.isOnscreen !== false)) return request;

	await macosHelper.command("focusWindow", { ...request.target }, { signal });
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, 75);
		if (!signal) return;
		const onAbort = () => {
			clearTimeout(timer);
			reject(new DOMException("Visual target recovery was aborted.", "AbortError"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
	const roots = parseRoots(await macosHelper.command("listRoots", { pid: request.target.pid }, { signal }));
	const refreshed = selectMacosCaptureRoot(roots, request.target);
	if (!refreshed?.windowId) {
		throw new HelperCommandError(
			"The selected root could not be paired with one unique visible macOS capture window after activation.",
			"capture_target_unavailable",
		);
	}
	return {
		...request,
		target: {
			...request.target,
			windowId: refreshed.windowId,
			rootRef: refreshed.rootRef ?? refreshed.windowRef,
			windowTitle: refreshed.title,
			framePoints: refreshed.framePoints,
			isOnscreen: refreshed.isOnscreen,
		},
	};
}

export const macosBackend: Pick<ComputerUsePlatformBackend, "listApps" | "listRoots" | "getFrontmost" | "focusWindow" | "observe" | "act" | "actBatch" | "readText" | "waitFor"> = {
	async listApps(signal?: AbortSignal): Promise<PlatformApp[]> {
		return parseApps(await macosHelper.command<unknown>("listApps", {}, { signal }));
	},

	async listRoots(query: PlatformRootQuery, signal?: AbortSignal): Promise<PlatformRoot[]> {
		return parseRoots(await macosHelper.command<unknown>("listRoots", {
			...(Number.isFinite(query.pid) ? { pid: Math.trunc(query.pid!) } : {}),
			...(query.title?.trim() ? { title: query.title.trim() } : {}),
		}, { signal }));
	},

	async getFrontmost(signal?: AbortSignal): Promise<PlatformFrontmostResult> {
		const result = await macosHelper.command<any>("getFrontmost", {}, { signal });
		const pid = Math.trunc(toFiniteNumber(result?.pid, NaN));
		if (!Number.isFinite(pid) || pid <= 0) {
			throw new Error("No frontmost app was available for screenshot targeting.");
		}
		return {
			appName: toOptionalString(result?.appName) ?? "Unknown App",
			bundleId: toOptionalString(result?.bundleId),
			pid,
			windowTitle: toOptionalString(result?.windowTitle),
			windowId: Number.isFinite(result?.windowId) ? Math.trunc(result.windowId) : undefined,
		};
	},

	async focusWindow(target: PlatformTarget, signal?: AbortSignal): Promise<PlatformFocusWindowResult> {
		return await macosHelper.command<PlatformFocusWindowResult>("focusWindow", { ...target }, { signal });
	},

	async observe(request: PlatformObserveRequest, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<LookResponse> {
		const resolved = await resolveImageCaptureTarget(request, options?.signal);
		const look = parseLookResponse(await macosHelper.command("look", buildMacosObserveArgs(resolved), options));
		if (resolved.includeImage && !look.image?.jpegBase64) {
			throw new HelperCommandError(
				"Visual observation did not return an image. The selected window may be on another macOS Space or unavailable to ScreenCaptureKit.",
				"capture_unavailable",
			);
		}
		return look;
	},

	async act(request: PlatformActRequest, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<HelperActResult> {
		return await macosHelper.command<HelperActResult>("act", { ...helperAction(request), cursorOverlay: getComputerUseConfig().cursor_overlay }, options);
	},

	async actBatch(requests: PlatformActRequest[], options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<HelperActResult> {
		const cursorOverlay = getComputerUseConfig().cursor_overlay;
		return await macosHelper.command<HelperActResult>("actBatch", { actions: requests.map((request) => ({ ...helperAction(request), cursorOverlay })) }, options);
	},

	async readText(args: PlatformReadTextRequest, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<PlatformReadTextResponse> {
		return await macosHelper.command("axReadText", { ...args }, options);
	},

	async waitFor(args: PlatformWaitForRequest, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<PlatformWaitForResponse> {
		return await macosHelper.command("axWaitFor", { ...args }, options);
	},
};
