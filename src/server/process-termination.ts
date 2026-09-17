import treeKill from "tree-kill";

interface TimeoutTerminatedChildProcess {
	pid?: number;
	kill: (signal?: NodeJS.Signals | number) => boolean;
}

type KillProcessTree = (pid: number, signal?: string, callback?: (error?: Error) => void) => void;
type KillProcessGroup = (pid: number, signal: NodeJS.Signals) => void;
type ScheduleEscalation = (callback: () => void, delayMs: number) => void;

export const PROCESS_SIGKILL_ESCALATION_MS = 2_000;

interface TerminateProcessForTimeoutOptions {
	platform?: NodeJS.Platform;
	killProcessTree?: KillProcessTree;
	killProcessGroup?: KillProcessGroup;
	scheduleEscalation?: ScheduleEscalation;
	escalationDelayMs?: number;
}

function defaultKillProcessGroup(pid: number, signal: NodeJS.Signals): void {
	process.kill(-pid, signal);
}

function defaultScheduleEscalation(callback: () => void, delayMs: number): void {
	const timer = setTimeout(callback, delayMs);
	timer.unref();
}

function tryKillChild(child: TimeoutTerminatedChildProcess, signal?: NodeJS.Signals): void {
	try {
		if (signal) {
			child.kill(signal);
			return;
		}
		child.kill();
	} catch {
		// Best effort only.
	}
}

function tryKillProcessTree(killProcessTree: KillProcessTree, pid: number, signal: string): void {
	if (pid <= 0) {
		return;
	}
	try {
		killProcessTree(pid, signal, () => {
			// Best effort only.
		});
	} catch {
		// Best effort only.
	}
}

function tryKillProcessGroup(killProcessGroup: KillProcessGroup, pid: number, signal: NodeJS.Signals): void {
	if (pid <= 0) {
		return;
	}
	try {
		killProcessGroup(pid, signal);
	} catch {
		// Best effort only. The child may not lead a process group.
	}
}

export function terminateProcessForTimeout(
	child: TimeoutTerminatedChildProcess,
	options: TerminateProcessForTimeoutOptions = {},
): void {
	const platform = options.platform ?? process.platform;
	const pid = typeof child.pid === "number" ? child.pid : 0;
	const killProcessTree = options.killProcessTree ?? treeKill;
	const killProcessGroup = options.killProcessGroup ?? defaultKillProcessGroup;
	const scheduleEscalation = options.scheduleEscalation ?? defaultScheduleEscalation;
	const escalationDelayMs = options.escalationDelayMs ?? PROCESS_SIGKILL_ESCALATION_MS;

	if (platform === "win32") {
		tryKillChild(child);
		tryKillProcessTree(killProcessTree, pid, "SIGTERM");
		scheduleEscalation(() => {
			tryKillChild(child);
			tryKillProcessTree(killProcessTree, pid, "SIGKILL");
		}, escalationDelayMs);
		return;
	}

	tryKillChild(child, "SIGTERM");
	tryKillProcessGroup(killProcessGroup, pid, "SIGTERM");
	tryKillProcessTree(killProcessTree, pid, "SIGTERM");
	scheduleEscalation(() => {
		tryKillChild(child, "SIGKILL");
		tryKillProcessGroup(killProcessGroup, pid, "SIGKILL");
		tryKillProcessTree(killProcessTree, pid, "SIGKILL");
	}, escalationDelayMs);
}
