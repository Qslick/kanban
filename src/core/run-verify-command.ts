import { spawn } from "node:child_process";

import type { RuntimeTaskVerifyResult } from "./api-contract";
import { createGitProcessEnv } from "./git-process-env";
import { createTaskVerifyResult, normalizeVerifyCommand } from "./task-verification";

export interface VerifyCommandExecution {
	exitCode: number;
	stdout: string;
	stderr: string;
	combinedOutput: string;
}

export type RunVerifyCommand = (command: string, cwd: string) => Promise<VerifyCommandExecution>;

const VERIFY_COMMAND_TIMEOUT_MS = 60_000;
const VERIFY_OUTPUT_LIMIT_BYTES = 64 * 1024;

export async function runVerifyCommandInWorktree(input: {
	command: string;
	cwd: string;
	recordedAt?: number;
	runCommand?: RunVerifyCommand;
}): Promise<RuntimeTaskVerifyResult> {
	const command = normalizeVerifyCommand(input.command);
	if (!command) {
		throw new Error("Verification command is required.");
	}
	const recordedAt = input.recordedAt ?? Date.now();
	const runCommand = input.runCommand ?? defaultRunVerifyCommand;
	try {
		const executed = await runCommand(command, input.cwd);
		return createTaskVerifyResult({
			ok: executed.exitCode === 0,
			output: executed.combinedOutput,
			recordedAt,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return createTaskVerifyResult({
			ok: false,
			output: message,
			recordedAt,
		});
	}
}

async function defaultRunVerifyCommand(command: string, cwd: string): Promise<VerifyCommandExecution> {
	return await new Promise<VerifyCommandExecution>((resolve, reject) => {
		const child = spawn(command, {
			cwd,
			shell: true,
			env: createGitProcessEnv(),
			stdio: ["ignore", "pipe", "pipe"],
		});

		if (!child.stdout || !child.stderr) {
			reject(new Error("Verification process did not expose stdout/stderr."));
			return;
		}

		let stdout = "";
		let stderr = "";
		let settled = false;

		const appendOutput = (current: string, chunk: string): string => {
			const next = current + chunk;
			if (next.length <= VERIFY_OUTPUT_LIMIT_BYTES) {
				return next;
			}
			return next.slice(0, VERIFY_OUTPUT_LIMIT_BYTES);
		};

		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout = appendOutput(stdout, String(chunk));
		});
		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr = appendOutput(stderr, String(chunk));
		});

		const finish = (execution: VerifyCommandExecution) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(execution);
		};

		child.on("error", (error) => {
			if (settled) {
				return;
			}
			settled = true;
			reject(error);
		});

		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			finish({
				exitCode: 1,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				combinedOutput: "Verification command timed out after 60s.",
			});
		}, VERIFY_COMMAND_TIMEOUT_MS);

		child.on("close", (code) => {
			clearTimeout(timeout);
			const exitCode = typeof code === "number" ? code : 1;
			const combinedOutput = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
			finish({
				exitCode,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				combinedOutput,
			});
		});
	});
}
