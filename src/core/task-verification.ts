import type { RuntimeBoardCard, RuntimeTaskVerifyResult } from "./api-contract";

export const TASK_VERIFY_OUTPUT_MAX_CHARS = 8_192;

export function normalizeVerifyCommand(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function cloneVerifyResult(result?: RuntimeTaskVerifyResult | null): RuntimeTaskVerifyResult | undefined {
	if (!result) {
		return undefined;
	}
	return {
		ok: result.ok,
		recordedAt: result.recordedAt,
		...(result.output !== undefined ? { output: result.output } : {}),
	};
}

/**
 * Auto-review may complete and arm a git action only when this is true.
 * No command means existing cards stay unblocked. A command with a missing
 * or failed last result fails closed.
 */
export function isTaskVerificationSatisfied(card: Pick<RuntimeBoardCard, "verifyCommand" | "verifyResult">): boolean {
	if (!normalizeVerifyCommand(card.verifyCommand)) {
		return true;
	}
	return card.verifyResult?.ok === true;
}

export function truncateVerifyOutput(output: string): string {
	if (output.length <= TASK_VERIFY_OUTPUT_MAX_CHARS) {
		return output;
	}
	return output.slice(0, TASK_VERIFY_OUTPUT_MAX_CHARS);
}

export function createTaskVerifyResult(input: {
	ok: boolean;
	output?: string;
	recordedAt: number;
}): RuntimeTaskVerifyResult {
	const output = input.output?.trim();
	return {
		ok: input.ok,
		recordedAt: input.recordedAt,
		...(output ? { output: truncateVerifyOutput(output) } : {}),
	};
}
