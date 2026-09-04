import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, realpath } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toBoolean, toFiniteNumber, toOptionalString } from "../coerce.ts";
import type { PlatformDiagnostics } from "../types.ts";
import { resolveMacosHelperAppPath } from "./helper-path.mjs";

const COMMAND_TIMEOUT_MS = 15_000;
const HELPER_PROTOCOL_VERSION = 6;
const HELPER_SETUP_TIMEOUT_MS = 60_000;

export const HELPER_BUNDLE_ID = "com.injaneity.pi-computer-use";
export const HELPER_APP_PATH = resolveMacosHelperAppPath();
export const HELPER_APP_EXECUTABLE_PATH = path.join(HELPER_APP_PATH, "Contents", "MacOS", "bridge");
const DEFAULT_HELPER_SOCKET_PATH = path.join(os.homedir(), "Library", "Caches", "pi-computer-use", "bridge.sock");
export const HELPER_SOCKET_PATH = process.env.PI_CU_SOCKET_PATH ?? DEFAULT_HELPER_SOCKET_PATH;
const usingExternalHelperSocket = HELPER_SOCKET_PATH !== DEFAULT_HELPER_SOCKET_PATH;

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SETUP_HELPER_SCRIPT = path.join(PACKAGE_ROOT, "scripts", "setup-helper.mjs");
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, "package.json");
const INSTALLED_INFO_PLIST_PATH = path.join(HELPER_APP_PATH, "Contents", "Info.plist");
const INSTALLED_SOURCE_HASH_PATH = path.join(HELPER_APP_PATH, "Contents", "Resources", "source.sha256");

export class HelperTransportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HelperTransportError";
	}
}

export class HelperCommandError extends Error {
	readonly code?: string;

	constructor(message: string, code?: string) {
		super(message);
		this.name = "HelperCommandError";
		this.code = code;
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("Operation aborted.");
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	throwIfAborted(signal);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("Operation aborted."));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	}).finally(() => signal?.throwIfAborted?.());
}

async function isExecutable(filePath: string): Promise<boolean> {
	try {
		await access(filePath, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

async function isResolvedHelperExecutable(filePath?: string): Promise<boolean> {
	if (!filePath) return true;
	const [actualPath, expectedPath] = await Promise.all([
		realpath(filePath).catch(() => path.resolve(filePath)),
		realpath(HELPER_APP_EXECUTABLE_PATH).catch(() => path.resolve(HELPER_APP_EXECUTABLE_PATH)),
	]);
	return actualPath === expectedPath;
}

async function packageVersion(): Promise<string | undefined> {
	try {
		const manifest = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8")) as { version?: unknown };
		return typeof manifest.version === "string" && manifest.version.length > 0 ? manifest.version : undefined;
	} catch {
		return undefined;
	}
}

function bundledHelperExecutablePath(): string {
	const arch = process.arch === "x64" ? "x64" : "arm64";
	return path.join(PACKAGE_ROOT, "prebuilt", "macos", arch, "bridge");
}

function bundledHelperAppPaths(): string[] {
	const arch = process.arch === "x64" ? "x64" : "arm64";
	return ["universal", arch].map((candidate) => path.join(PACKAGE_ROOT, "prebuilt", "macos", candidate, "pi-computer-use.app"));
}

async function fileHash(filePath: string): Promise<string | undefined> {
	try {
		const bytes = await readFile(filePath);
		return createHash("sha256").update(bytes).digest("hex");
	} catch {
		return undefined;
	}
}

async function textValue(filePath: string): Promise<string | undefined> {
	return await readFile(filePath, "utf8").then((value) => value.trim() || undefined).catch(() => undefined);
}

export function selectHelperSourceHash(
	sourceMarkerHash: string | undefined,
	signedAppExecutableHash: string | undefined,
	looseExecutableHash: string | undefined,
): string | undefined {
	return sourceMarkerHash ?? signedAppExecutableHash ?? looseExecutableHash;
}

async function bundledHelperSourceHash(): Promise<string | undefined> {
	for (const appPath of bundledHelperAppPaths()) {
		const [sourceMarkerHash, signedAppExecutableHash] = await Promise.all([
			textValue(path.join(appPath, "Contents", "Resources", "source.sha256")),
			fileHash(path.join(appPath, "Contents", "MacOS", "bridge")),
		]);
		const sourceHash = selectHelperSourceHash(sourceMarkerHash, signedAppExecutableHash, undefined);
		if (sourceHash) return sourceHash;
	}
	return fileHash(bundledHelperExecutablePath());
}

async function installedHelperSourceHash(): Promise<string | undefined> {
	return selectHelperSourceHash(
		await textValue(INSTALLED_SOURCE_HASH_PATH),
		await fileHash(HELPER_APP_EXECUTABLE_PATH),
		undefined,
	);
}

async function installedHelperVersion(): Promise<string | undefined> {
	try {
		const info = await readFile(INSTALLED_INFO_PLIST_PATH, "utf8");
		return info.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
	} catch {
		return undefined;
	}
}

export function helperVersionNeedsRefresh(expectedVersion: string | undefined, installedVersion: string | undefined): boolean {
	return Boolean(expectedVersion && expectedVersion !== installedVersion);
}

export function helperBinaryNeedsRefresh(expectedHash: string | undefined, installedHash: string | undefined): boolean {
	return Boolean(expectedHash && expectedHash !== installedHash);
}

export function helperInstallNeedsRefresh(status: {
	expectedVersion: string | undefined;
	installedVersion: string | undefined;
	expectedSourceHash: string | undefined;
	installedSourceHash: string | undefined;
}): boolean {
	return helperVersionNeedsRefresh(status.expectedVersion, status.installedVersion)
		|| helperBinaryNeedsRefresh(status.expectedSourceHash, status.installedSourceHash);
}

export async function runProcess(
	command: string,
	args: string[],
	timeoutMs: number,
	signal?: AbortSignal,
	env?: NodeJS.ProcessEnv,
): Promise<void> {
	throwIfAborted(signal);

	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env,
		});

		let stderr = "";
		let stdout = "";

		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			cleanup();
			reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`));
		}, timeoutMs);

		const onAbort = () => {
			child.kill("SIGTERM");
			cleanup();
			reject(new Error("Operation aborted."));
		};

		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};

		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});

		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});

		child.on("error", (error) => {
			cleanup();
			reject(error);
		});

		child.on("close", (code) => {
			cleanup();
			if (code === 0) {
				resolve();
				return;
			}
			const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
			reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${output}`.trim()));
		});

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export type MacosHelperInstallationDependencies = {
	isExecutable: () => Promise<boolean>;
	packageVersion: () => Promise<string | undefined>;
	installedHelperVersion: () => Promise<string | undefined>;
	bundledHelperSourceHash: () => Promise<string | undefined>;
	installedHelperSourceHash: () => Promise<string | undefined>;
	runSetup: (signal?: AbortSignal) => Promise<void>;
	wait: (ms: number, signal?: AbortSignal) => Promise<void>;
};

function defaultInstallationDependencies(): MacosHelperInstallationDependencies {
	return {
		isExecutable: () => isExecutable(HELPER_APP_EXECUTABLE_PATH),
		packageVersion,
		installedHelperVersion,
		bundledHelperSourceHash,
		installedHelperSourceHash,
		runSetup: (signal) => runProcess(process.execPath, [SETUP_HELPER_SCRIPT, "--runtime"], HELPER_SETUP_TIMEOUT_MS, signal, {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
			BUN_BE_BUN: "1",
		}),
		wait: sleep,
	};
}

export class MacosHelperClient {
	private daemonAvailable = false;
	private requestSequence = 0;
	private diagnosticsCache?: PlatformDiagnostics;
	private readonly installation: MacosHelperInstallationDependencies;

	constructor(installation: Partial<MacosHelperInstallationDependencies> = {}) {
		this.installation = { ...defaultInstallationDependencies(), ...installation };
	}

	get diagnostics(): PlatformDiagnostics | undefined {
		return this.diagnosticsCache;
	}

	private invalidateDaemon(): void {
		this.daemonAvailable = false;
		this.diagnosticsCache = undefined;
	}

	async ensureInstalled(signal?: AbortSignal): Promise<void> {
		if (usingExternalHelperSocket) return;
		// Installation is a deployment/repair operation, not part of every new
		// agent process's hot path. Protocol compatibility is checked against the
		// live daemon immediately afterwards.
		if (await this.installation.isExecutable()) {
			const [expectedVersion, currentVersion, expectedSourceHash, installedSourceHash] = await Promise.all([
				this.installation.packageVersion(),
				this.installation.installedHelperVersion(),
				this.installation.bundledHelperSourceHash(),
				this.installation.installedHelperSourceHash(),
			]);
			if (!helperInstallNeedsRefresh({ expectedVersion, installedVersion: currentVersion, expectedSourceHash, installedSourceHash })) return;
			// Stop a daemon that still holds the old helper bundle before setup
			// replaces and signs it. ensureDaemon() will launch the new binary.
			this.invalidateDaemon();
			await this.daemonCommand("shutdown", {}, 2_000, signal).catch(() => undefined);
			await this.installation.wait(400, signal);
		}

		this.invalidateDaemon();
		await this.installation.runSetup(signal);

		if (!(await this.installation.isExecutable())) {
			throw new Error(`Failed to install pi-computer-use helper app at ${HELPER_APP_PATH}.`);
		}
	}

	async launchDaemon(signal?: AbortSignal): Promise<void> {
		if (usingExternalHelperSocket) throw new HelperTransportError(`External helper socket is unavailable at ${HELPER_SOCKET_PATH}.`);
		await mkdir(path.dirname(HELPER_SOCKET_PATH), { recursive: true });
		// Open the resolved bundle directly so a legacy system-wide copy with the
		// same bundle id cannot win LaunchServices resolution.
		await runProcess("open", ["-n", "-g", HELPER_APP_PATH, "--args", "serve", "--socket", HELPER_SOCKET_PATH], COMMAND_TIMEOUT_MS, signal);
	}

	async daemonCommand<T>(cmd: string, args: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
		return await new Promise<T>((resolve, reject) => {
			const id = `req_${++this.requestSequence}`;
			const socket = net.createConnection(HELPER_SOCKET_PATH);
			let buffer = "";
			const timer = setTimeout(() => { socket.destroy(); reject(new HelperTransportError(`Daemon command '${cmd}' timed out after ${timeoutMs}ms.`)); }, timeoutMs);
			const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
			const onAbort = () => { socket.destroy(); cleanup(); reject(new Error("Operation aborted.")); };
			signal?.addEventListener("abort", onAbort, { once: true });
			socket.setEncoding("utf8");
			socket.on("connect", () => socket.write(`${JSON.stringify({ id, cmd, ...args })}\n`));
			socket.on("data", (chunk) => {
				buffer += chunk;
				const newline = buffer.indexOf("\n");
				if (newline < 0) return;
				cleanup();
				socket.end();
				try {
					const parsed = JSON.parse(buffer.slice(0, newline));
					if (parsed.ok === true) resolve(parsed.result as T);
					else reject(new HelperCommandError(parsed?.error?.message ?? `Daemon command '${cmd}' failed.`, parsed?.error?.code));
				} catch (error) {
					reject(error);
				}
			});
			socket.on("error", (error) => { cleanup(); reject(new HelperTransportError(error.message)); });
		});
	}

	async ensureDaemon(signal?: AbortSignal): Promise<boolean> {
		if (this.daemonAvailable) return true;
		try {
			await this.daemonCommand("diagnostics", {}, 1_000, signal);
			this.daemonAvailable = true;
			return true;
		} catch {}
		await this.launchDaemon(signal).catch(() => undefined);
		for (let index = 0; index < 30; index += 1) {
			try {
				await this.daemonCommand("diagnostics", {}, 1_000, signal);
				this.daemonAvailable = true;
				return true;
			} catch {
				await sleep(100, signal);
			}
		}
		return false;
	}

	async command<T>(cmd: string, args: Record<string, unknown> = {}, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
		const timeoutMs = options?.timeoutMs ?? COMMAND_TIMEOUT_MS;
		if (!(await this.ensureDaemon(options?.signal))) {
			throw new HelperTransportError(`pi-computer-use helper app daemon is unavailable at ${HELPER_APP_PATH}.`);
		}
		try {
			return await this.daemonCommand<T>(cmd, args, timeoutMs, options?.signal);
		} catch (error) {
			this.daemonAvailable = false;
			throw error instanceof Error ? error : new Error(String(error));
		}
	}

	async restart(signal?: AbortSignal): Promise<void> {
		await this.command("shutdown", {}, { signal, timeoutMs: 2_000 }).catch(() => undefined);
		this.daemonAvailable = false;
		await sleep(400, signal);
		if (!(await this.ensureDaemon(signal))) {
			throw new Error(`pi-computer-use helper did not come back after restart. Helper app: ${HELPER_APP_PATH}`);
		}
	}

	async diagnosticsCommand(signal?: AbortSignal): Promise<PlatformDiagnostics> {
		const result = await this.command<any>("diagnostics", {}, { signal });
		const diagnostics = {
			protocolVersion: Math.trunc(toFiniteNumber(result?.protocolVersion, 0)),
			architectureVersion: Math.trunc(toFiniteNumber(result?.architectureVersion, 0)),
			invariants: Array.isArray(result?.invariants) ? result.invariants.filter((value: unknown): value is string => typeof value === "string") : [],
			pid: Math.trunc(toFiniteNumber(result?.pid, 0)),
			parentPid: Math.trunc(toFiniteNumber(result?.parentPid, 0)) || undefined,
			parentAppName: toOptionalString(result?.parentAppName),
			parentBundleId: toOptionalString(result?.parentBundleId),
			parentPath: toOptionalString(result?.parentPath),
			executablePath: toOptionalString(result?.executablePath),
			os: toOptionalString(result?.macOS),
			arch: toOptionalString(result?.arch),
			accessibility: toBoolean(result?.accessibility),
			screenRecording: toBoolean(result?.screenRecording),
		};
		this.diagnosticsCache = diagnostics;
		return diagnostics;
	}

	async ensureProtocol(signal?: AbortSignal): Promise<PlatformDiagnostics> {
		let diagnostics = await this.diagnosticsCommand(signal);
		const executableMatches = await isResolvedHelperExecutable(diagnostics.executablePath);
		if (diagnostics.protocolVersion === HELPER_PROTOCOL_VERSION && executableMatches) return diagnostics;

		// The helper daemon outlives Pi, so restarting/reloading Pi alone does not
		// replace a stale daemon or one launched from the legacy system location.
		// Stop it through the backwards-compatible command channel and relaunch
		// the exact app bundle that ensureInstalled() resolved.
		await this.restart(signal);
		diagnostics = await this.diagnosticsCommand(signal);
		const relaunchedExecutableMatches = await isResolvedHelperExecutable(diagnostics.executablePath);
		if (diagnostics.protocolVersion !== HELPER_PROTOCOL_VERSION || !relaunchedExecutableMatches) {
			this.daemonAvailable = false;
			throw new Error(
				`pi-computer-use helper mismatch after relaunch: expected protocol ${HELPER_PROTOCOL_VERSION} and executable ${HELPER_APP_EXECUTABLE_PATH}; got protocol ${diagnostics.protocolVersion} and executable ${diagnostics.executablePath ?? "unknown"}. Reinstall or rebuild the helper app at ${HELPER_APP_PATH}.`,
			);
		}
		return diagnostics;
	}
}

export const macosHelper = new MacosHelperClient();
