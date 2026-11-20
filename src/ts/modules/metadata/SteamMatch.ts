// Steam store search and preview, for the "Find a Steam Match" section of the
// "Change Metadata" page. Same store endpoints as Decky Metadata v0.6.4
// (backend-rust/src/providers/steam.rs) by beallio:
//   https://github.com/beallio/Decky-Metadata
// Licensed under the GNU General Public License v3.0 or later. See NOTICE.

import { fetchNoCorsLegacyTimeout } from "../../util";

export interface SteamMatchCandidate {
	appid: number;
	title: string;
	image?: string;
}

export interface SteamMatchPreview {
	appid: number;
	title: string;
	type?: string; // "game", "dlc", "demo"...
	developers: string[];
	release?: string; // As shown by the store
	image?: string;
	description?: string;
}

export async function searchSteamStore(query: string, limit = 8): Promise<SteamMatchCandidate[]> {
	const term = query.trim();
	if (!term)
		return [];

	const response = await fetchNoCorsLegacyTimeout("https://store.steampowered.com/api/storesearch/?" +
		new URLSearchParams({ term, cc: "US", l: "english" }).toString());
	if (!response.ok)
		throw new Error(`${response.status}`);

	const payload: { items?: { id?: number; name?: string; tiny_image?: string }[] } = JSON.parse(await response.text());
	const seen = new Set<number>();
	const candidates: SteamMatchCandidate[] = [];
	for (const item of payload.items ?? []){
		const appid = Number(item.id);
		if (!Number.isInteger(appid) || appid <= 0 || !item.name || seen.has(appid))
			continue;
		seen.add(appid);
		candidates.push({ appid, title: item.name.trim(), image: item.tiny_image });
		if (candidates.length >= limit)
			break;
	}
	return candidates;
}

export async function getSteamMatchPreview(appid: number): Promise<SteamMatchPreview | undefined> {
	const response = await fetchNoCorsLegacyTimeout("https://store.steampowered.com/api/appdetails?" +
		new URLSearchParams({ appids: String(appid), cc: "US", l: "english" }).toString());
	if (!response.ok)
		throw new Error(`${response.status}`);

	const payload = JSON.parse(await response.text());
	const entry = payload?.[String(appid)];
	if (!entry?.success || !entry.data)
		return undefined;

	const data = entry.data;
	return {
		appid,
		title: String(data.name ?? appid),
		type: data.type,
		developers: Array.isArray(data.developers) ? data.developers : [],
		release: data.release_date?.date || undefined,
		image: data.header_image,
		description: data.short_description
	};
}

/** Accepts a Steam App ID, or a Store, Community or SteamDB app URL */
export function parseSteamAppId(text: string): number | undefined {
	const value = text.trim();
	if (!value)
		return undefined;
	const match = /^\d+$/.test(value) ? value : value.match(/\/app(?:s)?\/(\d+)/i)?.[1];
	const appid = match ? Number(match) : NaN;
	return Number.isInteger(appid) && appid > 0 ? appid : undefined;
}

const storeGone = new Map<number, Promise<boolean>>();

/**
 * Whether Steam's store no longer has a page for an app (delisted, or no such app): only when Steam says so,
 * never because of a network error. Its community, activity and controller layouts may still exist.
 */
export function isSteamStoreGone(appid: number): Promise<boolean> {
	let gone = storeGone.get(appid);
	if (!gone){
		gone = (async () => {
			const response = await fetchNoCorsLegacyTimeout(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`);
			if (!response.ok)
				throw new Error(`${response.status}`);
			return JSON.parse(await response.text())?.[String(appid)]?.success === false;
		})();
		storeGone.set(appid, gone);
		gone.catch(() => storeGone.delete(appid)); // Asked again next time
	}
	return gone.catch(() => false);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/** An app's name from its Steam Community hub, which stays when the store page goes; undefined for no such app */
export async function getSteamCommunityName(appid: number): Promise<string | undefined> {
	const response = await fetchNoCorsLegacyTimeout(`https://steamcommunity.com/app/${appid}`);
	if (!response.ok)
		return undefined;
	// No such app: Steam redirects to the store's home ("Welcome to Steam")
	const title = (await response.text()).match(/<title>\s*Steam Community\s*::\s*([^<]+?)\s*<\/title>/i)?.[1];
	return title?.replace(/&(#\d+|[a-z]+);/gi, (entity, name: string) =>
		name.startsWith("#") ? String.fromCharCode(Number(name.slice(1))) : ENTITIES[name.toLowerCase()] ?? entity);
}
