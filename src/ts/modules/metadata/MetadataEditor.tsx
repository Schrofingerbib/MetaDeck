import React, { FC, ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
import { getSteamMatchPreview, parseSteamAppId, searchSteamStore, type SteamMatchCandidate, type SteamMatchPreview } from "./SteamMatch";
import { getDeckyMetadataSteamMatch, setDeckyMetadataSteamMatch } from "./DeckyMetadataBridge";
import type { SteamMetadataProvider } from "./providers/SteamMetadataProvider";
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
	steamAppId: string; // Steam match: ID or URL, empty for none
};

const namesToText = (people?: { name: string }[]) => (people ?? []).map((p) => p.name).join(", ");
const textToNames = (text: string) => text.split(",").map((name) => name.trim()).filter((name) => name.length);
const dateToText = (seconds?: number) => seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : "";
const sameList = (a: (string | number)[], b: (string | number)[]) =>
	a.length === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);
const snippet = (text?: string, length = 160) =>
	!text ? "" : text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;

type FuzzySource = "lizardbyte" | "rawg" | "steam";

function fuzzyProvider(module: MetadataModule, source: FuzzySource): FuzzySearchMetadataProvider<FuzzySource> | undefined {
	return module.providers.find((provider) => provider.identifier === source) as FuzzySearchMetadataProvider<FuzzySource> | undefined;
}

const steamImageStyle = {
	width: 120,
	height: 45,
	flexShrink: 0,
	objectFit: "cover",
	borderRadius: 4
} as const;

function draftFrom(data?: MetadataData, steamAppId?: number): Draft {
	return {
		description: data?.description ?? "",
		developers: namesToText(data?.developers),
		publishers: namesToText(data?.publishers),
		releaseDate: dateToText(data?.release_date),
		rating: data?.rating != null && data.rating > 0 ? String(Math.round(data.rating)) : "",
		categories: (data?.store_categories ?? []).filter((c): c is StoreCategory =>
			typeof c === "number" && EDITABLE_CATEGORY_IDS.has(c)),
		steamAppId: steamAppId ? String(steamAppId) : ""
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

/**
 * Manual edits to save: the existing ones, updated with the fields changed on the page.
 * A changed field equal to the provider data needs no manual edit.
 */
function overrideFrom(draft: Draft, saved: Draft, provider: MetadataData | undefined, existing: MetadataManualOverride | undefined):
	{ override?: MetadataManualOverride; error?: string } {

	const override: MetadataManualOverride = { ...(existing ?? {}) };
	const base = draftFrom(provider);
	const changed = changedFields(draft, saved);
	const set = <K extends keyof MetadataManualOverride>(key: K, value: MetadataManualOverride[K], sameAsProvider: boolean) => {
		if (sameAsProvider)
			delete override[key];
		else
			override[key] = value;
	};

	if (changed.includes("description"))
		set("description", draft.description.trim(), draft.description.trim() === base.description.trim());

	if (changed.includes("developers")){
		const developers = textToNames(draft.developers);
		set("developers", developers.map((name) => ({ name, url: "" })), sameList(developers, textToNames(base.developers)));
	}

	if (changed.includes("publishers")){
		const publishers = textToNames(draft.publishers);
		set("publishers", publishers.map((name) => ({ name, url: "" })), sameList(publishers, textToNames(base.publishers)));
	}

	if (changed.includes("releaseDate")){
		const date = draft.releaseDate.trim();
		if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
			return { error: t("editorInvalidDate") };
		const time = date ? Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) : 0;
		if (date && Number.isNaN(time))
			return { error: t("editorInvalidDate") };
		// 0 clears the provider's date
		set("release_date", Math.floor(time / 1000), date === base.releaseDate);
	}

	if (changed.includes("rating")){
		const rating = draft.rating.trim();
		const value = rating ? Number(rating) : 0;
		if (!Number.isFinite(value) || value < 0 || value > 100)
			return { error: t("editorInvalidRating") };
		// 0 clears the provider's rating
		set("rating", value, rating === base.rating);
	}

	if (changed.includes("categories")){
		// Keep the categories that can't be edited here (shortcut-derived, custom...)
		const kept = (provider?.store_categories ?? []).filter((c) => typeof c !== "number" || !EDITABLE_CATEGORY_IDS.has(c));
		set("store_categories", [...kept, ...draft.categories], sameList(draft.categories, base.categories));
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
	const [saved, setSaved] = useState<Draft>(() => draftFrom(module.fetchData(appId), module.getSteamMatch(appId)));
	const [draft, setDraft] = useState<Draft>(saved);

	// Without a MetaDeck Steam match yet, start from the one Decky Metadata has (it drives its community, news...)
	useEffect(() => {
		if (module.getSteamMatch(appId))
			return;
		void getDeckyMetadataSteamMatch(appId).then((steamAppId) => {
			if (!steamAppId)
				return;
			setSaved((current) => ({ ...current, steamAppId: String(steamAppId) }));
			setDraft((current) => current.steamAppId ? current : { ...current, steamAppId: String(steamAppId) });
		});
	}, [appId]);
	const [manual, setManual] = useState(() => module.getManualOverride(appId));
	const [saving, setSaving] = useState(false);

	const managed = overview?.app_type === SteamAppTypeShortcut && !module.excludedApps.includes(appId);
	const provider = module.getProviderData(appId);
	const providerId = module.dataProviders[appId];
	const changes = changedFields(draft, saved);

	const update = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));
	const reload = () => {
		const current = draftFrom(module.fetchData(appId), module.getSteamMatch(appId));
		setSaved(current);
		setDraft(current);
		setManual(module.getManualOverride(appId));
	};

	const save = async () => {
		if (!changes.length || saving)
			return;
		const { override, error } = overrideFrom(draft, saved, provider, manual);
		if (error){
			toasterToast(error, module);
			return;
		}
		const steamChanged = changes.includes("steamAppId");
		const steamAppId = parseSteamAppId(draft.steamAppId);
		if (steamChanged && draft.steamAppId.trim() && !steamAppId){
			toasterToast(t("editorInvalidSteamAppId"), module);
			return;
		}
		setSaving(true);
		try{
			if (changes.some((change) => change !== "steamAppId"))
				await module.setManualOverride(appId, override);
			if (steamChanged){
				await module.setSteamMatch(appId, steamAppId);
				// Decky Metadata's community, news, layouts and trailers follow the same match
				await setDeckyMetadataSteamMatch(appId, steamAppId, name).catch((e) =>
					module.logger.error("Decky Metadata Steam match update failed", e));
				// The Steam match becomes the source of the game's metadata (manual edits stay on top);
				// removing it goes back to the automatic provider if Steam was the source
				await switchSource(steamAppId ? "steam" : undefined, steamAppId, "steam");
			}
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
			...current,
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
	const applyAsSource = (result: SearchResult) =>
		result.source === "ign" ? Promise.resolve() : setProviderSource(result.source, result.id);

	/**
	 * Makes a provider result the provider data of this app, as the override settings do.
	 * Without a source, goes back to the automatic provider, only when the current source is `whenCurrent`.
	 */
	const switchSource = async (source: FuzzySource | undefined, id?: ID, whenCurrent?: FuzzySource) => {
		const oldOverrides = module.providerOverrides;
		const newOverrides: Record<number, string> = { ...oldOverrides };
		if (source){
			await fuzzyProvider(module, source)?.setOverride(appId, id);
			newOverrides[appId] = source;
		}
		else{
			if (!whenCurrent || newOverrides[appId] !== whenCurrent)
				return;
			await fuzzyProvider(module, whenCurrent)?.setOverride(appId, undefined);
			delete newOverrides[appId];
		}
		module.providerOverrides = newOverrides as typeof oldOverrides;
		await module.onOverridesChange(oldOverrides, newOverrides as typeof oldOverrides);
		await module.fetchDataAsync(appId);
		await module.refreshApp(appId);
	};

	const setProviderSource = async (source: FuzzySource, id: ID) => {
		setBusy(true);
		try{
			await switchSource(source, id);
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

	// Find a Steam match
	const [steamQuery, setSteamQuery] = useState(name);
	const [steamCandidates, setSteamCandidates] = useState<SteamMatchCandidate[] | undefined>(undefined);
	const [steamSelected, setSteamSelected] = useState<{ candidate: SteamMatchCandidate; preview?: SteamMatchPreview } | undefined>(undefined);

	const searchSteam = async () => {
		setBusy(true);
		setSteamSelected(undefined);
		try{
			setSteamCandidates(await searchSteamStore(steamQuery));
		}
		catch (e: any){
			module.logger.error("Steam search failed", e);
			toasterToast(t("editorSearchFailed"), module);
			setSteamCandidates([]);
		}
		finally{
			setBusy(false);
		}
	};

	const selectSteam = async (candidate: SteamMatchCandidate) => {
		setBusy(true);
		setSteamSelected({ candidate });
		try{
			setSteamSelected({ candidate, preview: await getSteamMatchPreview(candidate.appid) });
		}
		catch (e: any){
			module.logger.error("Steam preview failed", e);
			toasterToast(t("editorSearchFailed"), module);
		}
		finally{
			setBusy(false);
		}
	};

	const copySteamDetails = async (steamAppId: number) => {
		setBusy(true);
		try{
			const steam = fuzzyProvider(module, "steam") as unknown as SteamMetadataProvider | undefined;
			const details = await steam?.getAppMetadata(steamAppId);
			if (details)
				copyToFields(details);
		}
		catch (e: any){
			module.logger.error("Steam details failed", e);
			toasterToast(t("editorSearchFailed"), module);
		}
		finally{
			setBusy(false);
		}
	};

	const steamAppIdLabel = (steamAppId: number) => [
		`${t("editorSteamAppId")}: ${steamAppId}`,
		String(steamAppId) === saved.steamAppId.trim() ? t("editorSteamCurrent") : undefined,
		String(steamAppId) === draft.steamAppId.trim() && draft.steamAppId.trim() !== saved.steamAppId.trim() ? t("editorSteamSelected") : undefined
	].filter((part) => part).join(" · ");

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

						<PanelSection title={t("editorSteamMatch")}>
							<PanelSectionRow>
								<div style={compactTextStyle}>{t("editorSteamMatchHelp")}</div>
							</PanelSectionRow>
							<PanelSectionRow>
								<div style={searchRowStyle}>
									<TextField value={steamQuery} onChange={(e) => setSteamQuery(e.target.value)}/>
									<DialogButton style={searchButtonStyle} onClick={searchSteam} disabled={busy || !steamQuery.trim()}>
										{busy ? t("editorSearching") : t("editorSteamSearch")}
									</DialogButton>
								</div>
							</PanelSectionRow>
							{steamCandidates && !steamCandidates.length &&
								<PanelSectionRow>
									<div style={compactTextStyle}>{t("editorSteamNoResults")}</div>
								</PanelSectionRow>}
							{steamCandidates?.map((candidate) =>
								<PanelSectionRow key={candidate.appid}>
									<DialogButton
										className={`${editorFocusTargetClassName} metadeck-editor__result`}
										style={{ ...resultButtonStyle, flexDirection: "row", alignItems: "center", gap: 12 }}
										onClick={() => selectSteam(candidate)}
										disabled={busy}>
										{candidate.image && <img src={candidate.image} style={steamImageStyle}/>}
										<span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
											<span>{candidate.title}</span>
											<span style={resultDetailStyle}>{steamAppIdLabel(candidate.appid)}</span>
										</span>
									</DialogButton>
									{steamSelected?.candidate.appid === candidate.appid && steamSelected.preview &&
										<div style={{ ...previewStyle, marginTop: 8 }}>
											{steamSelected.preview.image &&
												<img src={steamSelected.preview.image} style={{ width: "100%", maxWidth: 460, borderRadius: 4 }}/>}
											<div style={{ fontWeight: 700 }}>{steamSelected.preview.title}</div>
											<div style={compactTextStyle}>
												{[steamSelected.preview.developers.join(", "), steamSelected.preview.release].filter((part) => part).join(" · ")}
											</div>
											{steamSelected.preview.type && steamSelected.preview.type !== "game" &&
												<div style={{ color: "#f59e0b" }}>{t("editorSteamType").replace("{type}", steamSelected.preview.type)}</div>}
											<div style={compactTextStyle}>{snippet(steamSelected.preview.description, 300)}</div>
											<div style={previewActionsStyle}>
												<DialogButton
													onClick={() => {
														update({ steamAppId: String(candidate.appid) });
														toasterToast(t("editorSteamMatchSet"), module);
													}}
													disabled={busy}>
													{t("editorSteamUseMatch")}
												</DialogButton>
												<DialogButton onClick={() => copySteamDetails(candidate.appid)} disabled={busy}>{t("editorCopyToFields")}</DialogButton>
											</div>
										</div>}
								</PanelSectionRow>
							)}
							<PanelSectionRow>
								{field("editorSteamAppId", false,
									<TextField value={draft.steamAppId} description={t("editorSteamAppIdDesc")} onChange={(e) => update({ steamAppId: e.target.value })}/>)}
							</PanelSectionRow>
						</PanelSection>

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
