import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { PanelReviewFamily } from "../../../src/core/panel-review";
import { buildPanelReviewPacket } from "../../../src/server/panel-review-runner";
import {
	buildPanelSeatInvocation,
	createLivePanelSeatDispatcher,
	extractGrokSeatText,
	type PanelSeatInvocation,
	parsePanelSeatReply,
	pickAgyGeminiModel,
	type SpawnPanelSeat,
} from "../../../src/server/panel-review-seats";
import { createTempDir } from "../../utilities/temp-dir";

function createPacket() {
	return buildPanelReviewPacket({
		taskId: "task-1",
		prompt: "Implement the gate",
		worktreePath: "/tmp/worktree",
		baseRef: "main",
		snapshot: { diff: "+hello", status: " M hello.txt", headCommit: "abc123" },
	});
}

function approveReply(verdict = "APPROVE"): string {
	return [
		`VERDICT: ${verdict}`,
		"CONFIDENCE: high",
		"TOP_RISKS:",
		"- [S3] leftover comment",
		"DISAGREEMENTS:",
		"- none",
		"GAPS:",
		"- none",
		"WOULD_CHANGE_MY_MIND:",
		"- none",
		"MODEL_SELF_REPORT: test",
	].join("\n");
}

function grokNdjson(text: string): string {
	return `${JSON.stringify({ type: "assistant", text: "thinking" })}\n${JSON.stringify({ type: "result", result: text })}\n`;
}

function resultFor(invocation: PanelSeatInvocation, text: string) {
	return {
		stdout: invocation.family === "grok" ? grokNdjson(text) : text,
		stderr: "",
		exitCode: 0,
	};
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

describe("parsePanelSeatReply", () => {
	it("reads a VERDICT line after stripping leading markup", () => {
		expect(parsePanelSeatReply("* VERDICT: APPROVE\nTOP_RISKS:\n- [S2] race")?.kind).toBe("APPROVE");
		expect(parsePanelSeatReply("# VERDICT: REJECT")?.kind).toBe("REJECT");
		expect(parsePanelSeatReply("`VERDICT: NEED_INFO`")?.kind).toBe("NEED_INFO");
		expect(parsePanelSeatReply("VERDICT: APPROVE_WITH_CHANGES")?.kind).toBe("APPROVE_WITH_CHANGES");
	});

	it("maps unknown verdicts to UNAVAILABLE and keeps a TOP_RISKS note", () => {
		const parsed = parsePanelSeatReply("VERDICT: LGTM\nTOP_RISKS:\n- [S1] ships a footgun");
		expect(parsed).toEqual({ kind: "UNAVAILABLE", note: 'Unrecognized verdict "LGTM".' });
		expect(parsePanelSeatReply(approveReply())?.note).toBe("[S3] leftover comment");
	});

	it("returns null when there is no VERDICT line", () => {
		expect(parsePanelSeatReply("looks fine to me")).toBeNull();
		expect(parsePanelSeatReply("")).toBeNull();
	});
});

describe("extractGrokSeatText", () => {
	it("takes result.result from streaming-messages-json", () => {
		expect(extractGrokSeatText(grokNdjson("VERDICT: APPROVE"))).toBe("VERDICT: APPROVE");
	});
});

describe("pickAgyGeminiModel", () => {
	it("prefers the highest Gemini version, then pro over flash, then -high", () => {
		expect(pickAgyGeminiModel(["gemini-2.5-pro", "gemini-3.8-flash-high"])).toBe("gemini-3.8-flash-high");
		expect(pickAgyGeminiModel(["gemini-3.8-flash-high", "gemini-3.8-pro"])).toBe("gemini-3.8-pro");
		expect(pickAgyGeminiModel(["gemini-3.8-pro", "gemini-3.8-pro-high"])).toBe("gemini-3.8-pro-high");
	});
});

describe("buildPanelSeatInvocation", () => {
	const packet = createPacket();
	const base = {
		packet,
		packetPath: "/tmp/kanban-panel/task-1/packet.md",
		outputPath: "/tmp/kanban-panel/task-1/gpt.md",
		grokModel: "grok-4.6",
		geminiModel: "gemini-3.8-flash-high",
		timeoutMs: 90_000,
	};

	it("keeps grok read-only and never always-approve/yolo/sandbox", () => {
		const invocation = buildPanelSeatInvocation({ ...base, family: "grok", binary: "grok" });
		expect(invocation.args).toEqual(
			expect.arrayContaining([
				"--prompt-file",
				"/tmp/kanban-panel/task-1/packet.md",
				"--tools",
				"read_file,grep,list_dir",
				"--disallowed-tools",
				"search_tool,use_tool,Agent",
				"--deny",
				"MCPTool",
				"--disable-web-search",
				"--no-subagents",
				"--reasoning-effort",
				"high",
			]),
		);
		expect(invocation.args).not.toContain("--always-approve");
		expect(invocation.args).not.toContain("--yolo");
		expect(invocation.args).not.toContain("--sandbox");
		expect(invocation.env.GROK_MEMORY).toBe("0");
		expect(invocation.stdin).toBeNull();
	});

	it("runs codex exec read-only without pinning -m", () => {
		const invocation = buildPanelSeatInvocation({ ...base, family: "gpt", binary: "codex" });
		expect(invocation.args).toEqual(
			expect.arrayContaining(["exec", "-s", "read-only", "--skip-git-repo-check", "--ephemeral", "-"]),
		);
		expect(invocation.args).not.toContain("-m");
		expect(invocation.args).not.toContain("--model");
		expect(invocation.stdin).toContain("READ-ONLY");
	});

	it("invokes agy print mode without --mode plan or skip-permissions", () => {
		const invocation = buildPanelSeatInvocation({ ...base, family: "gemini", binary: "/home/me/.local/bin/agy" });
		expect(invocation.command).toBe("/home/me/.local/bin/agy");
		expect(invocation.args).toEqual(
			expect.arrayContaining(["-p", packet.markdown, "--disable-slash-commands", "--print-timeout", "90s"]),
		);
		expect(invocation.args).not.toContain("--mode");
		expect(invocation.args).not.toContain("plan");
		expect(invocation.args).not.toContain("--dangerously-skip-permissions");
		expect(invocation.stdin).toBeNull();
	});

	it("invokes claude print mode with a reads-only tool allowlist", () => {
		const invocation = buildPanelSeatInvocation({ ...base, family: "claude", binary: "claude" });
		expect(invocation.args).toEqual(
			expect.arrayContaining(["-p", "--tools", "Read,Grep,Glob", "--permission-prompts", "none", "--restricted"]),
		);
		expect(invocation.args).not.toContain("--dangerously-skip-permissions");
		expect(invocation.args.join(" ")).not.toMatch(/\bAgent\b/);
		expect(invocation.stdin).toContain("READ-ONLY");
	});
});

describe("createLivePanelSeatDispatcher", () => {
	it("marks a missing binary UNAVAILABLE and still runs the other seats", async () => {
		const { path, cleanup } = createTempDir("kanban-panel-seats-");
		const invocations: PanelReviewFamily[] = [];
		try {
			const dispatch = createLivePanelSeatDispatcher({
				tmpdir: () => path,
				homedir: () => "/home/tester",
				grokModel: "grok-4.6",
				geminiModel: "gemini-3.8-flash-high",
				isBinaryAvailable: (binary) => binary === "codex" || binary === "claude",
				spawnSeat: async (invocation) => {
					invocations.push(invocation.family);
					return resultFor(invocation, approveReply());
				},
			});
			const verdicts = await dispatch(createPacket(), ["grok", "gpt", "gemini", "claude"]);
			expect(verdicts.map((verdict) => [verdict.family, verdict.verdict])).toEqual([
				["grok", "UNAVAILABLE"],
				["gpt", "APPROVE"],
				["gemini", "UNAVAILABLE"],
				["claude", "APPROVE"],
			]);
			expect(invocations.sort()).toEqual(["claude", "gpt"]);
		} finally {
			cleanup();
		}
	});

	it("uses well-known absolute fallbacks when PATH misses grok and agy", async () => {
		const { path, cleanup } = createTempDir("kanban-panel-seats-");
		const commands: string[] = [];
		try {
			const dispatch = createLivePanelSeatDispatcher({
				tmpdir: () => path,
				homedir: () => "/home/tester",
				grokModel: "grok-4.6",
				geminiModel: "gemini-3.8-flash-high",
				isBinaryAvailable: (binary) =>
					binary === join("/home/tester", ".grok", "bin", "grok") ||
					binary === join("/home/tester", ".local", "bin", "agy"),
				spawnSeat: async (invocation) => {
					commands.push(invocation.command);
					return resultFor(invocation, approveReply());
				},
			});
			await dispatch(createPacket(), ["grok", "gemini"]);
			expect(commands).toEqual([
				join("/home/tester", ".grok", "bin", "grok"),
				join("/home/tester", ".local", "bin", "agy"),
			]);
		} finally {
			cleanup();
		}
	});

	it("benches a family on usage-limit stderr and does not retry it", async () => {
		const { path, cleanup } = createTempDir("kanban-panel-seats-");
		const spawned: PanelReviewFamily[] = [];
		try {
			const dispatch = createLivePanelSeatDispatcher({
				tmpdir: () => path,
				grokModel: "grok-4.6",
				geminiModel: "gemini-3.8-flash-high",
				isBinaryAvailable: () => true,
				spawnSeat: async (invocation) => {
					spawned.push(invocation.family);
					if (invocation.family === "gpt") {
						return {
							stdout: "",
							stderr: "ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage",
							exitCode: 1,
						};
					}
					return resultFor(invocation, approveReply());
				},
			});
			const packet = createPacket();
			const first = await dispatch(packet, ["gpt", "claude"]);
			expect(first.find((verdict) => verdict.family === "gpt")?.verdict).toBe("BENCHED");
			const second = await dispatch(packet, ["gpt", "claude"]);
			expect(second.find((verdict) => verdict.family === "gpt")?.verdict).toBe("BENCHED");
			expect(spawned.filter((family) => family === "gpt")).toHaveLength(1);
			expect(spawned.filter((family) => family === "claude")).toHaveLength(2);
		} finally {
			cleanup();
		}
	});

	it("retries a malformed reply once, and does not retry permission auto-deny", async () => {
		const { path, cleanup } = createTempDir("kanban-panel-seats-");
		try {
			const malformedCalls: number[] = [];
			const deniedCalls: number[] = [];
			const dispatch = createLivePanelSeatDispatcher({
				tmpdir: () => path,
				grokModel: "grok-4.6",
				geminiModel: "gemini-3.8-flash-high",
				isBinaryAvailable: (binary) => binary === "claude" || binary === "agy",
				spawnSeat: async (invocation) => {
					if (invocation.family === "claude") {
						malformedCalls.push(1);
						if (malformedCalls.length === 1) {
							return { stdout: "not a verdict", stderr: "", exitCode: 0 };
						}
						return resultFor(invocation, approveReply());
					}
					deniedCalls.push(1);
					return {
						stdout: "",
						stderr: 'jetski: no output produced — a tool required the "command" permission',
						exitCode: 0,
					};
				},
			});
			const verdicts = await dispatch(createPacket(), ["claude", "gemini"]);
			expect(verdicts.find((verdict) => verdict.family === "claude")?.verdict).toBe("APPROVE");
			expect(verdicts.find((verdict) => verdict.family === "gemini")?.verdict).toBe("UNAVAILABLE");
			expect(verdicts.find((verdict) => verdict.family === "gemini")?.note).toMatch(/permission auto-denied/);
			expect(malformedCalls).toHaveLength(2);
			expect(deniedCalls).toHaveLength(1);
		} finally {
			cleanup();
		}
	});

	it("starts every seat before any of them finishes", async () => {
		const { path, cleanup } = createTempDir("kanban-panel-seats-");
		const started: PanelReviewFamily[] = [];
		const release = new Map<PanelReviewFamily, () => void>();
		try {
			const dispatch = createLivePanelSeatDispatcher({
				tmpdir: () => path,
				grokModel: "grok-4.6",
				geminiModel: "gemini-3.8-flash-high",
				isBinaryAvailable: () => true,
				spawnSeat: (async (invocation) => {
					started.push(invocation.family);
					await new Promise<void>((resolve) => {
						release.set(invocation.family, resolve);
					});
					return resultFor(invocation, approveReply());
				}) satisfies SpawnPanelSeat,
			});
			const pending = dispatch(createPacket(), ["grok", "claude", "gpt", "gemini"]);
			try {
				await waitUntil(() => started.length === 4, "all seats to start");
				expect([...started].sort()).toEqual(["claude", "gemini", "gpt", "grok"]);
				expect(release.size).toBe(4);
				for (const resolve of release.values()) {
					resolve();
				}
				const verdicts = await pending;
				expect(verdicts.every((verdict) => verdict.verdict === "APPROVE")).toBe(true);
			} finally {
				for (const resolve of release.values()) {
					resolve();
				}
				await pending.catch(() => undefined);
			}
		} finally {
			cleanup();
		}
	});
});
