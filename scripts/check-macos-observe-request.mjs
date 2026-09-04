import assert from "node:assert/strict";
import { buildMacosObserveArgs, macosBackend, selectMacosCaptureRoot } from "../src/platform/macos/backend.ts";
import { macosHelper } from "../src/platform/macos/helper.ts";

const args = buildMacosObserveArgs({
	target: { pid: 717, rootRef: "@r8", windowId: 0 },
	readText: "never",
	includeImage: false,
});

assert.equal(args.pid, 717, "observe must forward the resolved app PID");
assert.equal(args.windowId, undefined, "invalid window IDs must remain omitted");
assert.equal(args.windowRef, "@r8");

const targetFrame = { x: 357, y: 30, w: 1830, h: 1316 };
const captureRoot = (overrides = {}) => ({
	pid: 717,
	rootRef: "w24-new",
	windowRef: "w24-new",
	windowId: 103,
	title: "Zed document",
	framePoints: targetFrame,
	isOnscreen: true,
	...overrides,
});

assert.equal(
	selectMacosCaptureRoot([captureRoot()], { pid: 717, rootRef: "w24", windowTitle: "Zed document", framePoints: targetFrame })?.windowId,
	103,
	"a uniquely matching visible window may recover after its native root ref changes",
);
assert.equal(
	selectMacosCaptureRoot([captureRoot({ isOnscreen: false })], { pid: 717, rootRef: "w24", windowTitle: "Zed document", framePoints: targetFrame }),
	undefined,
	"an offscreen candidate must not establish visual grounding",
);
assert.equal(
	selectMacosCaptureRoot([
		captureRoot({ rootRef: "a", windowId: 103 }),
		captureRoot({ rootRef: "b", windowId: 104 }),
	], { pid: 717, rootRef: "w24", windowTitle: "Zed document", framePoints: targetFrame }),
	undefined,
	"equally plausible candidates must remain ambiguous",
);

const originalCommand = macosHelper.command;
const commands = [];
macosHelper.command = async (cmd, payload) => {
	commands.push({ cmd, payload });
	if (cmd === "focusWindow") return { focused: true, activated: true, raised: true };
	if (cmd === "listRoots") {
		return {
			roots: [{
				pid: 717,
				rootRef: "w24",
				windowRef: "w24",
				windowId: 103,
				title: "Zed document",
				framePoints: { x: 357, y: 30, w: 1830, h: 1316 },
				isOnscreen: true,
			}],
		};
	}
	if (cmd === "look") {
		return {
			lookId: "look_1",
			capturedAt: 1,
			window: { windowId: payload.windowId, rootRef: payload.windowRef, framePoints: { x: 357, y: 30, w: 1830, h: 1316 }, scaleFactor: 2 },
			image: { jpegBase64: "image-data", width: 1536, height: 1104 },
			outline: { ref: "e1", role: "AXWindow", children: [] },
			timings: {},
		};
	}
	throw new Error(`Unexpected command: ${cmd}`);
};

try {
	const look = await macosBackend.observe({
		target: { pid: 717, rootRef: "w24", windowId: 0 },
		readText: "always",
		includeImage: true,
	});
	assert.equal(look.image?.width, 1536);
	assert.deepEqual(commands.map(({ cmd }) => cmd), ["focusWindow", "listRoots", "look"]);
	assert.equal(commands[2].payload.windowId, 103, "look must use the refreshed CG window id");
} finally {
	macosHelper.command = originalCommand;
}

macosHelper.command = async (cmd, payload) => {
	if (cmd !== "look") throw new Error(`Unexpected command: ${cmd}`);
	return {
		lookId: "look_without_image",
		capturedAt: 2,
		window: { windowId: payload.windowId, rootRef: payload.windowRef, framePoints: { x: 0, y: 0, w: 800, h: 600 }, scaleFactor: 2 },
		outline: { ref: "e1", role: "AXWindow", children: [] },
		timings: { captureMs: 0 },
	};
};

try {
	await assert.rejects(
		macosBackend.observe({
			target: { pid: 717, rootRef: "w24", windowId: 103 },
			readText: "always",
			includeImage: true,
		}),
		(error) => error?.code === "capture_unavailable" && /did not return an image/i.test(error.message),
	);
} finally {
	macosHelper.command = originalCommand;
}

console.log("macOS observe request keeps PID fallback for native roots");
