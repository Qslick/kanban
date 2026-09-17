import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { summarizePanelReviewRun } from "../../../src/core/panel-review";
import {
	buildPanelReviewPacket,
	collectTaskWorktreeDiff,
	createPanelReviewRunner,
	createStubPanelSeatDispatcher,
	type DispatchPanelSeats,
} from "../../../src/server/panel-review-runner";
import { createGitTestEnv } from "../../utilities/git-env";
import { createTempDir } from "../../utilities/temp-dir";

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}

describe("panel-review-runner", () => {
	it("builds a read-only packet with the task id, prompt, and worktree diff", () => {
		const packet = buildPanelReviewPacket({
			taskId: "task-42",
			prompt: "Add the panel gate",
			worktreePath: "/tmp/worktree",
			baseRef: "main",
			snapshot: {
				diff: "diff --git a/src/foo.ts b/src/foo.ts\n+export const x = 1;\n",
				status: " M src/foo.ts",
				headCommit: "abc123",
			},
		});

		expect(packet.readOnly).toBe(true);
		expect(packet.markdown).toContain("READ-ONLY");
		expect(packet.markdown).toContain("Do not write, edit, create, or delete anything");
		expect(packet.markdown).toContain("task-42");
		expect(packet.markdown).toContain("Add the panel gate");
		expect(packet.markdown).toContain("diff --git a/src/foo.ts");
		expect(packet.diff).toContain("Status:");
		expect(packet.headCommit).toBe("abc123");
	});

	it("includes verify command and output in the packet when present", () => {
		const packet = buildPanelReviewPacket({
			taskId: "task-42",
			prompt: "Add the panel gate",
			worktreePath: "/tmp/worktree",
			baseRef: "main",
			snapshot: {
				diff: "+export const x = 1;\n",
				status: " M src/foo.ts",
				headCommit: "abc123",
			},
			verifyCommand: "npm test",
			verifyResult: {
				ok: true,
				output: "3 passing",
				recordedAt: 10,
			},
		});

		expect(packet.markdown).toContain("VERIFY");
		expect(packet.markdown).toContain("npm test");
		expect(packet.markdown).toContain("passed");
		expect(packet.markdown).toContain("3 passing");
	});

	it("uses the injected dispatcher instead of a real CLI", async () => {
		const dispatchPanelSeats = vi.fn<DispatchPanelSeats>(async (packet, families) => {
			expect(packet.readOnly).toBe(true);
			expect(packet.markdown).toContain("READ-ONLY");
			return families.map((family) => ({ family, verdict: "APPROVE" as const }));
		});
		const runner = createPanelReviewRunner({
			dispatchPanelSeats,
			resolveWorktree: async () => ({ path: "/tmp/worktree", exists: true }),
			collectWorktreeDiff: async () => ({
				diff: "+hello",
				status: " M hello.txt",
				headCommit: "head-1",
			}),
		});

		const run = await runner.run({
			workspacePath: "/repo",
			taskId: "task-1",
			prompt: "Do the work",
			baseRef: "main",
			families: ["gpt", "claude"],
			selection: "inherit",
			recordedAt: 10,
		});

		expect(dispatchPanelSeats).toHaveBeenCalledTimes(1);
		expect(run.status).toBe("passed");
		expect(run.headCommit).toBe("head-1");
		expect(run.verdicts.map((verdict) => verdict.family)).toEqual(["gpt", "claude"]);
	});

	it("stub dispatcher marks requested seats unavailable without calling CLIs", async () => {
		const stub = createStubPanelSeatDispatcher();
		const packet = buildPanelReviewPacket({
			taskId: "task-1",
			prompt: "prompt",
			worktreePath: "/tmp/worktree",
			baseRef: "main",
			snapshot: { diff: "", status: "", headCommit: "abc" },
		});
		const verdicts = await stub(packet, ["grok", "gpt"]);
		expect(verdicts.every((verdict) => verdict.verdict === "UNAVAILABLE")).toBe(true);
		expect(
			summarizePanelReviewRun({
				verdicts,
				recordedAt: 1,
				headCommit: "abc",
				selection: "inherit",
			}).status,
		).toBe("skipped");
	});

	it("collects a real-shaped git diff from a task worktree without mutating it", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-panel-review-diff-");
		try {
			runGit(repoPath, ["init", "-q"]);
			runGit(repoPath, ["config", "user.name", "Test User"]);
			runGit(repoPath, ["config", "user.email", "test@example.com"]);
			writeFileSync(join(repoPath, "readme.txt"), "base\n", "utf8");
			runGit(repoPath, ["add", "."]);
			runGit(repoPath, ["commit", "-qm", "base"]);
			runGit(repoPath, ["branch", "-M", "main"]);
			writeFileSync(join(repoPath, "readme.txt"), "changed\n", "utf8");
			writeFileSync(join(repoPath, "extra.txt"), "untracked\n", "utf8");

			const snapshot = await collectTaskWorktreeDiff({ worktreePath: repoPath, baseRef: "main" });
			expect(snapshot.diff).toContain("readme.txt");
			expect(snapshot.diff).toContain("changed");
			expect(snapshot.status).toContain("readme.txt");
			expect(snapshot.status).toContain("extra.txt");
			expect(snapshot.headCommit).toMatch(/^[0-9a-f]{7,}$/);
			expect(runGit(repoPath, ["status", "--porcelain"])).toContain("readme.txt");
		} finally {
			cleanup();
		}
	});
});
