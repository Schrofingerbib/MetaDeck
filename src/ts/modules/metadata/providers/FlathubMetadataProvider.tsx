// Software metadata from Flathub (https://flathub.org/api/v2), for apps in "Software" mode.
// Automatic only for Flatpak shortcuts, by their exact app ID ("flatpak run com.moonlight_stream.Moonlight"):
// no guessing by name. Any app can be linked to a Flathub entry by hand on the "Change Metadata" page
// (search, "Use as Source"), which pins its ID like the other providers' ID overrides.

import type { MetadataData } from "../../../Interfaces";
import Logger from "../../../logger";
import { t } from "../../../useTranslations";
import { fetchNoCorsLegacyTimeout, getAppDetails } from "../../../util";
import { getLaunchCommand, isEmulatedGame } from "../../../shortcuts";
import { type FuzzySearchMetadataProviderConfig, type FuzzySearchMetadataProviderCache, FuzzySearchMetadataProvider } from "./FuzzySearchMetadataProvider";
import { SiFlatpak } from "react-icons/si";
import { fetchNoCors } from "@decky/api";

export interface FlathubMetadataProviderConfig extends FuzzySearchMetadataProviderConfig{
}

export interface FlathubMetadataProviderCache extends FuzzySearchMetadataProviderCache{
}

const API = "https://flathub.org/api/v2";

type Appstream = {
	id?: string;
	name?: string;
	summary?: string;
	description?: string; // AppStream markup: <p>, <ul>/<ol>, <li>, <em>, <code>
	developer_name?: string;
	developer?: { name?: string };
};

/** The app ID of a Flatpak shortcut ("flatpak" "run" "--branch=stable" ... "com.app.Id" ...), not for ROMs */
export function getFlatpakAppId(launchCommand: string): string | undefined{
	if (isEmulatedGame(launchCommand)) // RetroDECK and other emulators run as Flatpaks too
		return undefined;
	const tokens = (launchCommand.match(/"[^"]*"|\S+/g) ?? []).map((token) => token.replace(/^"|"$/g, ""));
	const run = tokens.findIndex((token, i) => token === "run" && i > 0 && /(^|\/)flatpak$/.test(tokens[i - 1]));
	if (run < 0)
		return undefined;
	const appId = tokens.slice(run + 1).find((token) => !token.startsWith("-"));
	return appId && /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){2,}$/.test(appId) ? appId : undefined;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/** AppStream markup to plain text: paragraphs separated by a blank line, list items as "- item" */
function appstreamToText(markup?: string): string{
	if (!markup)
		return "";
	return markup
		.replace(/\s+/g, " ")
		.replace(/<li[^>]*>/gi, "\n- ")
		.replace(/<\/(p|ul|ol)>/gi, "\n\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&(#\d+|[a-z]+);/gi, (entity, name: string) =>
			name.startsWith("#") ? String.fromCharCode(Number(name.slice(1))) : ENTITIES[name.toLowerCase()] ?? entity)
		.split("\n").map((line) => line.trim()).join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export class FlathubMetadataProvider extends FuzzySearchMetadataProvider<"flathub">{
	identifier = "flathub" as const;
	title = t("providerMetadataFlathub");

	logger: Logger = new Logger(this.identifier);

	// Flathub's search, for the "Change Metadata" page
	protected async search(title: string): Promise<MetadataData[]>{
		const response = await fetchNoCors(`${API}/search`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "Accept": "application/json" },
			body: JSON.stringify({ query: title })
		});
		if (!response.ok)
			throw Error(`Flathub search failed (${response.status})`);
		const result: { hits?: { app_id: string; name: string; summary?: string; developer_name?: string }[] } = await response.json();
		return (result.hits ?? []).slice(0, 15).map((hit) => ({
			id: hit.app_id,
			title: hit.name,
			description: hit.summary ?? "",
			developers: hit.developer_name ? [{ name: hit.developer_name, url: "" }] : [],
			store_categories: []
		}));
	}

	/** The full Flathub entry of an app ID */
	async getAppstream(appId: string): Promise<MetadataData | undefined>{
		const response = await fetchNoCorsLegacyTimeout(`${API}/appstream/${encodeURIComponent(appId)}`);
		if (response.status === 404)
			return undefined;
		if (!response.ok)
			throw Error(`Flathub entry ${appId} failed (${response.status})`);
		const app: Appstream = await response.json();
		const developer = app.developer_name || app.developer?.name;
		const people = developer ? [{ name: developer, url: "" }] : [];
		return {
			id: appId,
			title: app.name || appId,
			description: appstreamToText(app.description) || app.summary || "",
			// Flathub has no publisher: the developer publishes the app
			developers: people,
			publishers: [...people],
			// Flathub only keeps the latest releases: no release date rather than a wrong one
			store_categories: []
		};
	}

	protected override async getMetadataForGame(appId: number): Promise<MetadataData | undefined>{
		const pinned = this.overrides[appId];
		if (pinned === 0)
			return undefined;
		// Linked by hand to a Flathub entry
		if (pinned !== undefined)
			return this.getAppstream(String(pinned));

		// A Flatpak shortcut: its own entry. Anything else: nothing, no guessing by name
		const details = await getAppDetails(appId);
		const flatpakId = details ? getFlatpakAppId(getLaunchCommand(details)) : undefined;
		return flatpakId ? this.getAppstream(flatpakId) : undefined;
	}

	// Search results only carry the summary: the full entry for the preview
	protected override async enrichMetadataForGame(_appId: number, game: MetadataData): Promise<void>{
		const app = await this.getAppstream(String(game.id));
		if (app)
			Object.assign(game, app);
	}

	override icon = <SiFlatpak/>;
}
