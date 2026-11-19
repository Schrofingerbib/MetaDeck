// Transitional bridge with the Decky Metadata plugin, while both plugins are installed.
// Its Steam-backed features (community, news, controller layouts, trailers) use the Steam app
// stored in its own record of each shortcut, and its editor isn't offered for MetaDeck's games:
// the "Find a Steam Match" section reads and updates that record too.
// Everything here is optional: without Decky Metadata loaded it does nothing.

const PLUGIN = "Decky Metadata";
// Decky Metadata keeps its in-memory records on this global (src/steam/core.ts)
const RUNTIME_KEY = "__deckyMetadataCompatibilityRuntime";

function isLoaded(): boolean {
	try{
		return !!(globalThis as any).DeckyPluginLoader?.deckyState?.publicState?.()?.plugins
			?.some((plugin: any) => plugin?.name === PLUGIN);
	}
	catch{
		return false;
	}
}

function call<T>(method: string, ...args: unknown[]): Promise<T> {
	return (globalThis as any).DeckyBackend.call("loader/call_plugin_method", PLUGIN, method, ...args);
}

const validAppId = (value: unknown): number | undefined => {
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : undefined;
};

/** Steam app matched to a shortcut in Decky Metadata, if any */
export async function getDeckyMetadataSteamMatch(appId: number): Promise<number | undefined> {
	if (!isLoaded())
		return undefined;
	try{
		const cached = (globalThis as any)[RUNTIME_KEY]?.metadataCache?.[String(appId)];
		return validAppId((cached ?? await call<any>("get_metadata", appId))?.steam_appid);
	}
	catch{
		return undefined;
	}
}

/** Updates (or clears, with undefined) the Steam app of a shortcut in Decky Metadata */
export async function setDeckyMetadataSteamMatch(appId: number, steamAppId: number | undefined, title: string): Promise<boolean> {
	if (!isLoaded())
		return false;

	for (let attempt = 0; attempt < 2; attempt++){
		const current = await call<any>("get_metadata", appId);
		if (!current && !steamAppId)
			return true; // Nothing to clear

		const base = current ?? {
			title,
			id: title,
			source: "Manual",
			source_url: "",
			description: "",
			short_description: "",
			developers: [],
			publishers: [],
			rating: null,
			deck_compat_override: null,
			store_categories: [],
			genres: [],
			features: [],
			screenshots: []
		};
		// Steam data fetched for one match must never describe another one (as Decky Metadata does)
		const record: Record<string, unknown> = {
			...base,
			steam_appid: steamAppId ?? null,
			steam_store_name: "",
			steam_store_url: steamAppId ? `https://store.steampowered.com/app/${steamAppId}/` : "",
			deck_compat_category: null,
			steamos_compat_category: null,
			steam_machine_compat_category: null,
			steam_frame_compat_category: null,
			steam_news: [],
			steam_news_enriched_at: 0,
			steam_dlc_appids: [],
			has_points_shop: false
		};
		delete record.steam_store_state;

		// Only commits if the stored record didn't change meanwhile (Decky Metadata writes in background)
		const saved = await call<any>("save_metadata", appId, record, current ?? null);
		if (saved){
			const runtime = (globalThis as any)[RUNTIME_KEY];
			if (runtime?.metadataCache)
				runtime.metadataCache[String(appId)] = saved;
			return true;
		}
	}
	return false;
}
