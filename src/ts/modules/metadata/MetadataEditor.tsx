import { FC, useMemo, useState } from "react";
import {
	DialogBody,
	DialogButton,
	DialogControlsSection,
	DialogControlsSectionHeader,
	Dropdown,
	Field,
	Focusable,
	SidebarNavigation,
	TextField,
	ToggleField,
	useParams
} from "@decky/ui";
import { FaListCheck, FaMagnifyingGlass, FaRegFileLines } from "react-icons/fa6";
import { useMetaDeckState } from "../../MetaDeckState";
import { t } from "../../useTranslations";
import { toasterToast } from "../../util";
import { getGamepadTextArea } from "../../gamepadTextArea";
import { SteamAppTypeShortcut, StoreCategory, type ID, type MetadataData } from "../../Interfaces";
import type { MetadataManualOverride, MetadataModule } from "./MetadataModule";
import type { FuzzySearchMetadataProvider } from "./providers/FuzzySearchMetadataProvider";
import { fetchIgn, searchIgn } from "./IgnSearch";

// Sources offered by the Search tab: LizardByte first (best for emulated games)
type SearchSource = "lizardbyte" | "rawg" | "ign";

type SearchResult = {
	source: SearchSource;
	id: ID;
	title: string;
	snippet: string;
	entry?: MetadataData; // MetaDeck providers
	slug?: string; // IGN
};

function fuzzyProvider(module: MetadataModule, source: "lizardbyte" | "rawg"): FuzzySearchMetadataProvider<"lizardbyte" | "rawg"> | undefined {
	return module.providers.find((provider) => provider.identifier === source) as FuzzySearchMetadataProvider<"lizardbyte" | "rawg"> | undefined;
}

const snippet = (text?: string, length = 160) =>
	!text ? "" : text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;

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

export const MetadataEditor: FC = () => {
	const state = useMetaDeckState();
	const module = state.modules.metadata;
	const { appid } = useParams<{ appid: string }>();
	const appId = Number(appid);
	const overview = appStore.GetAppOverviewByAppID(appId);

	const GamepadTextArea = useMemo(() => getGamepadTextArea(), []);
	const [draft, setDraft] = useState<Draft>(() => draftFrom(module.fetchData(appId)));
	const [manual, setManual] = useState(() => module.getManualOverride(appId));
	const [saving, setSaving] = useState(false);

	const provider = module.getProviderData(appId);
	const providerId = module.dataProviders[appId];
	const managed = overview?.app_type === SteamAppTypeShortcut && !module.excludedApps.includes(appId);

	// Search tab
	const sources = ([
		{ data: "lizardbyte", label: fuzzyProvider(module, "lizardbyte")?.title ?? "LizardByte", valid: !!fuzzyProvider(module, "lizardbyte")?.isValid },
		{ data: "rawg", label: fuzzyProvider(module, "rawg")?.title ?? "RAWG", valid: !!fuzzyProvider(module, "rawg")?.isValid },
		{ data: "ign", label: "IGN", valid: true }
	] as { data: SearchSource; label: string; valid: boolean }[]).filter((source) => source.valid);
	const [searchSource, setSearchSource] = useState<SearchSource>(sources[0]?.data ?? "ign");
	const [query, setQuery] = useState(overview?.display_name ?? "");
	const [results, setResults] = useState<SearchResult[] | undefined>(undefined);
	const [selected, setSelected] = useState<{ result: SearchResult; details?: MetadataData } | undefined>(undefined);
	const [busy, setBusy] = useState(false);

	const search = async () => {
		setBusy(true);
		setSelected(undefined);
		try{
			if (searchSource === "ign"){
				const found = await searchIgn(query);
				setResults(found.map((r) => ({ source: "ign", id: r.id, title: r.title, snippet: snippet(r.description), slug: r.slug })));
			}
			else{
				const found = await fuzzyProvider(module, searchSource)?.searchByQuery(query) ?? [];
				setResults(found.map((entry) => ({ source: searchSource, id: entry.id, title: entry.title, snippet: snippet(entry.description), entry })));
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

	// Fills the Details fields with the result: nothing is saved until "Save"
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
			setDraft(draftFrom(module.fetchData(appId)));
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

	const update = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));
	const edited = (field: keyof MetadataManualOverride) => manual?.[field] !== undefined;
	const label = (key: Parameters<typeof t>[0], field: keyof MetadataManualOverride) =>
		edited(field) ? `${t(key)} · ${t("editorEdited")}` : t(key);

	const save = async () => {
		const { override, error } = overrideFrom(draft, provider);
		if (error){
			toasterToast(error, module);
			return;
		}
		setSaving(true);
		try{
			await module.setManualOverride(appId, override);
			setManual(module.getManualOverride(appId));
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
			setManual(undefined);
			setDraft(draftFrom(module.fetchData(appId)));
			toasterToast(t("editorRestored"), module);
		}
		finally{
			setSaving(false);
		}
	};

	const actions = (
		<DialogControlsSection>
			<Focusable style={{ display: "flex", gap: "1em", marginTop: "1em" }} flow-children="horizontal">
				<DialogButton onClick={save} disabled={saving}>{t("editorSave")}</DialogButton>
				<DialogButton onClick={restore} disabled={saving || !manual}>{t("editorRestore")}</DialogButton>
			</Focusable>
		</DialogControlsSection>
	);

	if (!managed){
		return (
			<SidebarNavigation title={overview?.display_name ?? t("changeMetadata")} pages={[{
				title: t("editorDetails"),
				icon: <FaRegFileLines/>,
				content: <DialogBody><DialogControlsSection><Field label={t("editorNotManaged")} focusable={true}/></DialogControlsSection></DialogBody>
			}]}/>
		);
	}

	const source = providerId ? `${t("editorSource")}: ${providerId}` : t("editorSourceNone");

	return (
		<SidebarNavigation title={overview.display_name} pages={[
			{
				title: t("editorDetails"),
				icon: <FaRegFileLines/>,
				content: (
					<DialogBody>
						<DialogControlsSection>
							<DialogControlsSectionHeader>{source}</DialogControlsSectionHeader>
							<Field label={label("editorDescription", "description")} childrenLayout="below" focusable={!GamepadTextArea}>
								{GamepadTextArea ?
									<GamepadTextArea
										value={draft.description}
										rows={8}
										style={{ width: "100%", resize: "none", boxSizing: "border-box" }}
										onChange={(e) => update({ description: e.target.value })}/> :
									<TextField
										value={draft.description}
										onChange={(e) => update({ description: e.target.value })}/>}
							</Field>
							<Field label={label("editorDevelopers", "developers")} description={t("editorListDesc")} childrenLayout="below">
								<TextField value={draft.developers} onChange={(e) => update({ developers: e.target.value })}/>
							</Field>
							<Field label={label("editorPublishers", "publishers")} description={t("editorListDesc")} childrenLayout="below">
								<TextField value={draft.publishers} onChange={(e) => update({ publishers: e.target.value })}/>
							</Field>
							<Field label={label("editorReleaseDate", "release_date")} description={t("editorReleaseDateDesc")} childrenLayout="below">
								<TextField value={draft.releaseDate} onChange={(e) => update({ releaseDate: e.target.value })}/>
							</Field>
							<Field label={label("editorRating", "rating")} description={t("editorRatingDesc")} childrenLayout="below">
								<TextField value={draft.rating} onChange={(e) => update({ rating: e.target.value })}/>
							</Field>
						</DialogControlsSection>
						{actions}
					</DialogBody>
				)
			},
			{
				title: t("editorSearch"),
				icon: <FaMagnifyingGlass/>,
				content: (
					<DialogBody>
						<DialogControlsSection>
							<Field label={t("editorSearchProvider")} childrenLayout="below">
								<Dropdown
									rgOptions={sources.map((source) => ({ data: source.data, label: source.label }))}
									selectedOption={searchSource}
									onChange={(option) => {
										setSearchSource(option.data);
										setResults(undefined);
										setSelected(undefined);
									}}/>
							</Field>
							<Field label={t("editorSearchQuery")} childrenLayout="below">
								<TextField value={query} onChange={(e) => setQuery(e.target.value)}/>
							</Field>
							<Field>
								<DialogButton onClick={search} disabled={busy || !query.trim()}>
									{busy ? t("editorSearching") : t("editorSearchButton")}
								</DialogButton>
							</Field>
						</DialogControlsSection>

						{selected?.details &&
							<DialogControlsSection>
								<DialogControlsSectionHeader>{selected.result.title}</DialogControlsSectionHeader>
								<Field label={t("editorDescription")} description={snippet(selected.details.description, 400) || "—"} focusable={true}/>
								<Field label={t("editorDevelopers")} description={namesToText(selected.details.developers) || "—"}/>
								<Field label={t("editorPublishers")} description={namesToText(selected.details.publishers) || "—"}/>
								<Field label={t("editorReleaseDate")} description={dateToText(selected.details.release_date) || "—"}/>
								<Field label={t("editorRating")} description={selected.details.rating ? String(Math.round(selected.details.rating)) : "—"}/>
								<Focusable style={{ display: "flex", gap: "1em", marginTop: "1em" }} flow-children="horizontal">
									<DialogButton onClick={() => copyToFields(selected.details!)} disabled={busy}>{t("editorCopyToFields")}</DialogButton>
									{selected.result.source !== "ign" &&
										<DialogButton onClick={() => applyAsSource(selected.result)} disabled={busy}>{t("editorUseAsSource")}</DialogButton>}
								</Focusable>
								{selected.result.source !== "ign" && <Field description={t("editorUseAsSourceDesc")}/>}
							</DialogControlsSection>}

						{results &&
							<DialogControlsSection>
								<DialogControlsSectionHeader>{t("editorResults")}</DialogControlsSectionHeader>
								{!results.length && <Field label={t("editorNoResults")} focusable={true}/>}
								{results.map((result) =>
									<Field key={`${result.source}-${result.id}`} label={result.title} description={result.snippet} childrenContainerWidth="min">
										<DialogButton onClick={() => select(result)} disabled={busy}>{t("editorSelect")}</DialogButton>
									</Field>
								)}
							</DialogControlsSection>}
					</DialogBody>
				)
			},
			{
				title: t("editorSteamInfoFields"),
				icon: <FaListCheck/>,
				content: (
					<DialogBody>
						<DialogControlsSection>
							<DialogControlsSectionHeader>
								{edited("store_categories") ? `${t("editorSteamInfoFields")} · ${t("editorEdited")}` : t("editorSteamInfoFields")}
							</DialogControlsSectionHeader>
							{EDITABLE_CATEGORIES.map(({ category, label: categoryLabel }) =>
								<ToggleField
									key={category}
									label={t(categoryLabel)}
									checked={draft.categories.includes(category)}
									onChange={(checked) => update({
										categories: checked ?
											[...draft.categories.filter((c) => c !== category), category] :
											draft.categories.filter((c) => c !== category)
									})}/>
							)}
						</DialogControlsSection>
						{actions}
					</DialogBody>
				)
			}
		]}/>
	);
};
