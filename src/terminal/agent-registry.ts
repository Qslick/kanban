import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { RuntimeConfigState } from "../config/runtime-config";
import type { RuntimeAgentCapabilities, RuntimeAgentCatalogEntry } from "../core/agent-catalog";
import {
	getRuntimeLaunchSupportedAgentCatalog,
	isRuntimeAgentLaunchSupported,
	RUNTIME_AGENT_CATALOG,
} from "../core/agent-catalog";
import {
	type AgentMachineDefaultFileContents,
	type ProbeAgentMachineDefaultsInput,
	probeAgentMachineDefaults,
} from "../core/agent-machine-defaults";
import type {
	RuntimeAgentDefinition,
	RuntimeAgentId,
	RuntimeAgentMachineDefaults,
	RuntimeClineProviderSettings,
	RuntimeConfigResponse,
} from "../core/api-contract";
import { isBinaryAvailableOnPath } from "./command-discovery";
import { getOpenCodeConfigPathCandidates, getOpenCodeModelStatePathCandidates } from "./opencode-paths";

export interface ResolvedAgentCommand {
	agentId: RuntimeAgentId;
	label: string;
	command: string;
	binary: string;
	args: string[];
}

function getDefaultArgs(agentId: RuntimeAgentId): string[] {
	const entry = RUNTIME_AGENT_CATALOG.find((candidate) => candidate.id === agentId);
	if (!entry) {
		return [];
	}
	return [...entry.baseArgs];
}

// Embedded agents (the Cline SDK) are always installed; everything else needs
// its binary on PATH.
function isAgentInstalled(entry: RuntimeAgentCatalogEntry, detectedSet: ReadonlySet<string>): boolean {
	return entry.embedded === true || detectedSet.has(entry.binary);
}

function quoteForDisplay(part: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(part)) {
		return part;
	}
	return JSON.stringify(part);
}

function joinCommand(binary: string, args: string[]): string {
	if (args.length === 0) {
		return binary;
	}
	return [binary, ...args.map(quoteForDisplay)].join(" ");
}

function parseBooleanEnvValue(value: string | undefined): boolean {
	const normalized = value?.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isRuntimeDebugModeEnabled(): boolean {
	const debugModeValue = process.env.KANBAN_DEBUG_MODE ?? process.env.DEBUG_MODE ?? process.env.debug_mode;
	return parseBooleanEnvValue(debugModeValue);
}

export function detectInstalledCommands(): string[] {
	const candidates = [...RUNTIME_AGENT_CATALOG.map((entry) => entry.binary), "npx"];
	const detected: string[] = [];

	for (const candidate of candidates) {
		if (isBinaryAvailableOnPath(candidate)) {
			detected.push(candidate);
		}
	}

	return detected;
}

export interface AgentMachineDefaultLoadOptions {
	homeDir?: string;
	readFile?: (path: string) => string | null;
	files?: AgentMachineDefaultFileContents;
	clineProviderSettings?: ProbeAgentMachineDefaultsInput["clineProviderSettings"];
}

function readTextFileIfExists(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

function firstExistingText(paths: string[], readFile: (path: string) => string | null): string | null {
	for (const path of paths) {
		const text = readFile(path);
		if (text !== null) {
			return text;
		}
	}
	return null;
}

export function loadAgentMachineDefaultFileContents(
	options: Pick<AgentMachineDefaultLoadOptions, "homeDir" | "readFile"> = {},
): AgentMachineDefaultFileContents {
	const homeDir = options.homeDir ?? homedir();
	const readFile = options.readFile ?? readTextFileIfExists;
	return {
		claudeSettings: readFile(join(homeDir, ".claude", "settings.json")),
		claudeJson: readFile(join(homeDir, ".claude.json")),
		codexConfig: readFile(join(homeDir, ".codex", "config.toml")),
		grokConfig: readFile(join(homeDir, ".grok", "config.toml")),
		clineProviders: readFile(join(homeDir, ".cline", "data", "settings", "providers.json")),
		geminiSettings: readFile(join(homeDir, ".gemini", "settings.json")),
		opencodeConfig: firstExistingText(getOpenCodeConfigPathCandidates({ homePath: homeDir }), readFile),
		opencodeModelState: firstExistingText(getOpenCodeModelStatePathCandidates({ homePath: homeDir }), readFile),
		droidSettings: firstExistingText(
			[
				join(homeDir, ".factory", "settings.json"),
				join(homeDir, ".factory", "cli.json"),
				join(homeDir, ".droid", "settings.json"),
			],
			readFile,
		),
		kiroSettings: firstExistingText(
			[join(homeDir, ".kiro", "settings.json"), join(homeDir, ".kiro-cli", "config.json")],
			readFile,
		),
	};
}

function resolveMachineDefaultFiles(options: AgentMachineDefaultLoadOptions = {}): AgentMachineDefaultFileContents {
	if (options.files !== undefined) {
		return options.files;
	}
	return loadAgentMachineDefaultFileContents(options);
}

function probeDefaultsForAgent(
	agentId: RuntimeAgentId,
	options: AgentMachineDefaultLoadOptions,
	files: AgentMachineDefaultFileContents,
): RuntimeAgentMachineDefaults {
	return probeAgentMachineDefaults(agentId, {
		files,
		clineProviderSettings: options.clineProviderSettings,
	});
}

function getCuratedDefinitions(
	runtimeConfig: RuntimeConfigState,
	detected: string[],
	options: AgentMachineDefaultLoadOptions,
	files: AgentMachineDefaultFileContents,
): RuntimeAgentDefinition[] {
	const detectedSet = new Set(detected);
	return getRuntimeLaunchSupportedAgentCatalog().map((entry) => {
		const defaultArgs = getDefaultArgs(entry.id);
		const command = joinCommand(entry.binary, defaultArgs);
		const isInstalled = isAgentInstalled(entry, detectedSet);
		return {
			id: entry.id,
			label: entry.label,
			binary: entry.binary,
			command,
			defaultArgs,
			installed: isInstalled,
			configured: runtimeConfig.selectedAgentId === entry.id,
			machineDefaults: probeDefaultsForAgent(entry.id, options, files),
		};
	});
}

export interface RuntimeAgentCapabilityReportEntry {
	id: RuntimeAgentId;
	label: string;
	installed: boolean;
	configured: boolean;
	launchSupported: boolean;
	capabilities: RuntimeAgentCapabilities;
	machineDefaults: RuntimeAgentMachineDefaults;
}

// Capability report for `kanban agents`: mechanisms plus probed machine defaults.
export function buildAgentCapabilityReport(
	runtimeConfig: RuntimeConfigState,
	options: AgentMachineDefaultLoadOptions = {},
): RuntimeAgentCapabilityReportEntry[] {
	const detectedSet = new Set(detectInstalledCommands());
	const files = resolveMachineDefaultFiles(options);
	return RUNTIME_AGENT_CATALOG.map((entry) => ({
		id: entry.id,
		label: entry.label,
		installed: isAgentInstalled(entry, detectedSet),
		configured: runtimeConfig.selectedAgentId === entry.id,
		launchSupported: isRuntimeAgentLaunchSupported(entry.id),
		capabilities: entry.capabilities,
		machineDefaults: probeDefaultsForAgent(entry.id, options, files),
	}));
}

export function resolveAgentCommand(runtimeConfig: RuntimeConfigState): ResolvedAgentCommand | null {
	const selected = getRuntimeLaunchSupportedAgentCatalog().find((entry) => entry.id === runtimeConfig.selectedAgentId);
	if (!selected) {
		return null;
	}
	const defaultArgs = getDefaultArgs(selected.id);
	const command = joinCommand(selected.binary, defaultArgs);
	if (isBinaryAvailableOnPath(selected.binary)) {
		return {
			agentId: selected.id,
			label: selected.label,
			command,
			binary: selected.binary,
			args: defaultArgs,
		};
	}
	return null;
}

export function buildRuntimeConfigResponse(
	runtimeConfig: RuntimeConfigState,
	clineProviderSettings: RuntimeClineProviderSettings,
	options: AgentMachineDefaultLoadOptions = {},
): RuntimeConfigResponse {
	const detectedCommands = detectInstalledCommands();
	const probeOptions: AgentMachineDefaultLoadOptions = {
		...options,
		clineProviderSettings: options.clineProviderSettings ?? clineProviderSettings,
	};
	const files = resolveMachineDefaultFiles(probeOptions);
	const agents = getCuratedDefinitions(runtimeConfig, detectedCommands, probeOptions, files);
	const resolved = resolveAgentCommand(runtimeConfig);
	const effectiveCommand = resolved ? joinCommand(resolved.binary, resolved.args) : null;

	return {
		selectedAgentId: runtimeConfig.selectedAgentId,
		selectedShortcutLabel: runtimeConfig.selectedShortcutLabel,
		agentAutonomousModeEnabled: runtimeConfig.agentAutonomousModeEnabled,
		debugModeEnabled: isRuntimeDebugModeEnabled(),
		effectiveCommand,
		globalConfigPath: runtimeConfig.globalConfigPath,
		projectConfigPath: runtimeConfig.projectConfigPath,
		readyForReviewNotificationsEnabled: runtimeConfig.readyForReviewNotificationsEnabled,
		maxInProgressTasks: runtimeConfig.maxInProgressTasks,
		panelReviewEnabled: runtimeConfig.panelReviewEnabled,
		panelReviewFamilies: runtimeConfig.panelReviewFamilies,
		detectedCommands,
		agents,
		shortcuts: runtimeConfig.shortcuts,
		clineProviderSettings,
		commitPromptTemplate: runtimeConfig.commitPromptTemplate,
		openPrPromptTemplate: runtimeConfig.openPrPromptTemplate,
		commitPromptTemplateDefault: runtimeConfig.commitPromptTemplateDefault,
		openPrPromptTemplateDefault: runtimeConfig.openPrPromptTemplateDefault,
	};
}
