// Steam-backed features of a shortcut matched to a Steam game ("Find a Steam Match" on the
// "Change Metadata" page): its Community tab, its Activity and its controller layouts load the matched game's ones.
//
// The community feed rewrite and the controller layouts follow Decky Metadata v0.6.4
// (src/communityFeedUrl.ts, src/steam/controllerLayouts.ts) by beallio:
//   https://github.com/beallio/Decky-Metadata
// Licensed under the GNU General Public License v3.0 or later. See NOTICE.
// Activity differs: instead of building synthetic news events, Steam's own activity store loads the
// matched game, so its real announcements are shown (and open) as for a Steam game.

import { afterPatch, beforePatch, findModuleChild, type Patch } from "@decky/ui";
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

type ControllerConfig = { URL?: string; bRecommended?: boolean };

/** The configs of the shortcut's list, then the matched game's ones not in it (by URL) */
function addConfigs(base: ControllerConfig[], extra: ControllerConfig[]): ControllerConfig[]{
	const urls = new Set(base.map((config) => config?.URL));
	const added = extra.filter((config) => {
		if (!config?.URL || urls.has(config.URL))
			return false;
		urls.add(config.URL);
		return true;
	});
	return added.length ? [...base, ...added] : base;
}

/** The templates the matched game recommends, recommended in the shortcut's list too (it has the same ones, unmarked) */
function recommendTemplates(base: ControllerConfig[], extra: ControllerConfig[]): ControllerConfig[]{
	const recommended = new Set(extra.filter((config) => config?.bRecommended === true && config.URL).map((config) => config.URL));
	if (!recommended.size)
		return base;
	const marked = base.map((config) => recommended.has(config?.URL) && !config.bRecommended ? { ...config, bRecommended: true } : config);
	return addConfigs(marked, extra.filter((config) => recommended.has(config?.URL)));
}

// The layout chooser's lists, all taking the app ID and the controller type, with what they take from the matched game:
// its official layouts, its recommended templates and its community layouts (Steam has none for a shortcut)
const LAYOUT_LISTS: Record<string, (base: ControllerConfig[], extra: ControllerConfig[]) => ControllerConfig[]> = {
	GetOfficialConfigsForApp: addConfigs,
	GetTemplateConfigsForApp: recommendTemplates,
	GetWorkshopConfigsForApp: addConfigs
};

/**
 * Controller layouts: Steam's servers only know the layouts of Steam games, so when the layout chooser asks for a
 * shortcut's, the matched game's are asked for too and added to its lists. A chosen layout is set on the shortcut.
 */
export function controllerLayoutsPatch(state: MetaDeckState){
	return {
		patch(): Patch{
			const store = (window as any).controllerConfiguratorStore;
			const input = (window as any).SteamClient?.Input;
			const lists = store && Object.getPrototypeOf(store);
			if (!lists || typeof input?.QueryControllerConfigsForApp !== "function" || typeof store.m_mapAppConfigs?.set !== "function"
				|| Object.keys(LAYOUT_LISTS).some((name) => typeof lists[name] !== "function")){
				logger.error("Steam's controller configurator not found: no controller layouts for matched games");
				return noPatch;
			}

			// The answers come back through the store's listener, which files them by app ID
			const query: Patch = afterPatch(input, "QueryControllerConfigsForApp", function(this: unknown, args: any[], ret: unknown){
				const steamAppId = matchedApp(state, args[0]);
				if (steamAppId){
					store.m_mapAppConfigs.set(steamAppId, []); // as Steam does before a query
					query.original.call(this, steamAppId, ...args.slice(1));
				}
				return ret;
			});

			const patches = [query, ...Object.entries(LAYOUT_LISTS).map(([name, merge]) => {
				const list: Patch = afterPatch(lists, name, function(this: unknown, args: any[], ret: any){
					const steamAppId = matchedApp(state, args[0]);
					if (!steamAppId || !Array.isArray(ret))
						return ret;
					const extra = list.original.call(this, steamAppId, ...args.slice(1));
					return Array.isArray(extra) ? merge(ret, extra) : ret;
				});
				return list;
			})];
			return { unpatch: () => patches.forEach((patch) => patch.unpatch()) } as Patch;
		}
	};
}
