import { describe, expect, it, vi } from "vitest";

import { terminateProcessForTimeout } from "../../src/server/process-termination";

describe("terminateProcessForTimeout", () => {
	it("SIGTERMs the process group then SIGKILLs after the wait on non-windows platforms", () => {
		const kill = vi.fn(() => true);
		const killProcessTree = vi.fn();
		const killProcessGroup = vi.fn();
		const scheduled: Array<() => void> = [];

		terminateProcessForTimeout(
			{
				pid: 123,
				kill,
			},
			{
				platform: "linux",
				killProcessTree,
				killProcessGroup,
				scheduleEscalation: (callback) => {
					scheduled.push(callback);
				},
			},
		);

		expect(kill).toHaveBeenCalledWith("SIGTERM");
		expect(killProcessGroup).toHaveBeenCalledWith(123, "SIGTERM");
		expect(killProcessTree).toHaveBeenCalledWith(123, "SIGTERM", expect.any(Function));
		expect(scheduled).toHaveLength(1);

		scheduled[0]?.();

		expect(kill).toHaveBeenCalledWith("SIGKILL");
		expect(killProcessGroup).toHaveBeenCalledWith(123, "SIGKILL");
		expect(killProcessTree).toHaveBeenCalledWith(123, "SIGKILL", expect.any(Function));
	});

	it("uses default kill and taskkill tree on windows, then escalates to SIGKILL", () => {
		const kill = vi.fn(() => true);
		const killProcessTree = vi.fn();
		const scheduled: Array<() => void> = [];

		terminateProcessForTimeout(
			{
				pid: 456,
				kill,
			},
			{
				platform: "win32",
				killProcessTree,
				scheduleEscalation: (callback) => {
					scheduled.push(callback);
				},
			},
		);

		expect(kill).toHaveBeenCalledWith();
		expect(killProcessTree).toHaveBeenCalledWith(456, "SIGTERM", expect.any(Function));
		expect(scheduled).toHaveLength(1);

		scheduled[0]?.();

		expect(killProcessTree).toHaveBeenCalledWith(456, "SIGKILL", expect.any(Function));
	});

	it("skips taskkill tree when pid is missing on windows", () => {
		const kill = vi.fn(() => true);
		const killProcessTree = vi.fn();
		const scheduled: Array<() => void> = [];

		terminateProcessForTimeout(
			{
				kill,
			},
			{
				platform: "win32",
				killProcessTree,
				scheduleEscalation: (callback) => {
					scheduled.push(callback);
				},
			},
		);

		expect(kill).toHaveBeenCalledWith();
		expect(killProcessTree).not.toHaveBeenCalled();
		scheduled[0]?.();
		expect(killProcessTree).not.toHaveBeenCalled();
	});
});
