// Styles of the "Change Metadata" page.
// Adapted from Decky Metadata v0.6.4 (src/metadataEditorStyles.ts, src/styles.tsx,
// src/tokens.ts) by beallio, so both editors look alike:
//   https://github.com/beallio/Decky-Metadata
// Licensed under the GNU General Public License v3.0 or later. See NOTICE.

const accent = "#1a9fff";
const textSecondary = "#cbd5e1";

export const editorRootClassName = "metadeck-editor";
export const editorFocusTargetClassName = "metadeck-editor__focus-target";
// Room taken by the sticky action bar, kept clear when the controller scrolls to a field
const editorToolbarClearance = 104;

export const pageStyle = {
	padding: 24,
	paddingTop: 48,
	paddingBottom: 120,
	minHeight: "100vh",
	boxSizing: "border-box",
} as const;

export const pageTitleStyle = {
	width: "100%",
	fontSize: 20,
	fontWeight: 700,
	paddingBottom: 12,
	outline: "none",
	// Clear of the SteamOS top bar when the controller scrolls to it
	scrollMarginTop: 90,
} as const;

export const actionBarStyle = {
	position: "sticky",
	top: 40,
	zIndex: 20,
	display: "grid",
	gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
	gap: 8,
	width: "100%",
	minWidth: 0,
	margin: "-4px 0 0",
	padding: "8px 16px",
	boxSizing: "border-box",
	background: "rgba(14, 20, 27, 0.96)",
	backdropFilter: "blur(8px)",
} as const;

export const actionButtonStyle = {
	width: "100%",
	minWidth: 0,
	whiteSpace: "nowrap",
} as const;

export const searchRowStyle = {
	display: "grid",
	gridTemplateColumns: "minmax(0, 1fr) minmax(112px, max-content)",
	alignItems: "center",
	gap: 8,
	width: "100%",
	minWidth: 0,
} as const;

export const searchButtonStyle = {
	width: "100%",
	minWidth: 112,
	whiteSpace: "nowrap",
} as const;

export const resultButtonStyle = {
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-start",
	gap: 2,
	width: "100%",
	minWidth: 0,
	textAlign: "left",
	whiteSpace: "normal",
} as const;

export const resultDetailStyle = {
	color: textSecondary,
	fontSize: 13,
	lineHeight: 1.35,
} as const;

export const previewStyle = {
	display: "flex",
	flexDirection: "column",
	gap: 8,
	minWidth: 0,
	padding: 12,
	border: "1px solid rgba(255,255,255,0.18)",
	borderRadius: 4,
} as const;

export const previewActionsStyle = {
	display: "grid",
	gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
	gap: 8,
} as const;

export const fieldStyle = {
	width: "100%",
	maxWidth: "100%",
	minWidth: 0,
	padding: "0 12px",
	marginTop: 14,
	background: "transparent",
	boxSizing: "border-box",
} as const;

export const labelStyle = {
	display: "block",
	marginBottom: 7,
} as const;

export const twoColumnsStyle = {
	display: "grid",
	gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
	gap: 8,
	width: "100%",
	minWidth: 0,
} as const;

export const categoryGridStyle = {
	display: "grid",
	gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
	columnGap: 12,
	rowGap: 6,
	width: "100%",
	minWidth: 0,
} as const;

export const compactTextStyle = {
	color: textSecondary,
	fontSize: 13,
	lineHeight: 1.35,
} as const;

// Fields with manual edits get an accent bar and an "edited" tag
export const editedFieldStyle = {
	borderLeft: `3px solid ${accent}`,
	paddingLeft: 12,
} as const;

export const editedLabelStyle = {
	color: accent,
} as const;

export const editedTagStyle = {
	marginLeft: 8,
	fontSize: 12,
	fontWeight: 600,
} as const;

export const scopedCss = `
.${editorRootClassName} .${editorFocusTargetClassName},
.${editorRootClassName} .metadeck-editor__category-grid > div,
.${editorRootClassName} .metadeck-editor__category-grid > div [role="checkbox"] {
	scroll-margin-top: ${editorToolbarClearance}px;
	scroll-margin-bottom: 24px;
}

.${editorRootClassName} .metadeck-editor__action--save:disabled {
	opacity: 0.55;
	filter: saturate(0.45);
}

.${editorRootClassName} .metadeck-editor__category-grid > div {
	display: flex;
	align-items: center;
	min-height: 36px !important;
	padding: 4px 12px !important;
	margin: 0 !important;
	box-sizing: border-box;
}

/* Readable search results: border-only focus highlight instead of Steam's filled background */
.${editorRootClassName} .metadeck-editor__result:focus-visible,
.${editorRootClassName} .metadeck-editor__result.gpfocus {
	background: transparent !important;
	color: white !important;
	outline: 3px solid white !important;
	outline-offset: 2px;
	box-shadow: 0 0 0 5px ${accent} !important;
}
`;
