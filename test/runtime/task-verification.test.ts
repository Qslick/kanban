import { describe, expect, it } from "vitest";

import { runVerifyCommandInWorktree } from "../../src/core/run-verify-command";
import {
	createTaskVerifyResult,
	isTaskVerificationSatisfied,
	normalizeVerifyCommand,
	TASK_VERIFY_OUTPUT_MAX_CHARS,
} from "../../src/core/task-verification";

describe("normalizeVerifyCommand", () => {
	it("trims and drops empty values", () => {
		expect(normalizeVerifyCommand("  npm test  ")).toBe("npm test");
		expect(normalizeVerifyCommand("   ")).toBeUndefined();
		expect(normalizeVerifyCommand(null)).toBeUndefined();
		expect(normalizeVerifyCommand(undefined)).toBeUndefined();
	});
});

describe("isTaskVerificationSatisfied", () => {
	it("is true when no command is set", () => {
		expect(isTaskVerificationSatisfied({})).toBe(true);
		expect(isTaskVerificationSatisfied({ verifyCommand: "  " })).toBe(true);
	});

	it("is false when a command is set and the last result is missing or failed", () => {
		expect(isTaskVerificationSatisfied({ verifyCommand: "npm test" })).toBe(false);
		expect(
			isTaskVerificationSatisfied({
				verifyCommand: "npm test",
				verifyResult: { ok: false, recordedAt: 1 },
			}),
		).toBe(false);
	});

	it("is true when a command is set and the last result passed", () => {
		expect(
			isTaskVerificationSatisfied({
				verifyCommand: "npm test",
				verifyResult: { ok: true, recordedAt: 1 },
			}),
		).toBe(true);
	});
});

describe("createTaskVerifyResult", () => {
	it("truncates long output", () => {
		const result = createTaskVerifyResult({
			ok: false,
			output: "x".repeat(TASK_VERIFY_OUTPUT_MAX_CHARS + 25),
			recordedAt: 9,
		});
		expect(result.output).toHaveLength(TASK_VERIFY_OUTPUT_MAX_CHARS);
	});
});

describe("runVerifyCommandInWorktree", () => {
	it("records ok for a successful injected command", async () => {
		const result = await runVerifyCommandInWorktree({
			command: "npm test",
			cwd: "/tmp/worktree",
			recordedAt: 123,
			runCommand: async () => ({
				exitCode: 0,
				stdout: "ok",
				stderr: "",
				combinedOutput: "ok",
			}),
		});
		expect(result).toEqual({
			ok: true,
			output: "ok",
			recordedAt: 123,
		});
	});

	it("records a failure when the command exits non-zero", async () => {
		const result = await runVerifyCommandInWorktree({
			command: "npm test",
			cwd: "/tmp/worktree",
			recordedAt: 5,
			runCommand: async () => ({
				exitCode: 1,
				stdout: "",
				stderr: "boom",
				combinedOutput: "boom",
			}),
		});
		expect(result).toEqual({
			ok: false,
			output: "boom",
			recordedAt: 5,
		});
	});

	it("fails closed when the runner throws", async () => {
		const result = await runVerifyCommandInWorktree({
			command: "npm test",
			cwd: "/tmp/worktree",
			recordedAt: 8,
			runCommand: async () => {
				throw new Error("spawn failed");
			},
		});
		expect(result).toEqual({
			ok: false,
			output: "spawn failed",
			recordedAt: 8,
		});
	});
});
