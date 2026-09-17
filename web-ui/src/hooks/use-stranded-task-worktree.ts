import { useCallback, useState } from "react";

import { notifyError, showAppToast } from "@/components/app-toaster";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeTaskSessionState, RuntimeTaskWorktreeStatusResponse } from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";

export interface UseStrandedTaskWorktreeResult {
	status: RuntimeTaskWorktreeStatusResponse | null;
	isLoading: boolean;
	keep: () => Promise<boolean>;
	discard: () => Promise<boolean>;
	isKeeping: boolean;
	isDiscarding: boolean;
}

export function useStrandedTaskWorktree(options: {
	workspaceId: string | null;
	taskId: string;
	baseRef: string;
	sessionState: RuntimeTaskSessionState | null | undefined;
}): UseStrandedTaskWorktreeResult {
	const { workspaceId, taskId, baseRef, sessionState } = options;
	const [isKeeping, setIsKeeping] = useState(false);
	const [isDiscarding, setIsDiscarding] = useState(false);

	const queryFn = useCallback(async (): Promise<RuntimeTaskWorktreeStatusResponse> => {
		if (!workspaceId) {
			throw new Error("No project selected.");
		}
		void sessionState;
		const trpcClient = getRuntimeTrpcClient(workspaceId);
		return await trpcClient.workspace.getTaskWorktree.query({
			taskId,
			baseRef,
		});
	}, [baseRef, sessionState, taskId, workspaceId]);

	const { data, isLoading, refetch, setData } = useTrpcQuery<RuntimeTaskWorktreeStatusResponse>({
		enabled: Boolean(workspaceId && taskId && baseRef),
		queryFn,
		retainDataOnError: true,
	});

	const keep = useCallback(async (): Promise<boolean> => {
		if (!workspaceId) {
			notifyError("No project selected.");
			return false;
		}
		setIsKeeping(true);
		try {
			const trpcClient = getRuntimeTrpcClient(workspaceId);
			const result = await trpcClient.workspace.keepTaskWorktree.mutate({
				taskId,
				baseRef,
			});
			if (!result.ok) {
				notifyError(result.error ?? "Could not keep the task worktree.");
				return false;
			}
			showAppToast({
				intent: "success",
				message: result.created
					? `Saved HEAD on ${result.branch}.`
					: `Updated ${result.branch} to the worktree HEAD.`,
			});
			const nextStatus = await refetch();
			if (nextStatus) {
				setData(nextStatus);
			}
			return true;
		} catch (error) {
			notifyError(error instanceof Error ? error.message : String(error));
			return false;
		} finally {
			setIsKeeping(false);
		}
	}, [baseRef, refetch, setData, taskId, workspaceId]);

	const discard = useCallback(async (): Promise<boolean> => {
		if (!workspaceId) {
			notifyError("No project selected.");
			return false;
		}
		setIsDiscarding(true);
		try {
			const trpcClient = getRuntimeTrpcClient(workspaceId);
			const result = await trpcClient.workspace.discardTaskWorktree.mutate({
				taskId,
				baseRef,
			});
			if (!result.ok) {
				notifyError(result.error ?? "Could not discard the task worktree.");
				return false;
			}
			showAppToast({
				intent: "success",
				message: result.removed ? "Discarded the stranded worktree." : "Task worktree was already gone.",
			});
			const nextStatus = await refetch();
			if (nextStatus) {
				setData(nextStatus);
			}
			return true;
		} catch (error) {
			notifyError(error instanceof Error ? error.message : String(error));
			return false;
		} finally {
			setIsDiscarding(false);
		}
	}, [baseRef, refetch, setData, taskId, workspaceId]);

	return {
		status: data,
		isLoading,
		keep,
		discard,
		isKeeping,
		isDiscarding,
	};
}
