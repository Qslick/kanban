/** Identity for this personal fork of Cline Kanban. Stock upstream has no `-qslick.` marker. */

export const FORK_ID = "qslick";

export function isPersonalForkVersion(version: string): boolean {
	return version.includes("-qslick.");
}

export function formatCliVersion(version: string): string {
	return isPersonalForkVersion(version) ? `${version} (qslick fork)` : version;
}

export function personalForkUpdateMessage(version: string): string {
	return (
		`This is the qslick personal fork (${version}). ` +
		"`kanban --update` would replace it with stock Cline Kanban from npm. " +
		"Pull `personal/stable` and run `npm run link` in ~/Development/kanban instead."
	);
}
