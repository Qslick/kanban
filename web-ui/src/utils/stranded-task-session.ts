import type { RuntimeTaskSessionState } from "@/runtime/types";

export function isLiveTaskSessionState(state: RuntimeTaskSessionState | null | undefined): boolean {
	return state === "running" || state === "awaiting_review";
}

export function isStrandedTaskWorktreeSession(options: {
	worktreeExists: boolean;
	sessionState: RuntimeTaskSessionState | null | undefined;
}): boolean {
	return options.worktreeExists && !isLiveTaskSessionState(options.sessionState);
}
