import { GitBranch, Play, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { useStrandedTaskWorktree } from "@/hooks/use-stranded-task-worktree";
import type { RuntimeTaskSessionState } from "@/runtime/types";
import { formatPathForDisplay } from "@/utils/path-display";
import { isLiveTaskSessionState } from "@/utils/stranded-task-session";

export function StrandedWorktreeBanner({
	workspaceId,
	taskId,
	baseRef,
	sessionState,
	onResume,
}: {
	workspaceId: string | null;
	taskId: string;
	baseRef: string;
	sessionState: RuntimeTaskSessionState | null | undefined;
	onResume?: (taskId: string) => void;
}): React.ReactElement | null {
	const { status, keep, discard, isKeeping, isDiscarding } = useStrandedTaskWorktree({
		workspaceId,
		taskId,
		baseRef,
		sessionState,
	});
	const [discardOpen, setDiscardOpen] = useState(false);

	if (!status?.stranded || isLiveTaskSessionState(sessionState)) {
		return null;
	}

	const displayPath = formatPathForDisplay(status.path);
	const headLabel = status.headShortSha ?? "unknown";
	const reachabilityLabel = status.reachable
		? "reachable from a branch or tag"
		: "not reachable from any branch or tag";
	const recoveredLabel = status.recoveredBranchExists ? `saved on ${status.recoveredBranch}` : null;
	const busy = isKeeping || isDiscarding;
	const discardDisabledReason = status.canDiscard
		? null
		: `Keep first — HEAD is not reachable from any branch or tag.`;

	return (
		<div
			className="flex shrink-0 flex-col gap-2 border-b border-status-orange/30 bg-status-orange/10 px-3 py-2"
			data-testid="stranded-worktree-banner"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<p className="m-0 text-xs font-medium text-status-orange">Stranded worktree</p>
					<p className="m-0 font-mono text-[11px] text-text-secondary" style={{ overflowWrap: "anywhere" }}>
						{displayPath}
					</p>
					<p className="m-0 text-[11px] text-text-tertiary">
						HEAD {headLabel} · {reachabilityLabel}
						{recoveredLabel ? ` · ${recoveredLabel}` : ""}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<Button
						size="sm"
						variant="default"
						icon={isKeeping ? <Spinner size={12} /> : <GitBranch size={12} />}
						disabled={busy}
						onClick={() => {
							void keep();
						}}
					>
						Keep
					</Button>
					{onResume ? (
						<Button
							size="sm"
							variant="primary"
							icon={<Play size={12} />}
							disabled={busy}
							onClick={() => {
								onResume(taskId);
							}}
						>
							Resume
						</Button>
					) : null}
					<Tooltip content={discardDisabledReason}>
						<span>
							<Button
								size="sm"
								variant="danger"
								icon={isDiscarding ? <Spinner size={12} /> : <Trash2 size={12} />}
								disabled={busy || !status.canDiscard}
								onClick={() => {
									setDiscardOpen(true);
								}}
							>
								Discard
							</Button>
						</span>
					</Tooltip>
				</div>
			</div>
			<AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
				<AlertDialogHeader>
					<AlertDialogTitle>Discard stranded worktree?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription>
						This deletes the worktree at {displayPath}. HEAD {headLabel} is already reachable from a branch or
						tag.
					</AlertDialogDescription>
				</AlertDialogBody>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button variant="default">Cancel</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="danger"
							onClick={() => {
								setDiscardOpen(false);
								void discard();
							}}
						>
							Discard
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialog>
		</div>
	);
}
