// Steam-backed features of a shortcut matched to a Steam game ("Find a Steam Match" on the
// "Change Metadata" page): its Community tab and its Activity load the matched game's ones.
//
// The community feed rewrite is the one of Decky Metadata v0.6.4 (src/communityFeedUrl.ts) by beallio:
//   https://github.com/beallio/Decky-Metadata
// Licensed under the GNU General Public License v3.0 or later. See NOTICE.
// Activity differs: instead of building synthetic news events, Steam's own activity store loads the
// matched game, so its real announcements are shown (and open) as for a Steam game.

import { beforePatch, findModuleChild, type Patch } from "@decky/ui";
import type { MetaDeckState } from "./MetaDeckState";
import { SteamAppTypeShortcut } from "./Interfaces";
import Logger from "./logger";

const logger = new Logger("steam_match");

const noPatch = { unpatch(){} } as Patch;

/** The Steam game matched to a shortcut, when it stands in for it */
function matchedApp(state: MetaDeckState, appId: unknown): number | undefined{
	const id = Number(appId);
	if (!Number.isInteger(id) || id <= 0)
		return undefined;
	const metadata = state.modules.metadata;
	if (!metadata?.isValid || metadata.excludedApps.includes(id))
		return undefined;
	if (appStore.GetAppOverviewByAppID(id)?.app_type !== SteamAppTypeShortcut)
		return undefined;
	return metadata.getSteamMatch(id);
}

/** Community tab: Steam loads "library/appcommunityfeed/<appid>", empty for a shortcut */
export function communityFeedPatch(state: MetaDeckState){
	return {
		patch(): Patch{
			const http = findModuleChild((module: any) =>
				typeof module?.g?.get === "function" && typeof module?.g?.post === "function" ? module.g : undefined);
			if (!http){
				logger.error("Steam's HTTP client not found: no community feeds for matched games");
				return noPatch;
			}
			return beforePatch(http, "get", (args) => {
				const url = String(args[0] ?? "");
				const steamAppId = matchedApp(state, url.match(/library\/appcommunityfeed\/(\d+)/)?.[1]);
				if (steamAppId)
					args[0] = url.replace(/appcommunityfeed\/\d+/, `appcommunityfeed/${steamAppId}`);
			});
		}
	};
}

// The activity store's entry points, all taking the app ID first
const ACTIVITY_METHODS = ["GetAppActivity", "RequestRestoreActivity", "FetchLatestActivity", "FetchActivityHistory", "LoadDetailsAndSave"];

/** Activity: Steam's store asks its servers for the app's news and friends' activity, none for a shortcut */
export function activityPatch(state: MetaDeckState){
	return {
		patch(): Patch{
			const store = (window as any).appActivityStore;
			if (!store){
				logger.error("Steam's activity store not found: no activity for matched games");
				return noPatch;
			}
			const patches = ACTIVITY_METHODS
				.filter((name) => typeof store[name] === "function")
				.map((name) => beforePatch(store, name, (args) => {
					const steamAppId = matchedApp(state, args[0]);
					if (steamAppId)
						args[0] = steamAppId;
				}));
			return { unpatch: () => patches.forEach((patch) => patch.unpatch()) } as Patch;
		}
	};
}
