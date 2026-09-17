import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeTaskWorktreeStatusResponse } from "@/runtime/types";

const hookState = vi.hoisted(() => ({
	status: null as RuntimeTaskWorktreeStatusResponse | null,
	keep: vi.fn(async () => true),
	discard: vi.fn(async () => true),
	isKeeping: false,
	isDiscarding: false,
	isLoading: false,
}));

vi.mock("@/hooks/use-stranded-task-worktree", () => ({
	useStrandedTaskWorktree: () => hookState,
}));

import { StrandedWorktreeBanner } from "@/components/stranded-worktree-banner";

function createStatus(overrides: Partial<RuntimeTaskWorktreeStatusResponse> = {}): RuntimeTaskWorktreeStatusResponse {
	return {
		taskId: "abc12",
		path: "/Users/test/.cline/worktrees/abc12/repo",
		exists: true,
		stranded: true,
		sessionState: "failed",
		headCommit: "abcdef1234567890",
		headShortSha: "abcdef12",
		reachable: false,
		recoveredBranch: "recovered/abc12",
		recoveredBranchExists: false,
		canDiscard: false,
		...overrides,
	};
}

describe("StrandedWorktreeBanner", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		hookState.status = createStatus();
		hookState.keep.mockClear();
		hookState.discard.mockClear();
		hookState.isKeeping = false;
		hookState.isDiscarding = false;
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("hides when the worktree is not stranded", async () => {
		hookState.status = createStatus({ stranded: false });
		await act(async () => {
			root.render(
				<TooltipProvider>
					<StrandedWorktreeBanner workspaceId="workspace-1" taskId="abc12" baseRef="main" sessionState="running" />
				</TooltipProvider>,
			);
		});
		expect(container.querySelector('[data-testid="stranded-worktree-banner"]')).toBeNull();
	});

	it("shows path, short sha, and keep/resume/discard when the session is dead", async () => {
		const onResume = vi.fn();
		await act(async () => {
			root.render(
				<TooltipProvider>
					<StrandedWorktreeBanner
						workspaceId="workspace-1"
						taskId="abc12"
						baseRef="main"
						sessionState="failed"
						onResume={onResume}
					/>
				</TooltipProvider>,
			);
		});

		const banner = container.querySelector('[data-testid="stranded-worktree-banner"]');
		expect(banner).toBeInstanceOf(HTMLElement);
		expect(banner?.textContent).toContain("Stranded worktree");
		expect(banner?.textContent).toContain("abcdef12");
		expect(banner?.textContent).toContain("~/.cline/worktrees/abc12/repo");

		const keepButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Keep",
		);
		const resumeButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Resume",
		);
		const discardButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Discard",
		);
		expect(keepButton).toBeDefined();
		expect(resumeButton).toBeDefined();
		expect(discardButton).toBeDefined();
		expect(discardButton?.disabled).toBe(true);

		await act(async () => {
			keepButton?.click();
		});
		expect(hookState.keep).toHaveBeenCalledTimes(1);

		await act(async () => {
			resumeButton?.click();
		});
		expect(onResume).toHaveBeenCalledWith("abc12");
	});
});
