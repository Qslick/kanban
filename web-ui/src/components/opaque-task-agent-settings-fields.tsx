import { formatMachineDefaultHint } from "@runtime-agent-machine-defaults";
import type { ReactElement } from "react";

import type { RuntimeAgentMachineDefaults, RuntimeTaskAgentSettings } from "@/runtime/types";

export function OpaqueTaskAgentSettingsFields({
	agentSettings,
	agentLabel,
	docsUrl,
	showModelInput,
	showEffortInput,
	onModelChange,
	onEffortChange,
	machineDefaults,
}: {
	agentSettings: RuntimeTaskAgentSettings | undefined;
	agentLabel: string;
	docsUrl: string | undefined;
	showModelInput: boolean;
	showEffortInput: boolean;
	onModelChange: (value: string) => void;
	onEffortChange: (value: string) => void;
	machineDefaults?: RuntimeAgentMachineDefaults | null;
}): ReactElement | null {
	if (!showModelInput && !showEffortInput) {
		return null;
	}

	const modelPlaceholder =
		formatMachineDefaultHint({
			modelId: machineDefaults?.displayModel ?? machineDefaults?.modelId ?? null,
			reasoningEffort: null,
			source: machineDefaults?.source ?? "unknown",
		}) ?? "Model ID";
	const effortPlaceholder =
		formatMachineDefaultHint({
			modelId: null,
			reasoningEffort: machineDefaults?.reasoningEffort ?? null,
			source: machineDefaults?.source ?? "unknown",
		}) ?? "Effort level";

	return (
		<div className="flex flex-col gap-2">
			<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{showModelInput ? (
					<div className="min-w-0">
						<span className="text-[11px] text-text-secondary block mb-1">Model</span>
						<input
							type="text"
							value={agentSettings?.modelId ?? ""}
							onChange={(e) => onModelChange(e.currentTarget.value)}
							placeholder={modelPlaceholder}
							aria-label="Model override"
							className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
					</div>
				) : null}
				{showEffortInput ? (
					<div className="min-w-0">
						<span className="text-[11px] text-text-secondary block mb-1">Reasoning effort</span>
						<input
							type="text"
							value={agentSettings?.reasoningEffort ?? ""}
							onChange={(e) => onEffortChange(e.currentTarget.value)}
							placeholder={effortPlaceholder}
							aria-label="Reasoning effort override"
							className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
					</div>
				) : null}
			</div>
			<p className="m-0 text-[11px] text-text-tertiary">Empty inherits this agent's machine default.</p>
			{docsUrl ? (
				<a
					href={docsUrl}
					target="_blank"
					rel="noreferrer"
					className="w-fit text-[11px] text-accent hover:text-accent-hover"
				>
					{agentLabel} CLI reference
				</a>
			) : null}
		</div>
	);
}
