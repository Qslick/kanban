import type {
	RuntimeAgentId,
	RuntimeAgentMachineDefaultSource,
	RuntimeAgentMachineDefaults,
	RuntimeClineProviderSettings,
	RuntimeTaskAgentSettings,
} from "./api-contract";

export const UNKNOWN_AGENT_MACHINE_DEFAULTS: RuntimeAgentMachineDefaults = {
	modelId: null,
	reasoningEffort: null,
	source: "unknown",
};

export type AgentMachineDefaultsById = Partial<Record<RuntimeAgentId, RuntimeAgentMachineDefaults>>;

export interface AgentMachineDefaultFileContents {
	claudeSettings?: string | null;
	claudeJson?: string | null;
	codexConfig?: string | null;
	grokConfig?: string | null;
	clineProviders?: string | null;
	geminiSettings?: string | null;
	opencodeConfig?: string | null;
	opencodeModelState?: string | null;
	droidSettings?: string | null;
	kiroSettings?: string | null;
}

export interface ProbeAgentMachineDefaultsInput {
	files?: AgentMachineDefaultFileContents;
	clineProviderSettings?: Pick<RuntimeClineProviderSettings, "modelId" | "reasoningEffort"> | null;
}

function emptyToNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function machineDefaults(
	source: RuntimeAgentMachineDefaultSource,
	modelId: string | null,
	reasoningEffort: string | null,
	displayModel?: string | null,
): RuntimeAgentMachineDefaults {
	const resolvedDisplayModel = emptyToNull(displayModel);
	return {
		modelId: emptyToNull(modelId),
		reasoningEffort: emptyToNull(reasoningEffort),
		source,
		...(resolvedDisplayModel ? { displayModel: resolvedDisplayModel } : {}),
	};
}

function stripJsonComments(input: string): string {
	let output = "";
	let inString = false;
	let escaped = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = 0; i < input.length; i += 1) {
		const current = input[i];
		const next = i + 1 < input.length ? input[i + 1] : "";

		if (inLineComment) {
			if (current === "\n") {
				inLineComment = false;
				output += current;
			}
			continue;
		}
		if (inBlockComment) {
			if (current === "*" && next === "/") {
				inBlockComment = false;
				i += 1;
			}
			continue;
		}
		if (!inString && current === "/" && next === "/") {
			inLineComment = true;
			i += 1;
			continue;
		}
		if (!inString && current === "/" && next === "*") {
			inBlockComment = true;
			i += 1;
			continue;
		}

		output += current;
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (current === "\\") {
				escaped = true;
			} else if (current === '"') {
				inString = false;
			}
			continue;
		}
		if (current === '"') {
			inString = true;
		}
	}
	return output;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
	const trimmed = text.replace(/^\uFEFF/, "").trim();
	if (!trimmed) {
		return null;
	}
	const attempts = [trimmed, stripJsonComments(trimmed)];
	for (const candidate of attempts) {
		try {
			const parsed: unknown = JSON.parse(candidate);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			// Try the next candidate.
		}
	}
	return null;
}

function readStringField(record: Record<string, unknown> | null | undefined, key: string): string | null {
	if (!record) {
		return null;
	}
	const value = record[key];
	return typeof value === "string" ? emptyToNull(value) : null;
}

function stripTomlLineComment(line: string): string {
	let inSingle = false;
	let inDouble = false;
	let escaped = false;
	for (let i = 0; i < line.length; i += 1) {
		const current = line[i];
		if (inDouble) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (current === "\\") {
				escaped = true;
				continue;
			}
			if (current === '"') {
				inDouble = false;
			}
			continue;
		}
		if (inSingle) {
			if (current === "'") {
				inSingle = false;
			}
			continue;
		}
		if (current === '"') {
			inDouble = true;
			continue;
		}
		if (current === "'") {
			inSingle = true;
			continue;
		}
		if (current === "#") {
			return line.slice(0, i);
		}
	}
	return line;
}

function unquoteTomlKey(raw: string): string {
	const trimmed = raw.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function unquoteTomlString(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed || trimmed.startsWith("[") || trimmed.startsWith("{")) {
		return null;
	}
	if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
		return null;
	}
	if (trimmed.startsWith('"')) {
		let escaped = false;
		let value = "";
		for (let i = 1; i < trimmed.length; i += 1) {
			const current = trimmed[i];
			if (escaped) {
				value += current;
				escaped = false;
				continue;
			}
			if (current === "\\") {
				escaped = true;
				continue;
			}
			if (current === '"') {
				return emptyToNull(value);
			}
			value += current;
		}
		return null;
	}
	if (trimmed.startsWith("'")) {
		const end = trimmed.indexOf("'", 1);
		if (end === -1) {
			return null;
		}
		return emptyToNull(trimmed.slice(1, end));
	}
	const token = trimmed.split(/\s+/, 1)[0] ?? "";
	if (!token || token === "true" || token === "false" || token === "null") {
		return emptyToNull(token === "true" || token === "false" || token === "null" ? null : token);
	}
	return emptyToNull(token);
}

function parseTomlScalarTables(text: string): Record<string, Record<string, string>> {
	const tables: Record<string, Record<string, string>> = { "": {} };
	let current = "";
	for (const rawLine of text.split(/\r?\n/)) {
		const line = stripTomlLineComment(rawLine).trim();
		if (!line) {
			continue;
		}
		if (line.startsWith("[[")) {
			current = "\0array";
			tables[current] ??= {};
			continue;
		}
		if (line.startsWith("[") && line.endsWith("]")) {
			current = line.slice(1, -1).trim();
			tables[current] ??= {};
			continue;
		}
		const eq = line.indexOf("=");
		if (eq <= 0) {
			continue;
		}
		const key = unquoteTomlKey(line.slice(0, eq));
		const value = unquoteTomlString(line.slice(eq + 1));
		if (!key || value === null) {
			continue;
		}
		const table = tables[current] ?? {};
		table[key] = value;
		tables[current] = table;
	}
	return tables;
}

function parseClaudeSettings(text: string): { modelId: string | null; reasoningEffort: string | null } | null {
	const root = parseJsonObject(text);
	if (!root) {
		return null;
	}
	return {
		modelId: readStringField(root, "model"),
		reasoningEffort: readStringField(root, "effortLevel"),
	};
}

function parseCodexConfig(text: string): { modelId: string | null; reasoningEffort: string | null } | null {
	const tables = parseTomlScalarTables(text);
	const root = tables[""] ?? {};
	return {
		modelId: emptyToNull(root.model),
		reasoningEffort: emptyToNull(root.model_reasoning_effort),
	};
}

function parseGrokConfig(text: string): { modelId: string | null; reasoningEffort: string | null } | null {
	const tables = parseTomlScalarTables(text);
	const models = tables.models ?? {};
	return {
		modelId: emptyToNull(models.default),
		reasoningEffort: emptyToNull(models.default_reasoning_effort),
	};
}

function parseClineProviders(text: string): { modelId: string | null; reasoningEffort: string | null } | null {
	const root = parseJsonObject(text);
	if (!root) {
		return null;
	}
	const lastUsed = readStringField(root, "lastUsedProvider");
	const providersValue = root.providers;
	if (!lastUsed || !providersValue || typeof providersValue !== "object" || Array.isArray(providersValue)) {
		return {
			modelId: null,
			reasoningEffort: null,
		};
	}
	const entry = (providersValue as Record<string, unknown>)[lastUsed];
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
		return {
			modelId: null,
			reasoningEffort: null,
		};
	}
	const entryRecord = entry as Record<string, unknown>;
	const settingsValue = entryRecord.settings;
	const settings =
		settingsValue && typeof settingsValue === "object" && !Array.isArray(settingsValue)
			? (settingsValue as Record<string, unknown>)
			: entryRecord;
	const reasoningValue = settings.reasoning;
	const reasoningEffort =
		reasoningValue && typeof reasoningValue === "object" && !Array.isArray(reasoningValue)
			? readStringField(reasoningValue as Record<string, unknown>, "effort")
			: null;
	return {
		modelId: readStringField(settings, "model"),
		reasoningEffort,
	};
}

function parseGenericJsonModel(text: string): { modelId: string | null; reasoningEffort: string | null } | null {
	const root = parseJsonObject(text);
	if (!root) {
		return null;
	}
	const nestedModel =
		root.model && typeof root.model === "object" && !Array.isArray(root.model)
			? (readStringField(root.model as Record<string, unknown>, "id") ??
				readStringField(root.model as Record<string, unknown>, "name"))
			: null;
	return {
		modelId: readStringField(root, "model") ?? nestedModel,
		reasoningEffort:
			readStringField(root, "effort") ??
			readStringField(root, "reasoningEffort") ??
			readStringField(root, "reasoning_effort"),
	};
}

function parseOpenCodeConfig(text: string): { modelId: string | null; reasoningEffort: string | null } | null {
	const root = parseJsonObject(text);
	if (!root) {
		return null;
	}
	const directModel = readStringField(root, "model");
	if (directModel) {
		return { modelId: directModel, reasoningEffort: null };
	}
	for (const groupKey of ["mode", "agent"] as const) {
		const group = root[groupKey];
		if (!group || typeof group !== "object" || Array.isArray(group)) {
			continue;
		}
		const build = (group as Record<string, unknown>).build;
		if (!build || typeof build !== "object" || Array.isArray(build)) {
			continue;
		}
		const model = readStringField(build as Record<string, unknown>, "model");
		if (model) {
			return { modelId: model, reasoningEffort: null };
		}
	}
	return { modelId: null, reasoningEffort: null };
}

function parseOpenCodeModelState(text: string): { modelId: string | null; reasoningEffort: string | null } | null {
	const root = parseJsonObject(text);
	if (!root) {
		return null;
	}
	const recent = root.recent;
	if (!Array.isArray(recent) || recent.length === 0) {
		return { modelId: null, reasoningEffort: null };
	}
	const first = recent[0];
	if (!first || typeof first !== "object" || Array.isArray(first)) {
		return { modelId: null, reasoningEffort: null };
	}
	const record = first as Record<string, unknown>;
	const providerId = readStringField(record, "providerID");
	const modelId = readStringField(record, "modelID");
	if (!modelId) {
		return { modelId: null, reasoningEffort: null };
	}
	if (providerId && !modelId.startsWith(`${providerId}/`)) {
		return { modelId: `${providerId}/${modelId}`, reasoningEffort: null };
	}
	return { modelId, reasoningEffort: null };
}

function probeClaude(files: AgentMachineDefaultFileContents): RuntimeAgentMachineDefaults {
	const settingsText = files.claudeSettings;
	const jsonText = files.claudeJson;
	const settings = typeof settingsText === "string" ? parseClaudeSettings(settingsText) : null;
	const fallback = typeof jsonText === "string" ? parseClaudeSettings(jsonText) : null;
	if (!settings && !fallback) {
		return UNKNOWN_AGENT_MACHINE_DEFAULTS;
	}
	return machineDefaults(
		"claude-settings",
		settings?.modelId ?? fallback?.modelId ?? null,
		settings?.reasoningEffort ?? fallback?.reasoningEffort ?? null,
	);
}

function probeCodex(files: AgentMachineDefaultFileContents): RuntimeAgentMachineDefaults {
	if (typeof files.codexConfig !== "string") {
		return UNKNOWN_AGENT_MACHINE_DEFAULTS;
	}
	const parsed = parseCodexConfig(files.codexConfig);
	if (!parsed) {
		return UNKNOWN_AGENT_MACHINE_DEFAULTS;
	}
	return machineDefaults("codex-config", parsed.modelId, parsed.reasoningEffort);
}

function probeGrok(files: AgentMachineDefaultFileContents): RuntimeAgentMachineDefaults {
	if (typeof files.grokConfig !== "string") {
		return UNKNOWN_AGENT_MACHINE_DEFAULTS;
	}
	const parsed = parseGrokConfig(files.grokConfig);
	if (!parsed) {
		return UNKNOWN_AGENT_MACHINE_DEFAULTS;
	}
	return machineDefaults("grok-config", parsed.modelId, parsed.reasoningEffort);
}

function probeCline(
	files: AgentMachineDefaultFileContents,
	clineProviderSettings: ProbeAgentMachineDefaultsInput["clineProviderSettings"],
): RuntimeAgentMachineDefaults {
	if (clineProviderSettings) {
		return machineDefaults(
			"cline-sdk",
			clineProviderSettings.modelId ?? null,
			clineProviderSettings.reasoningEffort ?? null,
		);
	}
	if (typeof files.clineProviders !== "string") {
		return UNKNOWN_AGENT_MACHINE_DEFAULTS;
	}
	const parsed = parseClineProviders(files.clineProviders);
	if (!parsed) {
		return UNKNOWN_AGENT_MACHINE_DEFAULTS;
	}
	return machineDefaults("cline-sdk", parsed.modelId, parsed.reasoningEffort);
}

function probeUnknownFromJson(text: string | null | undefined): RuntimeAgentMachineDefaults {
	if (typeof text !== "string") {
		return UNKNOWN_AGENT_MACHINE_DEFAULTS;
	}
	const parsed = parseGenericJsonModel(text);
	if (!parsed) {
		return UNKNOWN_AGENT_MACHINE_DEFAULTS;
	}
	return machineDefaults("unknown", parsed.modelId, parsed.reasoningEffort);
}

function probeOpenCode(files: AgentMachineDefaultFileContents): RuntimeAgentMachineDefaults {
	if (typeof files.opencodeConfig === "string") {
		const parsed = parseOpenCodeConfig(files.opencodeConfig);
		if (parsed?.modelId) {
			return machineDefaults("unknown", parsed.modelId, parsed.reasoningEffort);
		}
	}
	if (typeof files.opencodeModelState === "string") {
		const parsed = parseOpenCodeModelState(files.opencodeModelState);
		if (parsed?.modelId) {
			return machineDefaults("unknown", parsed.modelId, parsed.reasoningEffort);
		}
	}
	return UNKNOWN_AGENT_MACHINE_DEFAULTS;
}

export function probeAgentMachineDefaults(
	agentId: RuntimeAgentId,
	input: ProbeAgentMachineDefaultsInput = {},
): RuntimeAgentMachineDefaults {
	const files = input.files ?? {};
	switch (agentId) {
		case "claude":
			return probeClaude(files);
		case "codex":
			return probeCodex(files);
		case "grok":
			return probeGrok(files);
		case "cline":
			return probeCline(files, input.clineProviderSettings);
		case "gemini":
			return probeUnknownFromJson(files.geminiSettings);
		case "opencode":
			return probeOpenCode(files);
		case "droid":
			return probeUnknownFromJson(files.droidSettings);
		case "kiro":
			return probeUnknownFromJson(files.kiroSettings);
		default:
			return UNKNOWN_AGENT_MACHINE_DEFAULTS;
	}
}

export function indexAgentMachineDefaults(
	agents: ReadonlyArray<{ id: RuntimeAgentId; machineDefaults?: RuntimeAgentMachineDefaults }> | null | undefined,
): AgentMachineDefaultsById {
	const map: AgentMachineDefaultsById = {};
	for (const agent of agents ?? []) {
		if (agent.machineDefaults) {
			map[agent.id] = agent.machineDefaults;
		}
	}
	return map;
}

export function formatMachineDefaultHint(
	defaults:
		| {
				modelId?: string | null;
				reasoningEffort?: string | null;
				displayModel?: string | null;
				source?: RuntimeAgentMachineDefaultSource;
		  }
		| null
		| undefined,
): string | null {
	const model = emptyToNull(defaults?.displayModel) ?? emptyToNull(defaults?.modelId);
	const effort = emptyToNull(defaults?.reasoningEffort);
	if (!model && !effort) {
		return null;
	}
	const value = [model, effort].filter((part): part is string => Boolean(part)).join(" · ");
	return `${value} (machine default)`;
}

export function resolveEffectiveAgentMachineDefaults(input: {
	agentId?: RuntimeAgentId | null;
	defaultAgentId?: RuntimeAgentId | null;
	machineDefaultsByAgent?: AgentMachineDefaultsById;
}): RuntimeAgentMachineDefaults | null {
	const agentId = input.agentId ?? input.defaultAgentId ?? null;
	if (!agentId) {
		return null;
	}
	return input.machineDefaultsByAgent?.[agentId] ?? null;
}

export function resolveDisplayedAgentModelAndEffort(input: {
	agentSettings?: RuntimeTaskAgentSettings;
	machineDefaults?: RuntimeAgentMachineDefaults | null;
	fallbackModelId?: string | null;
}): {
	modelId: string | null;
	reasoningEffort: string | null;
	modelInherited: boolean;
	effortInherited: boolean;
} {
	const pinnedModel = emptyToNull(input.agentSettings?.modelId);
	const pinnedEffort = emptyToNull(input.agentSettings?.reasoningEffort);
	const inheritedModel =
		emptyToNull(input.machineDefaults?.displayModel) ??
		emptyToNull(input.machineDefaults?.modelId) ??
		emptyToNull(input.fallbackModelId);
	const inheritedEffort = emptyToNull(input.machineDefaults?.reasoningEffort);
	return {
		modelId: pinnedModel ?? inheritedModel,
		reasoningEffort: pinnedEffort ?? inheritedEffort,
		modelInherited: !pinnedModel,
		effortInherited: !pinnedEffort,
	};
}
