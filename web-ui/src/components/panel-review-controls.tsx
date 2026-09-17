import {
	DEFAULT_PANEL_REVIEW_FAMILIES,
	PANEL_REVIEW_FAMILIES,
	PANEL_REVIEW_FAMILY_LABELS,
	PANEL_REVIEW_MODE_LABELS,
	PANEL_REVIEW_MODES,
	type PanelReviewFamily,
	type PanelReviewMode,
	resolveTaskPanelReviewMode,
	sanitizePanelReviewFamilies,
} from "@runtime-panel-review";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

export function togglePanelReviewFamily(
	current: readonly PanelReviewFamily[],
	family: PanelReviewFamily,
	minOne: boolean,
): PanelReviewFamily[] {
	const present = new Set(sanitizePanelReviewFamilies(current));
	if (present.has(family)) {
		present.delete(family);
		if (minOne && present.size === 0) {
			return sanitizePanelReviewFamilies(current);
		}
	} else {
		present.add(family);
	}
	return PANEL_REVIEW_FAMILIES.filter((item) => present.has(item));
}

export function familiesForCustomStart(
	cardFamilies: readonly PanelReviewFamily[] | null | undefined,
	workspaceFamilies: readonly PanelReviewFamily[] | null | undefined,
): PanelReviewFamily[] {
	const fromCard = sanitizePanelReviewFamilies(cardFamilies ?? []);
	if (fromCard.length > 0) {
		return fromCard;
	}
	const fromWorkspace = sanitizePanelReviewFamilies(workspaceFamilies ?? []);
	if (fromWorkspace.length > 0) {
		return fromWorkspace;
	}
	return [...DEFAULT_PANEL_REVIEW_FAMILIES];
}

export function PanelReviewFamilyChips({
	families,
	onChange,
	disabled,
	minOne = false,
}: {
	families: readonly PanelReviewFamily[];
	onChange: (next: PanelReviewFamily[]) => void;
	disabled?: boolean;
	minOne?: boolean;
}): React.ReactElement {
	const selected = new Set(sanitizePanelReviewFamilies(families));
	return (
		<div className="flex flex-wrap gap-1.5" role="group" aria-label="Panel review families">
			{PANEL_REVIEW_FAMILIES.map((family) => {
				const isSelected = selected.has(family);
				return (
					<Button
						key={family}
						type="button"
						size="sm"
						variant={isSelected ? "primary" : "default"}
						aria-pressed={isSelected}
						disabled={disabled}
						onClick={() => onChange(togglePanelReviewFamily(families, family, minOne))}
						className={cn("h-6 px-2 text-[11px]", !isSelected && "text-text-secondary")}
					>
						{PANEL_REVIEW_FAMILY_LABELS[family]}
					</Button>
				);
			})}
		</div>
	);
}

export function PanelReviewModeToggle({
	mode,
	onChange,
	disabled,
}: {
	mode: PanelReviewMode;
	onChange: (mode: PanelReviewMode) => void;
	disabled?: boolean;
}): React.ReactElement {
	const resolved = resolveTaskPanelReviewMode(mode);
	return (
		<div className="flex items-center gap-1" role="group" aria-label="Panel review mode">
			{PANEL_REVIEW_MODES.map((item) => {
				const isSelected = resolved === item;
				return (
					<Button
						key={item}
						type="button"
						size="sm"
						variant={isSelected ? "primary" : "ghost"}
						aria-pressed={isSelected}
						disabled={disabled}
						onClick={() => onChange(item)}
						className="h-6 px-2 text-[11px]"
					>
						{PANEL_REVIEW_MODE_LABELS[item]}
					</Button>
				);
			})}
		</div>
	);
}

export function PanelReviewCardOverride({
	mode,
	families,
	workspaceEnabled,
	workspaceFamilies,
	onChange,
	disabled,
}: {
	mode: PanelReviewMode | null | undefined;
	families?: readonly PanelReviewFamily[] | null;
	workspaceEnabled: boolean;
	workspaceFamilies: readonly PanelReviewFamily[];
	onChange?: (next: { panelReviewMode: PanelReviewMode; panelReviewFamilies?: PanelReviewFamily[] }) => void;
	disabled?: boolean;
}): React.ReactElement {
	const resolvedMode = resolveTaskPanelReviewMode(mode);
	const workspaceLabels = sanitizePanelReviewFamilies(
		workspaceFamilies.length > 0 ? workspaceFamilies : DEFAULT_PANEL_REVIEW_FAMILIES,
	)
		.map((family) => PANEL_REVIEW_FAMILY_LABELS[family])
		.join(", ");

	const handleModeChange = (nextMode: PanelReviewMode) => {
		if (!onChange) {
			return;
		}
		if (nextMode === "custom") {
			onChange({
				panelReviewMode: "custom",
				panelReviewFamilies: familiesForCustomStart(families, workspaceFamilies),
			});
			return;
		}
		onChange({ panelReviewMode: nextMode });
	};

	return (
		<div className="shrink-0 border-b border-border/40 px-3 py-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Panel review</span>
				<PanelReviewModeToggle mode={resolvedMode} onChange={handleModeChange} disabled={disabled || !onChange} />
			</div>
			{resolvedMode === "custom" ? (
				<div className="mt-2">
					<PanelReviewFamilyChips
						families={familiesForCustomStart(families, workspaceFamilies)}
						minOne
						disabled={disabled || !onChange}
						onChange={(next) => onChange?.({ panelReviewMode: "custom", panelReviewFamilies: next })}
					/>
				</div>
			) : null}
			{resolvedMode === "inherit" ? (
				<p className="mt-1 mb-0 text-[11px] text-text-tertiary">
					{workspaceEnabled
						? `Workspace default: ${workspaceLabels}. The implementing family is excluded at review time.`
						: "Workspace default is off"}
				</p>
			) : null}
		</div>
	);
}
