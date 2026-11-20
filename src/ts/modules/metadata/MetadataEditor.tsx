import React, { FC, ReactNode, useMemo, useRef, useState } from "react";
import {
	ConfirmModal,
	DialogButton,
	Dropdown,
	Focusable,
	Navigation,
	PanelSection,
	PanelSectionRow,
	ScrollPanel,
	showModal,
	TextField,
	ToggleField,
	useParams
} from "@decky/ui";
import { useMetaDeckState } from "../../MetaDeckState";
import { t } from "../../useTranslations";
import { toasterToast } from "../../util";
import { getGamepadTextArea } from "../../gamepadTextArea";
import { SteamAppTypeShortcut, StoreCategory, type ID, type MetadataData } from "../../Interfaces";
import type { MetadataManualOverride, MetadataModule } from "./MetadataModule";
import type { FuzzySearchMetadataProvider } from "./providers/FuzzySearchMetadataProvider";
import type { LizardByteGameDBMetadataProvider } from "./providers/LizardByteGameDBMetadataProvider";
import { fetchIgn, searchIgn } from "./IgnSearch";
import {
	actionBarStyle, actionButtonStyle, categoryGridStyle, compactTextStyle, editedFieldStyle, editedLabelStyle,
	editedTagStyle, editorFocusTargetClassName, editorRootClassName, fieldStyle, labelStyle, pageStyle,
	pageTitleStyle, previewActionsStyle, previewStyle, resultButtonStyle, resultDetailStyle, scopedCss,
	searchButtonStyle, searchRowStyle, twoColumnsStyle
} from "./MetadataEditorStyles";

// Steam store categories that can be toggled by hand ("Steam info fields").
// Achievements are left out: the achievements module decides them.
const EDITABLE_CATEGORIES: { category: StoreCategory; label: Parameters<typeof t>[0] }[] = [
	{ category: StoreCategory.SinglePlayer, label: "editorCategorySinglePlayer" },
	{ category: StoreCategory.MultiPlayer, label: "editorCategoryMultiPlayer" },
	{ category: StoreCategory.CoOp, label: "editorCategoryCoOp" },
	{ category: StoreCategory.OnlineMultiPlayer, label: "editorCategoryOnlineMultiPlayer" },
	{ category: StoreCategory.OnlineCoOp, label: "editorCategoryOnlineCoOp" },
	{ category: StoreCategory.LocalMultiPlayer, label: "editorCategoryLocalMultiPlayer" },
	{ category: StoreCategory.LocalCoOp, label: "editorCategoryLocalCoOp" },
	{ category: StoreCategory.SplitScreen, label: "editorCategorySplitScreen" },
	{ category: StoreCategory.FullController, label: "editorCategoryFullController" },
	{ category: StoreCategory.PartialController, label: "editorCategoryPartialController" },
	{ category: StoreCategory.MMO, label: "editorCategoryMMO" }
];
const EDITABLE_CATEGORY_IDS = new Set<number>(EDITABLE_CATEGORIES.map((c) => c.category));

// Search sources: LizardByte first (best for emulated games)
type SearchSource = "lizardbyte" | "rawg" | "ign";

type SearchResult = {
	source: SearchSource;
	id: ID;
	title: string;
	year?: string;
	platforms?: string[];
	description?: string;
	entry?: MetadataData; // MetaDeck providers
	slug?: string; // IGN
};

type Draft = {
	description: string;
	developers: string;
	publishers: string;
	releaseDate: string; // YYYY-MM-DD, empty for none
	rating: string; // 0-100, empty for none
	categories: number[]; // Editable categories only
};

const namesToText = (people?: { name: string }[]) => (people ?? []).map((p) => p.name).join(", ");
const textToNames = (text: string) => text.split(",").map((name) => name.trim()).filter((name) => name.length);
const dateToText = (seconds?: number) => seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : "";
const sameList = (a: (string | number)[], b: (string | number)[]) =>
	a.length === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);
const snippet = (text?: string, length = 160) =>
	!text ? "" : text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;

function fuzzyProvider(module: MetadataModule, source: "lizardbyte" | "rawg"): FuzzySearchMetadataProvider<"lizardbyte" | "rawg"> | undefined {
	return module.providers.find((provider) => provider.identifier === source) as FuzzySearchMetadataProvider<"lizardbyte" | "rawg"> | undefined;
}

function draftFrom(data?: MetadataData): Draft {
	return {
		description: data?.description ?? "",
		developers: namesToText(data?.developers),
		publishers: namesToText(data?.publishers),
		releaseDate: dateToText(data?.release_date),
		rating: data?.rating != null && data.rating > 0 ? String(Math.round(data.rating)) : "",
		categories: (data?.store_categories ?? []).filter((c): c is StoreCategory =>
			typeof c === "number" && EDITABLE_CATEGORY_IDS.has(c))
	};
}

/** Draft fields differing from another draft (unsaved changes) */
function changedFields(draft: Draft, saved: Draft): (keyof Draft)[] {
	return (Object.keys(draft) as (keyof Draft)[]).filter((key) => key === "categories" ?
		!sameList(draft.categories, saved.categories) :
		key === "developers" || key === "publishers" ?
			!sameList(textToNames(draft[key]), textToNames(saved[key])) :
			draft[key].trim() !== saved[key].trim());
}

/** Validates the draft and keeps only the fields that differ from the provider data */
function overrideFrom(draft: Draft, provider?: MetadataData): { override?: MetadataManualOverride; error?: string } {
	const override: MetadataManualOverride = {};
	const base = draftFrom(provider);

	if (draft.description.trim() !== base.description.trim())
		override.description = draft.description.trim();

	const developers = textToNames(draft.developers);
	if (!sameList(developers, textToNames(base.developers)))
		override.developers = developers.map((name) => ({ name, url: "" }));

	const publishers = textToNames(draft.publishers);
	if (!sameList(publishers, textToNames(base.publishers)))
		override.publishers = publishers.map((name) => ({ name, url: "" }));

	const date = draft.releaseDate.trim();
	if (date !== base.releaseDate){
		if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
			return { error: t("editorInvalidDate") };
		const time = date ? Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) : 0;
		if (date && Number.isNaN(time))
			return { error: t("editorInvalidDate") };
		// 0 clears the provider's date
		override.release_date = Math.floor(time / 1000);
	}

	const rating = draft.rating.trim();
	if (rating !== base.rating){
		const value = rating ? Number(rating) : 0;
		if (!Number.isFinite(value) || value < 0 || value > 100)
			return { error: t("editorInvalidRating") };
		// 0 clears the provider's rating
		override.rating = value;
	}

	if (!sameList(draft.categories, base.categories)){
		// Keep the categories that can't be edited here (shortcut-derived, custom...)
		const kept = (provider?.store_categories ?? []).filter((c) => typeof c !== "number" || !EDITABLE_CATEGORY_IDS.has(c));
		override.store_categories = [...kept, ...draft.categories];
	}

	return { override };
}

/** "1998 · PS1, PC, NGC · ID 880": tells apart results sharing the same title */
function resultDetail(result: SearchResult): string {
	const platforms = result.platforms?.length ?
		result.platforms.slice(0, 5).join(", ") + (result.platforms.length > 5 ? "…" : "") :
		undefined;
	return [result.year, platforms, `ID ${result.id}`].filter((part) => part).join(" · ");
}

export const MetadataEditor: FC = () => {
	const state = useMetaDeckState();
	const module = state.modules.metadata;
	const { appid } = useParams<{ appid: string }>();
	const appId = Number(appid);
	const overview = appStore.GetAppOverviewByAppID(appId);
	const name = overview?.display_name ?? "";

	const GamepadTextArea = useMemo(() => getGamepadTextArea(), []);
	const [saved, setSaved] = useState<Draft>(() => draftFrom(module.fetchData(appId)));
	const [draft, setDraft] = useState<Draft>(saved);
	const [manual, setManual] = useState(() => module.getManualOverride(appId));
	const [saving, setSaving] = useState(false);

	const managed = overview?.app_type === SteamAppTypeShortcut && !module.excludedApps.includes(appId);
	const provider = module.getProviderData(appId);
	const providerId = module.dataProviders[appId];
	const changes = changedFields(draft, saved);

	const update = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));
	const reload = () => {
		const current = draftFrom(module.fetchData(appId));
		setSaved(current);
		setDraft(current);
		setManual(module.getManualOverride(appId));
	};

	const save = async () => {
		if (!changes.length || saving)
			return;
		const { override, error } = overrideFrom(draft, provider);
		if (error){
			toasterToast(error, module);
			return;
		}
		setSaving(true);
		try{
			await module.setManualOverride(appId, override);
			reload();
			toasterToast(t("editorSaved"), module);
		}
		finally{
			setSaving(false);
		}
	};

	const restore = async () => {
		setSaving(true);
		try{
			await module.setManualOverride(appId, undefined);
			reload();
			toasterToast(t("editorRestored"), module);
		}
		finally{
			setSaving(false);
		}
	};

	const leave = () => {
		if (!changes.length){
			Navigation.NavigateBack();
			return;
		}
		showModal(
			<ConfirmModal
				strTitle={t("editorDiscardTitle")}
				strDescription={t("editorDiscardBody")}
				strOKButtonText={t("editorDiscard")}
				onOK={() => Navigation.NavigateBack()}/>
		);
	};

	// Search
	const sources = ([
		{ data: "lizardbyte", label: fuzzyProvider(module, "lizardbyte")?.title ?? "LizardByte", valid: !!fuzzyProvider(module, "lizardbyte")?.isValid },
		{ data: "rawg", label: fuzzyProvider(module, "rawg")?.title ?? "RAWG", valid: !!fuzzyProvider(module, "rawg")?.isValid },
		{ data: "ign", label: "IGN", valid: true }
	] as { data: SearchSource; label: string; valid: boolean }[]).filter((source) => source.valid);
	const [searchSource, setSearchSource] = useState<SearchSource>(sources[0]?.data ?? "ign");
	const [query, setQuery] = useState(name);
	const [results, setResults] = useState<SearchResult[] | undefined>(undefined);
	const [selected, setSelected] = useState<{ result: SearchResult; details?: MetadataData } | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	const searchGeneration = useRef(0);

	const search = async () => {
		const generation = ++searchGeneration.current;
		setBusy(true);
		setSelected(undefined);
		try{
			let found: SearchResult[];
			if (searchSource === "ign"){
				found = (await searchIgn(query)).map((r) => ({
					source: "ign", id: r.id, title: r.title, description: snippet(r.description), slug: r.slug
				}));
			}
			else{
				found = (await fuzzyProvider(module, searchSource)?.searchByQuery(query) ?? []).map((entry) => ({
					source: searchSource,
					id: entry.id,
					title: entry.title,
					year: dateToText(entry.release_date).slice(0, 4) || undefined,
					platforms: entry.platforms,
					description: snippet(entry.description),
					entry
				}));
			}
			if (generation !== searchGeneration.current)
				return;
			setResults(found);

			// LizardByte search results only carry a name: fill year and platforms as they arrive
			if (searchSource === "lizardbyte"){
				const lizardbyte = fuzzyProvider(module, "lizardbyte") as unknown as LizardByteGameDBMetadataProvider | undefined;
				for (const result of found){
					void lizardbyte?.getResultSummary(result.id).then((summary) => {
						if (generation !== searchGeneration.current)
							return;
						setResults((current) => current?.map((r) => r.source === result.source && r.id === result.id ? {
							...r,
							year: dateToText(summary.release_date).slice(0, 4) || r.year,
							platforms: summary.platforms?.length ? summary.platforms : r.platforms
						} : r));
					}).catch(() => {});
				}
			}
		}
		catch (e: any){
			module.logger.error("Metadata search failed", e);
			toasterToast(t("editorSearchFailed"), module);
			setResults([]);
		}
		finally{
			setBusy(false);
		}
	};

	const select = async (result: SearchResult) => {
		setBusy(true);
		try{
			const details = result.source === "ign" ?
				await fetchIgn(result.slug!) :
				await fuzzyProvider(module, result.source)?.getResultDetails(appId, result.entry!);
			setSelected({ result, details });
		}
		catch (e: any){
			module.logger.error("Metadata result details failed", e);
			toasterToast(t("editorSearchFailed"), module);
		}
		finally{
			setBusy(false);
		}
	};

	// Fills the fields with the result: nothing is saved until "Save"
	const copyToFields = (details: MetadataData) => {
		const values = draftFrom(details);
		setDraft((current) => ({
			description: values.description || current.description,
			developers: values.developers || current.developers,
			publishers: values.publishers || current.publishers,
			releaseDate: values.releaseDate || current.releaseDate,
			rating: values.rating || current.rating,
			categories: values.categories.length ? values.categories : current.categories
		}));
		toasterToast(t("editorCopied"), module);
	};

	// Makes the result this app's provider data (MetaDeck providers only), as the override settings do
	const applyAsSource = async (result: SearchResult) => {
		if (result.source === "ign")
			return;
		setBusy(true);
		try{
			await fuzzyProvider(module, result.source)?.setOverride(appId, result.id);
			const oldOverrides = module.providerOverrides;
			const newOverrides = { ...oldOverrides, [appId]: result.source } as typeof oldOverrides;
			module.providerOverrides = newOverrides;
			await module.onOverridesChange(oldOverrides, newOverrides);
			await module.fetchDataAsync(appId);
			await module.refreshApp(appId);
			reload();
			toasterToast(t("editorSourceSet"), module);
		}
		catch (e: any){
			module.logger.error("Setting the metadata source failed", e);
			toasterToast(t("editorSearchFailed"), module);
		}
		finally{
			setBusy(false);
		}
	};

	// A field of the Source section, marked when it has manual edits
	const field = (key: Parameters<typeof t>[0], edited: boolean, children: ReactNode) =>
		<div style={edited ? { ...fieldStyle, ...editedFieldStyle } : fieldStyle}>
			<span style={edited ? { ...labelStyle, ...editedLabelStyle } : labelStyle}>
				{t(key)}
				{edited && <span style={editedTagStyle}>{t("editorEdited")}</span>}
			</span>
			{children}
		</div>;
	const isEdited = (key: keyof MetadataManualOverride) => manual?.[key] !== undefined;

	const sourceLabel = providerId ? `${t("editorSource")} · ${providerId}` : `${t("editorSource")} · ${t("editorSourceNone")}`;

	return (
		<ScrollPanel>
			<Focusable
				className={editorRootClassName}
				style={pageStyle}
				onSecondaryButton={() => void save()}
				onSecondaryActionDescription={t("editorSave")}
				onCancelButton={leave}>
				<style>{scopedCss}</style>
				<Focusable className={editorFocusTargetClassName} onActivate={() => {}} style={pageTitleStyle}>
					{`MetaDeck - ${name}`}
				</Focusable>

				{!managed ?
					<PanelSection>
						<PanelSectionRow>
							<div style={compactTextStyle}>{t("editorNotManaged")}</div>
						</PanelSectionRow>
					</PanelSection> :
					<>
						<div style={actionBarStyle}>
							<DialogButton
								className={`${editorFocusTargetClassName} metadeck-editor__action--save`}
								style={actionButtonStyle}
								onClick={save}
								disabled={!changes.length || saving}>
								{changes.length ? `${t("editorSave")} (${changes.length})` : t("editorSave")}
							</DialogButton>
							<DialogButton className={editorFocusTargetClassName} style={actionButtonStyle} onClick={leave}>
								{t("editorDone")}
							</DialogButton>
							<DialogButton className={editorFocusTargetClassName} style={actionButtonStyle} onClick={restore} disabled={saving || !manual}>
								{t("editorRestore")}
							</DialogButton>
						</div>

						<PanelSection title={t("editorSearchSection")}>
							<PanelSectionRow>
								<Dropdown
									rgOptions={sources.map((source) => ({ data: source.data, label: source.label }))}
									selectedOption={searchSource}
									onChange={(option) => {
										setSearchSource(option.data);
										setResults(undefined);
										setSelected(undefined);
									}}/>
							</PanelSectionRow>
							<PanelSectionRow>
								<div style={searchRowStyle}>
									<TextField value={query} onChange={(e) => setQuery(e.target.value)}/>
									<DialogButton style={searchButtonStyle} onClick={search} disabled={busy || !query.trim()}>
										{busy ? t("editorSearching") : t("editorSearchButton")}
									</DialogButton>
								</div>
							</PanelSectionRow>

							{selected?.details &&
								<PanelSectionRow>
									<div style={previewStyle}>
										<div style={{ fontWeight: 700 }}>{selected.result.title}</div>
										<div style={resultDetailStyle}>{resultDetail(selected.result)}</div>
										<div style={compactTextStyle}>
											{[namesToText(selected.details.developers), dateToText(selected.details.release_date),
												selected.details.rating ? `${t("editorRating")} ${Math.round(selected.details.rating)}` : undefined]
												.filter((part) => part).join(" · ")}
										</div>
										<div style={compactTextStyle}>{snippet(selected.details.description, 400)}</div>
										<div style={previewActionsStyle}>
											<DialogButton onClick={() => copyToFields(selected.details!)} disabled={busy}>{t("editorCopyToFields")}</DialogButton>
											{selected.result.source !== "ign" &&
												<DialogButton onClick={() => applyAsSource(selected.result)} disabled={busy}>{t("editorUseAsSource")}</DialogButton>}
										</div>
										{selected.result.source !== "ign" && <div style={compactTextStyle}>{t("editorUseAsSourceDesc")}</div>}
									</div>
								</PanelSectionRow>}

							{results && !results.length &&
								<PanelSectionRow>
									<div style={compactTextStyle}>{t("editorNoResults")}</div>
								</PanelSectionRow>}
							{results?.map((result) =>
								<PanelSectionRow key={`${result.source}-${result.id}`}>
									<DialogButton
										className={`${editorFocusTargetClassName} metadeck-editor__result`}
										style={resultButtonStyle}
										onClick={() => select(result)}
										disabled={busy}>
										<span>{result.title}</span>
										<span style={resultDetailStyle}>{resultDetail(result)}</span>
										{result.description && <span style={resultDetailStyle}>{result.description}</span>}
									</DialogButton>
								</PanelSectionRow>
							)}
						</PanelSection>

						<PanelSection title={sourceLabel}>
							<PanelSectionRow>
								{field("editorDescription", isEdited("description"),
									GamepadTextArea ?
										<GamepadTextArea
											className={editorFocusTargetClassName}
											value={draft.description}
											rows={8}
											style={{ width: "100%", resize: "none", boxSizing: "border-box" }}
											onChange={(e) => update({ description: e.target.value })}/> :
										<TextField value={draft.description} onChange={(e) => update({ description: e.target.value })}/>)}
								{field("editorDevelopers", isEdited("developers"),
									<TextField value={draft.developers} description={t("editorListDesc")} onChange={(e) => update({ developers: e.target.value })}/>)}
								{field("editorPublishers", isEdited("publishers"),
									<TextField value={draft.publishers} description={t("editorListDesc")} onChange={(e) => update({ publishers: e.target.value })}/>)}
								<div style={{ ...fieldStyle, ...twoColumnsStyle }}>
									{field("editorReleaseDate", isEdited("release_date"),
										<TextField value={draft.releaseDate} description={t("editorReleaseDateDesc")} onChange={(e) => update({ releaseDate: e.target.value })}/>)}
									{field("editorRating", isEdited("rating"),
										<TextField value={draft.rating} description={t("editorRatingDesc")} onChange={(e) => update({ rating: e.target.value })}/>)}
								</div>
							</PanelSectionRow>
						</PanelSection>

						<PanelSection title={isEdited("store_categories") ? `${t("editorSteamInfoFields")} · ${t("editorEdited")}` : t("editorSteamInfoFields")}>
							<PanelSectionRow>
								<div className="metadeck-editor__category-grid" style={categoryGridStyle}>
									{EDITABLE_CATEGORIES.map(({ category, label }) =>
										<ToggleField
											key={category}
											highlightOnFocus={false}
											bottomSeparator="none"
											label={t(label)}
											checked={draft.categories.includes(category)}
											onChange={(checked) => update({
												categories: checked ?
													[...draft.categories.filter((c) => c !== category), category] :
													draft.categories.filter((c) => c !== category)
											})}/>
									)}
								</div>
							</PanelSectionRow>
						</PanelSection>
					</>}
			</Focusable>
		</ScrollPanel>
	);
};
