import {Module, ModuleCache, ModuleConfig} from "../Module";
import {MetadataProvider} from "./MetadataProvider";
import {CustomStoreCategory, MetadataData, SteamAppTypeShortcut, StoreCategory} from "../../Interfaces";
import {truncate} from "lodash-es";
import {
	GOGMetadataProvider,
	GOGMetadataProviderCache,
	GOGMetadataProviderConfig
} from "./providers/GOGMetadataProvider";
import {Mounts} from "../../System";
import {
	afterPatch,
	beforePatch,
	callOriginal,
	DialogControlsSection,
	Field,
	findInReactTree,
	findModuleExport,
	Patch,
	replacePatch,
	Router,
	Toggle
} from "@decky/ui";
import {t} from "../../useTranslations";
import {getAppDetails, stateTransaction} from "../../util";
import {ReactElement, ReactNode, useState} from "react";
import {Markdown} from "../../markdown";
import {SteamAppDetails, SteamAppOverview} from "../../SteamTypes";
import {routePatch} from "../../RoutePatches";
import Logger from "../../logger";
import {
	getLaunchCommand,
	getShortcutCategories
} from "../../shortcuts";
import {CustomFeature} from "./CustomFeature";
import { SteamMetadataProvider, type SteamMetadataProviderCache, type SteamMetadataProviderConfig } from "./providers/SteamMetadataProvider";
import { RAWGMetadataProvider, type RAWGMetadataProviderCache, type RAWGMetadataProviderConfig } from "./providers/RAWGMetadataProvider";
import { useMetaDeckState } from "../../MetaDeckState";
import React from "react";
import { GameTDBMetadataProvider, type GameTDBMetadataProviderCache, type GameTDBMetadataProviderConfig } from "./providers/GameTDBMetadataProvider";
import { LizardByteGameDBMetadataProvider, LizardByteGameDBMetadataProviderCache, LizardByteGameDBMetadataProviderConfig } from "./providers/LizardByteGameDBMetadataProvider";
import { FlathubMetadataProvider, getFlatpakAppId, type FlathubMetadataProviderCache, type FlathubMetadataProviderConfig } from "./providers/FlathubMetadataProvider";
import { FaRegFileLines } from "react-icons/fa6";
import { RetroAchievementsMetadataProvider, type RetroAchievementsMetadataProviderCache, type RetroAchievementsMetadataProviderConfig } from "./providers/RetroAchievementsMetadataProvider";
import { TitleDbMetadataProvider, type TitleDbMetadataProviderCache, type TitleDbMetadataProviderConfig } from "./providers/TitleDbMetadataProvider";
import type { ProviderIdentifier } from "../Provider";
import { isSteamStoreGone } from "./SteamMatch";
import { DBoxMetadataProvider, type DBoxMetadataProviderCache, type DBoxMetadataProviderConfig } from "./providers/DBoxMetadataProvider";

/** Whether the library page of this app is shown: /library/app/:appid, /library/details/:appid, /library/:collection/app/:appid */
function isGameDetailRouteOf(appId: number): boolean{
	// @ts-ignore
	const path: string | undefined = Router?.WindowStore?.GamepadUIMainWindowInstance?.m_history?.location?.pathname;
	const match = path?.match(/^\/library(?:\/[^/]+)?\/(?:app|details)\/(\d+)(?:\/|$)/);
	return !!match && Number(match[1]) === appId;
}

// Fields that can be edited by hand on the "Change Metadata" page
export type MetadataManualOverride = Partial<Pick<MetadataData,
	"description" | "developers" | "publishers" | "release_date" | "rating" | "store_categories">>;

export interface MetadataConfig extends ModuleConfig<MetadataProviderConfigs>{
	type_override: boolean,
	descriptions: boolean,
	release_date: boolean,
	associations: boolean,
	categories: boolean,
	markdown: boolean,
	title_header: boolean,
	rating: boolean,
	install_size: boolean,
	install_date: boolean,
	// Manual edits, applied field by field over the provider data.
	// Kept in the config so they survive cache clears and provider changes.
	manual_overrides: Record<number, MetadataManualOverride>,
	// Steam app matched by hand to a shortcut ("Find a Steam Match"), for Steam-backed features
	// (community, news...). Independent from the metadata provider.
	steam_matches: Record<number, number>,
	// Software (apps, tools): Flathub and manual edits only, no game providers, compatibility or achievements.
	// Set by hand, or detected for new Flatpak shortcuts from their Flathub categories
	software_apps?: number[],
	// Marked as games by hand: never detected as software
	game_apps?: number[]
}

export interface MetadataCache extends ModuleCache<MetadataProviderCaches, MetadataData>{
	// Software apps for which the software providers found nothing (checked once, until the cache is cleared)
	software_without_source?: number[],
	// New shortcuts already checked for software
	software_checked?: number[]
}

export interface MetadataProviderConfigs{
	gog: GOGMetadataProviderConfig;
	steam: SteamMetadataProviderConfig;
	rawg: RAWGMetadataProviderConfig;
	gametdb: GameTDBMetadataProviderConfig;
	lizardbyte: LizardByteGameDBMetadataProviderConfig;
	flathub: FlathubMetadataProviderConfig;
	ra: RetroAchievementsMetadataProviderConfig;
	titledb: TitleDbMetadataProviderConfig;
	dbox: DBoxMetadataProviderConfig;
}

export interface MetadataProviderCaches{
	gog: GOGMetadataProviderCache;
	steam: SteamMetadataProviderCache;
	rawg: RAWGMetadataProviderCache;
	gametdb: GameTDBMetadataProviderCache;
	lizardbyte: LizardByteGameDBMetadataProviderCache;
	flathub: FlathubMetadataProviderCache;
	ra: RetroAchievementsMetadataProviderCache;
	titledb: TitleDbMetadataProviderCache;
	dbox: DBoxMetadataProviderCache;
}

export class MetadataModule extends Module<"metadata", MetadataProvider<any>>{
	identifier = "metadata" as const;
	title = t("moduleMetadata");

	logger = new Logger(this.identifier);

	providers: MetadataProvider<any>[] = [
		new DBoxMetadataProvider(this),
		new TitleDbMetadataProvider(this),
		new GameTDBMetadataProvider(this),
		new GOGMetadataProvider(this),
		new SteamMetadataProvider(this),
		new LizardByteGameDBMetadataProvider(this),
		new RAWGMetadataProvider(this),
		new RetroAchievementsMetadataProvider(this),
		// Software only, see fetchDataProviders
		new FlathubMetadataProvider(this)
	];

	get softwareApps(): number[]
	{
		return this.config.software_apps ?? [];
	}

	isSoftware(appId: number): boolean
	{
		return this.softwareApps.includes(appId);
	}

	/** Marks an app as software or, by hand, as a game (then it's never detected as software) */
	async setSoftware(appId: number, software: boolean): Promise<void>
	{
		const apps = this.softwareApps.filter((id) => id !== appId);
		this.config.software_apps = software ? [...apps, appId] : apps;
		const games = (this.config.game_apps ?? []).filter((id) => id !== appId);
		this.config.game_apps = software ? games : [...games, appId];
		await this.saveConfig();
	}

	private detectingSoftware: Record<number, Promise<void>> = {};

	/**
	 * New Flatpak shortcuts (no data yet, not a ROM, not classified by hand) are software unless Flathub
	 * gives them a game genre. Checked once; on network errors it's tried again later.
	 */
	private detectSoftware(appId: number): Promise<void>
	{
		if (this.isSoftware(appId) || (this.config.game_apps ?? []).includes(appId) || this.hasCachedData(appId) ||
			this.excludedApps.includes(appId) || (this.cache.software_checked ?? []).includes(appId))
			return Promise.resolve();

		return this.detectingSoftware[appId] ??= (async () => {
			try{
				const flathub = this.providers.find((provider): provider is FlathubMetadataProvider => provider instanceof FlathubMetadataProvider);
				const details = flathub?.isValid ? await getAppDetails(appId) : undefined;
				if (!details || appStore.GetAppOverviewByAppID(appId)?.app_type !== SteamAppTypeShortcut)
					return;

				const flatpakId = getFlatpakAppId(getLaunchCommand(details));
				const kind = flatpakId ? await flathub!.classify(flatpakId) : undefined;
				this.cache.software_checked = [...(this.cache.software_checked ?? []), appId];
				void this.saveCache();
				if (kind === "software"){
					this.logger.log(`Detected as software from Flathub (${flatpakId})`, appId);
					this.config.software_apps = [...this.softwareApps, appId];
					await this.saveConfig();
				}
			}
			catch (e: any){
				this.logger.error("Software detection failed", appId, e);
			}
			finally{
				delete this.detectingSoftware[appId];
			}
		})();
	}

	// Software apps with nothing to show (no Flathub entry found, no manual edits) are excluded:
	// Steam's own page stays (and Decky Metadata, which takes MetaDeck's excluded apps, keeps them)
	override get excludedApps(): number[]
	{
		const manual = this.config.manual_overrides ?? {};
		const withoutSource = this.cache.software_without_source ?? [];
		return super.excludedApps.concat(this.softwareApps.filter((id) => !manual[id] && withoutSource.includes(id)));
	}

	private setSoftwareWithoutSource(appId: number, withoutSource: boolean)
	{
		const apps = (this.cache.software_without_source ?? []).filter((id) => id !== appId);
		if (withoutSource)
			apps.push(appId);
		if (apps.length !== (this.cache.software_without_source ?? []).length){
			this.cache.software_without_source = apps;
			void this.saveCache();
		}
	}

	public override async fetchDataAsync(appId: number): Promise<MetadataData | undefined>
	{
		await this.detectSoftware(appId);
		let data = await super.fetchDataAsync(appId);
		if (!this.hasCachedData(appId) && await this.steamSourceGone(appId))
			data = await this.fetchWithoutSteamSource(appId);
		// Remember software apps without an entry, so they're excluded without asking again
		if (this.isSoftware(appId) && !this.excludedApps.includes(appId))
			this.setSoftwareWithoutSource(appId, !this.hasCachedData(appId));
		return data;
	}

	/** Steam is this app's chosen source, but its store page is gone (delisted) */
	private async steamSourceGone(appId: number): Promise<boolean>
	{
		if (this.providerOverrides[appId] !== "steam" || this.excludedApps.includes(appId))
			return false;
		const steam = this.providers.find((provider): provider is SteamMetadataProvider => provider instanceof SteamMetadataProvider);
		const steamAppId = Number(steam?.overrides[appId] ?? this.getSteamMatch(appId));
		return steamAppId > 0 && await isSteamStoreGone(steamAppId);
	}

	/** Data from the automatic providers, as if Steam weren't the chosen source (it has none to give) */
	private async fetchWithoutSteamSource(appId: number): Promise<MetadataData | undefined>
	{
		const found = await this.fetchDataProviders(appId);
		if (!found)
			return undefined;
		this.logger.log(`The Steam store page chosen as the source of ${appId} is gone: ${found[0]} answers instead`);
		await this.provideAdditional(appId, found[1]);
		this.cacheData(appId, found[1]);
		this.dataProviders[appId] = found[0] as any;
		await this.saveCache();
		await this.apply(appId); // Applied before, with nothing
		return this.getCachedData(appId) ?? undefined;
	}

	getManualOverride(appId: number): MetadataManualOverride | undefined
	{
		return this.config.manual_overrides?.[appId];
	}

	/** Saves (or removes, if empty) the manual edits of an app and applies them to Steam */
	async setManualOverride(appId: number, override: MetadataManualOverride | undefined): Promise<void>
	{
		const overrides = { ...(this.config.manual_overrides ?? {}) };
		if (override && Object.keys(override).length)
			overrides[appId] = override;
		else
			delete overrides[appId];
		this.config.manual_overrides = overrides;
		await this.saveConfig();

		await this.refreshApp(appId);
	}

	getSteamMatch(appId: number): number | undefined
	{
		return this.config.steam_matches?.[appId];
	}

	/** Saves (or removes, with undefined) the Steam app matched to a shortcut */
	async setSteamMatch(appId: number, steamAppId: number | undefined): Promise<void>
	{
		const matches = { ...(this.config.steam_matches ?? {}) };
		if (steamAppId)
			matches[appId] = steamAppId;
		else
			delete matches[appId];
		this.config.steam_matches = matches;
		await this.saveConfig();
	}

	/** Provider data only, without manual edits */
	getProviderData(appId: number): MetadataData | undefined
	{
		return super.getCachedData(appId);
	}

	protected override getCachedData(appId: number): MetadataData | undefined
	{
		const data = super.getCachedData(appId);
		const manual = this.getManualOverride(appId);
		if (!manual || !Object.keys(manual).length)
			return data;

		// Manual edits win over the provider, field by field
		return {
			...(data ?? {
				id: appId,
				title: appStore.GetAppOverviewByAppID(appId)?.display_name ?? "",
				description: ""
			}),
			...manual
		};
	}

	public override hasCachedData(appId: number): boolean
	{
		// Provider data only: manual edits must not prevent fetching it
		return super.getCachedData(appId) !== undefined;
	}

	/** Applies the current (merged) data again to Steam, e.g. after a manual edit */
	async refreshApp(appId: number): Promise<void>
	{
		const appData = appDetailsStore.GetAppData(appId);
		if (appData){
			// Associations are only built when missing: drop them so they are built again
			stateTransaction(() => {
				(appData as any).associationData = undefined;
			});
			// Patched above: rebuilding them applies the merged data
			(appDetailsStore as any).GetDescriptions(appId);
			(appDetailsStore as any).GetAssociations(appId);
		}

		await this.apply(appId);
	}

	override async removeCache(appId: number){
		await super.removeCache(appId);
		// Look for a software entry again
		this.setSoftwareWithoutSource(appId, false);
		
		let appData = appDetailsStore.GetAppData(appId);
		if (!appData)
			return;
		
		const overview = await getAppDetails(appId);
		const desc = this.descriptions ? t("noDescription") : "";
		stateTransaction(() => {
			if (this.config.markdown){
				appData.descriptionsData = {
					strFullDescription: <Markdown>
						{this.config.title_header ? `# ${overview?.strDisplayName}\n${desc}` : desc}
					</Markdown>,
					strSnippet: <Markdown>
						{this.config.title_header ? `# ${overview?.strDisplayName}` : ''}
					</Markdown>
				}
			}
			else{
				appData.descriptionsData = {
					strFullDescription: desc,
					strSnippet: ''
				}
			}

			appData.associationData = {
				rgDevelopers: [],
				rgPublishers: [],
				rgFranchises: []
			};

			// Cache plain text only: a serialized React element comes back as {key, ref, props}
			// after a restart and breaks "Game Info" (React error #31)
			appDetailsCache.SetCachedDataForApp(appId, "descriptions", 1, { strFullDescription: desc, strSnippet: '' });
			appDetailsCache.SetCachedDataForApp(appId, "associations", 2, appData.associationData);
		});
	};

	private bypassCounter = 0;
	bypassBypass = 0;

	addMounts(mounts: Mounts): void
	{
		const module = this;

		mounts.addPatchMount({
			patch(): Patch{
				return replacePatch(
					// @ts-ignore
					appDetailsStore.__proto__,
					"GetDescriptions",
					(args) => {
							if (!module.isValid || module.excludedApps.includes(args[0]))
							return callOriginal;

							const overview = appStore.GetAppOverviewByAppID(args[0]);
							if (overview.app_type == SteamAppTypeShortcut){
								let appData = appDetailsStore.GetAppData(args[0]);
								if (appData){
										const data = module.fetchData(args[0]);
										const desc = module.descriptions ? (data?.description ?? t("noDescription")) : "";
										const snip = module.descriptions ? (data?.snippet ?? data?.description ?? '') : "";
										module.logger.debug(desc);

										stateTransaction(() => {
											if (module.config.markdown){
												appData.descriptionsData = {
													strFullDescription: <Markdown>
														{module.config.title_header ? `# ${overview?.display_name}\n${desc}` : desc}
													</Markdown>,
													strSnippet: <Markdown>
														{module.config.title_header ? `# ${overview?.display_name}\n${snip}` : snip}
													</Markdown>
												};
											}
											else{
												appData.descriptionsData = {
													strFullDescription: desc,
													strSnippet: snip
												};
											}

											// Cache plain text only (see removeCache): Markdown elements break "Game Info" after a restart
											appDetailsCache.SetCachedDataForApp(args[0], "descriptions", 1, { strFullDescription: desc, strSnippet: snip });
										});

									return appData.descriptionsData;
								}
							}
							return callOriginal;
					}
				)
			}
		});

		mounts.addPatchMount({
			patch(): Patch
			{
				return replacePatch(
					   // @ts-ignore
					   appStore.allApps[0].__proto__,
					   "BHasStoreCategory",
					   function (args) {
							// @ts-ignore
						   if (!module.isValid || !module.categories || module.excludedApps.includes((this as SteamAppOverview).appid))
							   return callOriginal;

							// Achievements are handled by their module
							// @ts-ignore
							if ((this as SteamAppOverview).app_type == SteamAppTypeShortcut &&
								args[0] !== StoreCategory.Achievements){

								// @ts-ignore
								const data = module.fetchData((this as SteamAppOverview).appid)
								const categories = data?.store_categories ?? [];
								if (categories.includes(args[0]))
								{
									return true
								}
								module.logger.debug(`categories`, categories)
							}
							return callOriginal;
					   }
				)
			}
		});

		mounts.addPatchMount({
			patch(): Patch
			{
				return replacePatch(
					   // @ts-ignore
					   appDetailsStore.__proto__,
					   "GetAssociations",
					   (args) => {
						   if (!module.isValid || !module.associations || module.excludedApps.includes(args[0]))
							   return callOriginal;

						   if (appStore.GetAppOverviewByAppID(args[0]).app_type == SteamAppTypeShortcut)
						   {
							   let appData = appDetailsStore.GetAppData(args[0])
							   // Also refill when left empty (removeCache writes empty associations), but only if we have something to put
							   const emptyAssociations = !appData?.associationData?.rgDevelopers?.length && !appData?.associationData?.rgPublishers?.length;
							   const cached = appData && emptyAssociations ? module.fetchData(args[0]) : undefined;
							   if (appData && (!appData?.associationData || (emptyAssociations && (cached?.developers?.length || cached?.publishers?.length))))
							   {
								   const data = module.fetchData(args[0])
								   const devs = data?.developers ?? [];
								   const pubs = data?.publishers ?? [];
								   module.logger.debug(`associations for ${args[0]}`, devs, pubs);

								   stateTransaction(() => {
									   appData.associationData = {
										   rgDevelopers: devs.map(value => ({
											   strName: value.name,
											   strURL: value.url
										   })),
										   rgPublishers: pubs.map(value => ({
											   strName: value.name,
											   strURL: value.url
										   })),
										   rgFranchises: []
									   }
									   
									   appDetailsCache.SetCachedDataForApp(args[0], "associations", 2, appData.associationData)
								   })
							   }
						   }
						   return callOriginal;
					   }
				)
			}
		});

		mounts.addPatchMount({
			patch(): Patch
			{
				return afterPatch(
					   // @ts-ignore
					   appDetailsStore.__proto__,
					   "BHasRecentlyLaunched",
					   (_, ret) => {
						   if (!module.isValid)
							   return ret;

						   module.bypassCounter = 4;
						   return ret;
					   }
				)
			}
		});

		mounts.addPatchMount({
			patch(): Patch
			{
				return afterPatch(
					appStore.allApps[0].__proto__,
					"BIsModOrShortcut",
					function (_, ret) {
						if (!module.isValid || !module.typeOverride)
							return ret;

						// @ts-ignore
						const overview: SteamAppOverview = this;
						if (ret === true){
							if (module.bypassBypass > 0){
								module.logger.debug("Bypassing", module.bypassBypass);
								
								if (module.bypassBypass > 0)
									module.bypassBypass--;

								if(!module.excludedApps.includes(overview.appid))
									return false;
								else
									return ret;
							}

							// @ts-ignore
							if (Router?.WindowStore?.GamepadUIMainWindowInstance?.m_history?.location?.pathname === '/library/home'){
								if(!module.excludedApps.includes(overview.appid))
									return false;
								else
									return ret;
							}

							// On this game's own page always look like a Steam game, even within a truth window opened
							// by another caller (GetPerClientData, BHasRecentlyLaunched): coming back to the page (e.g. from
							// Change Metadata) otherwise made Game Info fall back to "non-Steam game or mod".
							// Inside GetGameID/GetPrimaryAppID (-1) the real answer is still given: launching needs it.
							if (module.bypassCounter !== -1 && isGameDetailRouteOf(overview.appid)){
								if(!module.excludedApps.includes(overview.appid))
									return false;
								else
									return ret;
							}

							if (module.bypassCounter > 0)
								module.bypassCounter--;

							if(!module.excludedApps.includes(overview.appid))
								return module.bypassCounter === -1 || module.bypassCounter > 0;
						}

						return ret;
					}
				)
			}
		});

		mounts.addPatchMount({
			patch(): Patch
			{
				return beforePatch(
					   appStore.allApps[0].__proto__,
					   "GetGameID",
					   function (_) {
						   if (!module.isValid)
							   return;

						   module.bypassCounter = -1
					   }
				)
			}
		});

		mounts.addPatchMount({
			patch(): Patch
			{
				return afterPatch(
					   appStore.allApps[0].__proto__,
					   "GetGameID",
					   function (_, ret) {
						   if (!module.isValid)
							   return ret;

						   module.bypassCounter = 0
						   return ret;
					   }
				)
			}
		});

		mounts.addPatchMount({
			patch(): Patch
			{
				return beforePatch(
					   appStore.allApps[0].__proto__,
					   "GetPrimaryAppID",
					   function (_) {
						   if (!module.isValid)
							   return;

						   module.bypassCounter = -1
					   }
				)
			}
		});

		mounts.addPatchMount({
			patch(): Patch
			{
				return afterPatch(
					   appStore.allApps[0].__proto__,
					   "GetPrimaryAppID",
					   function (_, ret) {
						   if (!module.isValid)
							   return ret;
							
						   module.bypassCounter = 0
						   return ret;
					   }
				)
			}
		});

		mounts.addPatchMount({
			patch(): Patch
			{
				return afterPatch(
					appStore.allApps[0].__proto__,
					"GetCanonicalReleaseDate",
					function (_, ret) {
						// @ts-ignore
						if (!module.isValid || !module.releaseDate || module.excludedApps.includes(this.appid))
							return ret;

						module.logger.debug(ret);

						// @ts-ignore
						if (this.app_type == SteamAppTypeShortcut){
							// @ts-ignore
							const data = module.fetchData(this.appid);
							module.logger.debug("data", data);
							if (data?.release_date)
								return data.release_date;
						}

						return ret;
					}
				)
			}
		});

		mounts.addPatchMount({
			patch(): Patch
			{
				return afterPatch(
					   appStore.allApps[0].__proto__,
					   "GetPerClientData",
					   function (_, ret) {
						   if (!module.isValid)
							   return ret;

						   module.bypassCounter = 4;
						   return ret;
					   }
				)
			}
		});

		mounts.addPatchMount({
			patch(): Patch
			{
				const AppGameInfoContainer = findModuleExport((e) => e?.toString?.()?.includes("().AppGameInfoContainer"));
				module.logger.debug("AppGameInfoContainer", AppGameInfoContainer);

				return afterPatch(AppGameInfoContainer.prototype, "render", (_, ret) => {
					if (!module.isValid)
						return ret;

					const component = findInReactTree(ret, (e) => e?.props?.onImageLoad);

					beforePatch(component.type.prototype, "render", function (_) {
						//@ts-ignore
						this.m_bDelayedLoad = false;
					});

					afterPatch(component.type.prototype, "render", function (_, ret) {
						if (!module.isValid || !ret)
							return ret;

						const featuresList = findInReactTree(ret, (e) => Array.isArray(e?.props?.children) && e?.props?.children?.length > 10);
						const overview: SteamAppOverview = featuresList?.props?.children?.[0]?.props?.overview

						for (const category of Object.values(CustomStoreCategory))
						{
							if (typeof category != "string" && !(featuresList?.props?.children as Array<ReactElement>)?.some(value => value?.props?.feature == category))
							{
								(featuresList?.props?.children as Array<ReactElement>)?.push(<CustomFeature
									feature={category} minimode={false} overview={overview}
									suppresstooltip={true}/>);
							}
						}


						return ret;
					});

					return ret;
				});
			}
		});


		mounts.addMount(routePatch("/library/app/:appid", (tree: any) => {
			const routeProps = findInReactTree(tree, (x: any) => x?.renderFunc);

			afterPatch(routeProps, "renderFunc", (_, ret) => {
				if (!module.isValid)
					return ret;

				const overview: SteamAppOverview = ret.props.children.props.overview;
				const details: SteamAppDetails = ret.props.children.props.details;
				if (overview.app_type == SteamAppTypeShortcut && !module.excludedApps.includes(overview.appid))
				{
					module.bypassBypass = 11;
					void module.applyApp(overview, details);
				}

				return ret;
			});

			return tree;
		}));

		mounts.addMount(routePatch("/library", (props: { path?: string, children?: ReactNode }) => {
			afterPatch(props.children, "type", (_, ret) => {
				if (!module.isValid)
					return ret;

				for (const appId of this.apps){
					void this.apply(appId);
				}

				return ret;
			})
			return props;
		}));
	}

	progressDescription(data?: MetadataData): string
	{
		return truncate(data?.description, {
			'length': 512,
			'omission': "..."
		});
	}

	isEmpty(data: MetadataData): boolean {
		return (!data.description || data.description === t("noDescription")) &&
			!data.snippet &&

			!data.developers?.length &&
			!data.publishers?.length &&
			!data.release_date &&

			data.rating == null &&
			data.install_size == null &&
			!data.install_date &&

			!data.store_categories?.length;
	}
	
	protected override cacheData(appId: number, data: MetadataData | null): void {
		this.data[appId] = data;
	}

	get typeOverride(): boolean
	{
		return this.config.type_override;
	}

	set typeOverride(typeOverride: boolean)
	{
		this.config.type_override = typeOverride;
		void this.saveConfig();
	}

	get descriptions(): boolean
	{
		return this.config.descriptions;
	}

	set descriptions(descriptions: boolean)
	{
		this.config.descriptions = descriptions;
		void this.saveConfig();
	}

	get releaseDate(): boolean
	{
		return this.config.release_date;
	}

	set releaseDate(release_date: boolean)
	{
		this.config.release_date = release_date;
		void this.saveConfig();
	}

	get associations(): boolean
	{
		return this.config.associations;
	}

	set associations(associations: boolean)
	{
		this.config.associations = associations;
		void this.saveConfig();
	}

	get categories(): boolean
	{
		return this.config.categories;
	}

	set categories(categories: boolean)
	{
		this.config.categories = categories;
		void this.saveConfig();
	}

	get rating(): boolean
	{
		return this.config.rating;
	}

	set rating(rating: boolean)
	{
		this.config.rating = rating;
		void this.saveConfig();
	}

	get installSize(): boolean
	{
		return this.config.install_size;
	}

	set installSize(install_size: boolean)
	{
		this.config.install_size = install_size;
		void this.saveConfig();
	}

	get installDate(): boolean
	{
		return this.config.install_date;
	}

	set installDate(install_date: boolean)
	{
		this.config.install_date = install_date;
		void this.saveConfig();
	}

	get markdown(): boolean
	{
		return this.config.markdown;
	}

	set markdown(markdown: boolean)
	{
		this.config.markdown = markdown;
		void this.saveConfig();
	}

	get titleHeader(): boolean
	{
		return this.config.title_header;
	}

	set titleHeader(title_header: boolean)
	{
		this.config.title_header = title_header;
		void this.saveConfig();
	}

	override icon = <FaRegFileLines/>;

	override settingsComponent = () => {
		const { loadingData } = useMetaDeckState();
		const [typeOverride, setTypeOverride] = useState(this.typeOverride);
		const [descriptions, setDescriptions] = useState(this.descriptions);
		const [releaseDate, setReleaseDate] = useState(this.releaseDate);
		const [associations, setAssociations] = useState(this.associations);
		const [categories, setCategories] = useState(this.categories);
		const [rating, setRating] = useState(this.rating);
		const [installSize, setInstallSize] = useState(this.installSize);
		const [installDate, setInstallDate] = useState(this.installDate);
		const [markdown, setMarkdown] = useState(this.markdown);
		const [titleHeader, setTitleHeader] = useState(this.titleHeader);

		return (
			<>
				<DialogControlsSection>
					<Field
						label={t("metadataSettingsTypeOverride")}
						description={t("metadataSettingsTypeOverrideDesc")}>
						<Toggle
							value={typeOverride}
							disabled={loadingData.loading}
							onChange={(checked) => {
								setTypeOverride(checked);
								this.typeOverride = checked;
							}}/>
					</Field>
					<Field
						label={t("metadataSettingsDescriptions")}
						description={!typeOverride ?
							t("settingsDependencyNotMet")
								.replace("{setting1}", t("metadataSettingsDescriptions"))
								.replace("{setting2}", t("metadataSettingsTypeOverride")) :
							t("metadataSettingsDescriptionsDesc")}>
						<Toggle
							value={descriptions}
							disabled={loadingData.loading || !typeOverride}
							onChange={(checked) => {
								setDescriptions(checked);
								this.descriptions = checked;
							}}/>
					</Field>
					<Field
						label={t("metadataSettingsReleaseDate")}
						description={!typeOverride ?
							t("settingsDependencyNotMet")
								.replace("{setting1}", t("metadataSettingsReleaseDate"))
								.replace("{setting2}", t("metadataSettingsTypeOverride")) :
							t("metadataSettingsReleaseDateDesc")}>
						<Toggle
							value={releaseDate}
							disabled={loadingData.loading || !typeOverride}
							onChange={(checked) => {
								setReleaseDate(checked);
								this.releaseDate = checked;
							}}/>
					</Field>
					<Field
						label={t("metadataSettingsAssociations")}
						description={!typeOverride ?
							t("settingsDependencyNotMet")
								.replace("{setting1}", t("metadataSettingsAssociations"))
								.replace("{setting2}", t("metadataSettingsTypeOverride")) :
							t("metadataSettingsAssociationsDesc")}>
						<Toggle
							value={associations}
							disabled={loadingData.loading || !typeOverride}
							onChange={(checked) => {
								setAssociations(checked);
								this.associations = checked;
							}}/>
					</Field>
				</DialogControlsSection>

				<DialogControlsSection>
					<Field
						label={t("metadataSettingsCategories")}
						description={t("metadataSettingsCategoriesDesc")}>
						<Toggle
							value={categories}
							disabled={loadingData.loading}
							onChange={(checked) => {
								setCategories(checked);
								this.categories = checked;
							}}/>
					</Field>
					<Field
						label={t("metadataSettingsRating")}
						description={t("metadataSettingsRatingDesc")}>
						<Toggle
							value={rating}
							disabled={loadingData.loading}
							onChange={(checked) => {
								setRating(checked);
								this.rating = checked;
							}}/>
					</Field>
					<Field
						label={t("metadataSettingsInstallSize")}
						description={t("metadataSettingsInstallSizeDesc")}>
						<Toggle
							value={installSize}
							disabled={loadingData.loading}
							onChange={(checked) => {
								setInstallSize(checked);
								this.installSize = checked;
							}}/>
					</Field>
					<Field
						label={t("metadataSettingsInstallDate")}
						description={t("metadataSettingsInstallDateDesc")}>
						<Toggle
							value={installDate}
							disabled={loadingData.loading}
							onChange={(checked) => {
								setInstallDate(checked);
								this.installDate = checked;
							}}/>
					</Field>
				</DialogControlsSection>

				<DialogControlsSection>
					<Field
						label={t("metadataSettingsMarkdown")}
						description={t("metadataSettingsMarkdownDesc")}>
						<Toggle
							value={markdown}
							disabled={loadingData.loading}
							onChange={(checked) => {
								setMarkdown(checked);
								this.markdown = checked;
							}}/>
					</Field>
					<Field
						label={t("metadataSettingsTitleHeader")}
						description={!markdown ?
							t("settingsDependencyNotMet")
								.replace("{setting1}", t("metadataSettingsTitleHeader"))
								.replace("{setting2}", t("metadataSettingsMarkdown")) :
							t("metadataSettingsTitleHeaderDesc")}>
						<Toggle
							value={titleHeader}
							disabled={loadingData.loading || !markdown}
							onChange={(checked) => {
								setTitleHeader(checked);
								this.titleHeader = checked;
							}}/>
					</Field>
				</DialogControlsSection>
			</>
		);
	};

	applyOverview(overview: SteamAppOverview): Promise<void>
	{
		if(this.excludedApps.includes(overview.appid))
			return Promise.resolve();

		const data = this.getCachedData(overview.appid);
		if (this.rating)
			overview.metacritic_score = Math.round(data?.rating ?? 0);
		if (this.categories){
			data?.store_categories?.forEach(category => {
				// Achievements are handled by their module
				if(category !== StoreCategory.Achievements)
					overview.m_setStoreCategories.add(category);
			});

			// If we have multiplayer we also assume single player
			if(!data?.store_categories?.includes(StoreCategory.MultiPlayer) &&
				data?.store_categories?.includes(StoreCategory.SinglePlayer)){

				overview.m_setStoreCategories.add(StoreCategory.SinglePlayer);
			}
		}
		if (this.installSize)
			overview.size_on_disk = data?.install_size?.toString() ?? "0";
		if (this.installDate)
			overview.rt_purchased_time = data?.install_date;

		return Promise.resolve();
	}
	
	// We need to retrieve the best matching metadata by preferring this criteria:
	// - a non empty localized description
	// - a non empty description
	// - at least one developer/publisher (more than 1 do not count much)
	// - most distinct store categories
	// - a release date
	// - most populated fields release_date, ...
	private getEntryScore(entry: MetadataData): number{
		let total = 0;

		if(entry.description && entry.description !== t("noDescription"))
			total += (entry.matches_user_language === true ? 20000 : 10000);

		if(entry.developers?.length)
			total += 1000;
		if(entry.publishers?.length)
			total += 1000;

		total += new Set(entry.store_categories).size * 10;

		if(entry.release_date)
			total += 5;

		for(let field of (["rating", "install_size", "install_date"] as (keyof MetadataData)[])){
			let value = (entry as any)[field];
			if(value != null)
				total += 1;			
		}

		// If we have a perfect entry (localized description both developer and publisher,
		// a release date and at least one store category),  we can't get better
		// (and we don't want to lookup other providers)
		if(total >= 20000 + 100 + 100 + 10 + 5)
			return Number.MAX_VALUE;
		else
			return total;
	}

	protected override async fetchDataProviders(appId: number): Promise<[ProviderIdentifier<MetadataModule>, MetadataData] | undefined> {
		// Software: the software providers only (Flathub); games: the others
		const software = this.isSoftware(appId);
		const providers = this.providers.filter((provider) => (provider instanceof FlathubMetadataProvider) === software);
		let results: Partial<Record<ProviderIdentifier<MetadataModule>, MetadataData>> = {};
		for (const provider of providers){
			// isValid (not just enabled): a provider without its API key must be skipped, not throw.
			// A failing provider must not stop the remaining ones.
			let data: MetadataData | undefined;
			try{
				if(!provider.isValid || provider.excludedAppsSelf.includes(appId) || !await provider.test(appId))
					continue;

				data = await provider.provide(appId);
			}
			catch (e: any){
				this.logger.error(`Provider ${provider.identifier} failed for ${appId}`, e);
				continue;
			}
			if(!data || this.isEmpty(data))
				continue;
			
			// If we have a "perfect" entry we return it rightaway
			let score = this.getEntryScore(data);
			if(score === Number.MAX_VALUE)
				return [provider.identifier, data];
			
			results[provider.identifier as ProviderIdentifier<MetadataModule>] = data;
		}

		// If we didn't find a "perfect" entry we try matching the best,
		// or if we have a single entry we use that
		if(Object.keys(results).length){
			let entries = Object.entries(results).sort((a, b) => this.getEntryScore(a[1]) -  this.getEntryScore(b[1])) as [ProviderIdentifier<MetadataModule>, MetadataData][];

			let obj: {
				provider: string;
				score: number | 'max';
				entry: MetadataData
			}[] = entries.map(e => {
				let score = this.getEntryScore(e[1]);
				return {
					provider: e[0],
					score: score === Number.MAX_VALUE ? 'max' : score,
					entry: e[1]
				};
			});
			this.logger.debug(`Resulting metadata for ${appId}: `, obj);
			
			return entries[entries.length-1];
		}

		return undefined;
	}

	override async provideDefault(appId: number): Promise<MetadataData | undefined>
	{
		// Software without an entry is left to Steam (excluded), not shown with an empty default
		if(this.excludedApps.includes(appId) || this.isSoftware(appId))
			return undefined;

		const details = await getAppDetails(appId);
		if(!details)
			return undefined;
		const launchCommand = getLaunchCommand(details);
		const cats: (StoreCategory | CustomStoreCategory)[] = await getShortcutCategories(launchCommand);

		return {
			title: details.strDisplayName,
			id: appId,

			description: t("noDescription"),

			// Achievements are handled by their module
			store_categories: cats.filter(c => c !== StoreCategory.Achievements)
		};
	}
}