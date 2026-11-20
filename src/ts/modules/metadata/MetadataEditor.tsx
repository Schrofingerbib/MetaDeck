import { FC, useMemo, useState } from "react";
import {
	DialogBody,
	DialogButton,
	DialogControlsSection,
	DialogControlsSectionHeader,
	Field,
	Focusable,
	SidebarNavigation,
	TextField,
	ToggleField,
	useParams
} from "@decky/ui";
import { FaListCheck, FaRegFileLines } from "react-icons/fa6";
import { useMetaDeckState } from "../../MetaDeckState";
import { t } from "../../useTranslations";
import { toasterToast } from "../../util";
import { getGamepadTextArea } from "../../gamepadTextArea";
import { SteamAppTypeShortcut, StoreCategory, type MetadataData } from "../../Interfaces";
import type { MetadataManualOverride } from "./MetadataModule";

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
