import { describe, expect, it } from "vitest";

import { isLiveTaskSessionState, isStrandedTaskWorktreeSession } from "@/utils/stranded-task-session";

describe("stranded task session helpers", () => {
	it("treats running and awaiting_review as live", () => {
		expect(isLiveTaskSessionState("running")).toBe(true);
		expect(isLiveTaskSessionState("awaiting_review")).toBe(true);
		expect(isLiveTaskSessionState("failed")).toBe(false);
		expect(isLiveTaskSessionState("interrupted")).toBe(false);
		expect(isLiveTaskSessionState(null)).toBe(false);
	});

	it("flags an existing worktree as stranded when the session is dead or missing", () => {
		expect(
			isStrandedTaskWorktreeSession({
				worktreeExists: true,
				sessionState: "failed",
			}),
		).toBe(true);
		expect(
			isStrandedTaskWorktreeSession({
				worktreeExists: true,
				sessionState: undefined,
			}),
		).toBe(true);
		expect(
			isStrandedTaskWorktreeSession({
				worktreeExists: true,
				sessionState: "running",
			}),
		).toBe(false);
		expect(
			isStrandedTaskWorktreeSession({
				worktreeExists: false,
				sessionState: "failed",
			}),
		).toBe(false);
	});
});
