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
