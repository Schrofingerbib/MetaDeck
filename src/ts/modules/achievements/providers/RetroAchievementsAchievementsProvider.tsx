import type { AchievementsData, ID, IDDictionary } from "../../../Interfaces"
import { t } from "../../../useTranslations"
import { copyToClipboard, fetchNoCorsLegacyTimeout, getAppDetails, getAppHeader, toasterToast } from "../../../util"
import type { ProviderCache, ProviderConfig } from "../../Provider"
import { AchievementsProvider } from "../AchievementsProvider"
import Logger from "../../../logger"
import { DialogButton, DialogControlsSection, DialogControlsSectionHeader, Dropdown, Field, sleep, TextField, Toggle } from "@decky/ui"
import { GetGameInfoAndUserProgressResponse } from "@retroachievements/api";
import { FaGamepad } from "react-icons/fa"
import { useMetaDeckState } from "../../../MetaDeckState"
import { useState } from "react"
import { Markdown } from "../../../markdown"
import React from "react"
import { fetchNoCors } from "@decky/api"
import {
	getFrontEndSystem, getLaunchCommand, isDolphinGame, isDuckstationGame, isFlycastGame, isMelonDSGame,
	isMGBAGame, isPCSX2Game, isPPSSPPGame, isRosaliesMupenGUIGame
} from "../../../shortcuts"

// RetroDECK / ES-DE system folders -> RetroAchievements console IDs (API_GetConsoleIDs)
const SYSTEM_RA_CONSOLES: Record<string, number> = {
	genesis: 1, megadrive: 1, megadrivejp: 1, n64: 2, snes: 3, sfc: 3, gb: 4, gba: 5, gbc: 6, nes: 7, famicom: 7,
	pcengine: 8, tg16: 8, segacd: 9, megacd: 9, megacdjp: 9, sega32x: 10, mastersystem: 11, mark3: 11, psx: 12,
	atarilynx: 13, ngp: 14, ngpc: 14, gamegear: 15, gc: 16, atarijaguar: 17, nds: 18, wii: 19, ps2: 21,
	pokemini: 24, atari2600: 25, arcade: 27, mame: 27, fbneo: 27, virtualboy: 28, msx: 29, msx1: 29, msx2: 29,
	saturn: 39, saturnjp: 39, dreamcast: 40, psp: 41, "3do": 43, colecovision: 44, intellivision: 45, vectrex: 46,
	atari7800: 51, wonderswan: 53, wonderswancolor: 53, neogeocd: 56, pcenginecd: 76, tg_cd: 76, atarijaguarcd: 77
};

export type RetroAchievementsConsole = { ID: number; Name: string; };
export type RetroAchievementsGame = {
	ID: number;
	Title: string;
	ConsoleID: number;
	ConsoleName: string;
	ImageIcon: string; // "/Images/126542.png"
	NumAchievements: number;
	Points: number;
};

export interface RetroAchievementsAchievementsProviderConfig extends ProviderConfig<'ra'>{
	username: string;
	api_key: string;
	// Game ID chosen by hand on the "Change Metadata" page, 0 for no achievements (instead of the ROM hash)
	overrides?: IDDictionary;
	points: boolean;

	// https://github.com/RetroAchievements/RAWeb/blob/fa58a24122f80e86e401443514800a49d344b7d1/public/API/API_GetGameInfoAndUserProgress.php#L31
	achievement_types: boolean;
	parent_sets: boolean; // One set per parent or one single base set
	subsets: boolean;
	subsets_sets: boolean | null; // null: show as DLC, true/false: show/hide prefixes or create separate sets/add to base
}

export interface RetroAchievementsAchievementsProviderCache extends ProviderCache{
	// Cache lasts max 5 mins, to allow achievements and metadata to retrieve the same result
	game_info: Record<ID, GetGameInfoAndUserProgressResponse & {
		retrieved: number; // Date.getTime()
	}>;
	// Parent game ID -> subset IDs, built from every console's game list (dozens of requests),
	// so it's kept between sessions and rebuilt in background when it expires
	parent_subsets?: {
		map: Record<ID, ID[]>;
		retrieved: number; // Date.getTime()
	};
}

const PARENT_SUBSETS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class RetroAchievementsAchievementsProvider extends AchievementsProvider<"ra">{
	identifier = "ra" as const;
	title = t("providerAchievementsRA");

	logger = new Logger(this.identifier);

	private parentSubsets: Record<ID, ID[]> = {}; // Parent ID, subset IDs

	override get isValid(): boolean {
		return super.isValid && !!this.username && !!this.apiKey;
	}

	get overrides(): IDDictionary{
		return this.config.overrides ?? {};
	}

	/** Pins (or unpins, with undefined; 0 for no achievements) the game of an app, whatever its ROM hash */
	async setOverride(appId: number, id: ID | undefined): Promise<void>{
		const overrides = { ...this.overrides };
		if (id === undefined)
			delete overrides[appId];
		else
			overrides[appId] = id;
		this.config.overrides = overrides;
		await this.saveConfig();
	}

	// A pinned game doesn't need a ROM hash known by RetroAchievements
	override async test(appId: number, external = false): Promise<boolean>{
		if (!external && this.excludedApps.includes(appId))
			return false;
		const pinned = this.overrides[appId];
		if (pinned !== undefined)
			return pinned !== 0;
		return super.test(appId, external);
	}

	private consoles?: Promise<RetroAchievementsConsole[]>;
	private consoleGames: Record<number, Promise<RetroAchievementsGame[]>> = {};

	/** Game systems, for the "Change Metadata" page (kept for the session) */
	getConsoles(): Promise<RetroAchievementsConsole[]>{
		this.consoles ??= this.raRequest(`https://retroachievements.org/API/API_GetConsoleIDs.php?` + new URLSearchParams({
			y: this.apiKey, a: "1", g: "1"
		}).toString())
			.then(async (response) => ((await response.json()) as RetroAchievementsConsole[]).sort((a, b) => a.Name.localeCompare(b.Name)))
			.catch((e) => {
				this.consoles = undefined;
				throw e;
			});
		return this.consoles;
	}

	/** Games with achievements of a console (kept for the session) */
	getConsoleGames(consoleId: number): Promise<RetroAchievementsGame[]>{
		this.consoleGames[consoleId] ??= this.raRequest(`https://retroachievements.org/API/API_GetGameList.php?` + new URLSearchParams({
			y: this.apiKey, i: consoleId.toString(), f: "1"
		}).toString())
			.then(async (response) => (await response.json()) as RetroAchievementsGame[])
			.catch((e) => {
				delete this.consoleGames[consoleId];
				throw e;
			});
		return this.consoleGames[consoleId];
	}

	/** The console of an app, from its front-end system or emulator */
	async getAppConsole(appId: number): Promise<number | undefined>{
		const details = await getAppDetails(appId);
		if (!details)
			return undefined;
		const launchCommand = getLaunchCommand(details);
		const system = getFrontEndSystem(launchCommand);
		if (system && SYSTEM_RA_CONSOLES[system])
			return SYSTEM_RA_CONSOLES[system];
		if (isDuckstationGame(launchCommand))
			return 12;
		if (isPCSX2Game(launchCommand))
			return 21;
		if (isRosaliesMupenGUIGame(launchCommand))
			return 2;
		if (isDolphinGame(launchCommand))
			return 16;
		if (isMelonDSGame(launchCommand))
			return 18;
		if (isMGBAGame(launchCommand))
			return 5;
		if (isPPSSPPGame(launchCommand))
			return 41;
		if (isFlycastGame(launchCommand))
			return 40;
		return undefined;
	}

	/** A game's achievements and the user's progress (cached 5 minutes) */
	getGameProgress(raId: ID): Promise<GetGameInfoAndUserProgressResponse | undefined>{
		return this.getGameInfoAndProgressInternal(raId);
	}

	get username(): string{
		return this.config.username;
	}

	set username(data: string){
		this.config.username = data;
		void this.saveConfig();
	}

	get apiKey(): string{
		return this.config.api_key;
	}

	set apiKey(data: string)
	{
		this.config.api_key = data;
		void this.saveConfig();
	}

	get points(): boolean
	{
		return this.config.points;
	}

	set points(data: boolean)
	{
		let current = this.points;
		this.config.points = data;
		void this.saveConfig();

		if(current != data)
			void this.clearModuleCache();
	}

	get achievementTypes(): boolean
	{
		return this.config.achievement_types;
	}

	set achievementTypes(data: boolean)
	{
		let current = this.achievementTypes;
		this.config.achievement_types = data;
		void this.saveConfig();

		if(current != data)
			void this.clearModuleCache();
	}

	get parentSets(): boolean
	{
		return this.config.parent_sets;
	}

	set parentSets(data: boolean)
	{
		let current = this.parentSets;
		this.config.parent_sets = data;
		void this.saveConfig();

		if(current != data)
			void this.clearModuleCache();
	}

	get subsets(): boolean
	{
		return this.config.subsets;
	}

	set subsets(data: boolean)
	{
		let current = this.subsets;
		this.config.subsets = data;
		void this.saveConfig();

		if(current != data)
			void this.clearModuleCache();
	}

	get subsetsSets(): boolean | null
	{
		return this.config.subsets_sets;
	}

	set subsetsSets(data: boolean | null)
	{
		let current = this.subsetsSets;
		this.config.subsets_sets = data;
		void this.saveConfig();

		if(current != data)
			void this.clearModuleCache();
	}

	get gameInfo(): RetroAchievementsAchievementsProviderCache['game_info']
	{
		return this.cache.game_info;
	}

	private async raRequest(url: string): Promise<Response>{
		let retry = 0;
		let sleep_ms = 2000;
		while (retry < 5){
			if (retry > 0){
				await sleep(sleep_ms);
				sleep_ms *= 2;
			}

			const response = await this.throttle(() => fetchNoCorsLegacyTimeout(url, 'GET'));
			if (response.status == 429 || response.status == 504 || response.status == 500){
				this.logger.debug(`Response status was ${response.status}, retrying`, retry);
				retry++;
			}
			else if (response.status == 200)
				return response;
			else{
				// Clear to avoid errors
				if(response.status == 403){
					toasterToast(t("apiKeyError"), this);

					this.apiKey = '';
				}

				this.logger.debug(`Response status was ${response.status}`);
				throw new Error(`${response.status}`);
			}
		}

		throw new Error("Maximum retries exceeded");
	}

	override async mount(): Promise<void> {
		const cached = this.cache.parent_subsets;
		if(cached?.map){
			this.parentSubsets = cached.map;
			this.logger.debug("Parent/subsets (cached)", this.parentSubsets);

			// Rebuilding takes dozens of requests: keep using the cached map meanwhile instead of delaying the mount
			if(new Date().getTime() - cached.retrieved >= PARENT_SUBSETS_TTL_MS)
				void this.refreshParentSubsets();
			return;
		}

		// Nothing cached yet: subsets can't be grouped without it
		await this.refreshParentSubsets();
	}

	private refreshingParentSubsets?: Promise<void>;

	private refreshParentSubsets(): Promise<void> {
		this.refreshingParentSubsets ??= this.buildParentSubsets()
			.finally(() => this.refreshingParentSubsets = undefined);
		return this.refreshingParentSubsets;
	}

	private async buildParentSubsets(): Promise<void> {
		let init = false;
		try{
			// Retrieve consoles list
			let response = await this.raRequest(`https://retroachievements.org/API/API_GetConsoleIDs.php?` + new URLSearchParams({
					y: this.apiKey,
					a: '1',
					g: '1'
				}).toString());
			if(!response.ok)
				return;

			let consoles: { ID: number; }[] = await response.json();
			if(!consoles.length)
				return;

			// For each console retrieve all games (titles only, hashes are not needed here)
			const parentSubsets: Record<ID, ID[]> = {};
			for(let console of consoles){
				let response = await this.raRequest(
				`https://retroachievements.org/API/API_GetGameList.php?` + new URLSearchParams({
					y: this.apiKey,
					i: console.ID.toString(),
					f: '1',
					c: '0' // Retrieve all
				}).toString());
				if(!response.ok)
					return;

				let games: {
					Title: string;
					ID: number;
				}[] = await response.json();
				for(let game of games){
					let matchingGames = games.filter(g => g.ID !== game.ID && g.Title.startsWith(game.Title) && g.Title.toLowerCase().includes("subset"));
					if(!matchingGames.length)
						continue;

					parentSubsets[game.ID] = matchingGames.map(g => g.ID);
				}
			}

			// Only replace the map once complete, a partial one would hide subsets
			this.parentSubsets = parentSubsets;
			this.cache.parent_subsets = {
				map: parentSubsets,
				retrieved: new Date().getTime()
			};
			void this.saveCache();
			this.logger.debug("Parent/subsets", this.parentSubsets);

			init = true;
		}
		catch (e: any){
			this.logger.error("Parent/subsets retrieval failed", e);
		}
		finally{
			if(!init)
				toasterToast(t("initError"), this);
		}
	}

	provide(appId: number): Promise<AchievementsData | undefined> {
		return this.throttle(async () => {
			let game = await this.getGameInfoAndProgress(appId);

			this.logger.debug(`${appId} game: `, game);

			if(!game)
				return undefined;
			
			const details = await getAppDetails(appId);
			if (!details)
				return undefined;

			// Retrieve parent games: a subset has its game as parent ("Super Mario 64 [Subset - Bonus]" -> "Super Mario 64").
			// The loop never moved up before, so a subset (ParentGameID set) looped forever and blocked the provider
			let parents: Record<ID, typeof game> = { [game.ID]: game };
			let child = game;
			while((child as any).ParentGameID && !parents[(child as any).ParentGameID]){
				const parent = await this.getGameInfoAndProgressInternal((child as any).ParentGameID);
				if(!parent)
					break;

				parents[parent.ID] = parent;
				child = parent;
			}

			const parentGame = game;

			// Retrieve all subsets if needed
			let subsets: Record<ID, typeof game> = {};
			if(this.subsets){
				for(let gameId of Object.keys(parents)){
					if(!this.parentSubsets[gameId])
						continue;

					for(let subsetId of this.parentSubsets[gameId]){
						// The chosen subset is already the base set
						if(subsets[subsetId] || parents[subsetId])
							continue;

						game = await this.getGameInfoAndProgressInternal(subsetId);
						if(!game)
							continue;

						subsets[game.ID] = game;
					}
				}
			}
			
			let result: AchievementsData = {
				title: details.strDisplayName,
				id: parentGame.ID,

				groups: []
			};

			// Main parent, parents, subsets
			let multipleParents = (Object.keys(parents).length > 1 && this.parentSets);
			let multipleSubsets = (Object.keys(subsets).length && this.subsets && this.subsetsSets !== false);
			for(let game of [parentGame]
				.concat(Object.values(parents).filter(g => g.ID !== parentGame.ID))
				.concat(Object.values(subsets))){

				let groups = result.groups.length;

				let gameTitle = game.Title.match(/\[subset\s*-\s*(.+)\s*\]/i)?.[1]
					?? game.Title;
				
				// Add DLCs and groups
				let isBase = game.ID === parentGame.ID;
				let isParent = !isBase && parents[game.ID];
				let multipleSets = (isParent ? multipleParents : multipleSubsets);
				let isBaseGroup = !isBase && !multipleSets; // Base does not default to 0 group, but it is 0 group
				// DEV: check if subsets are achievable/owned, how?
				if(!isBaseGroup){
					let subsetTitle = isBase ? '' : gameTitle;

					// Add DLC
					let dlcIndex: number | undefined;
					if(!isBase && !isParent && this.subsetsSets === null){
						let image: string | undefined;
						// Check for "no image available"
						if(game.ImageIcon && game.ImageIcon !== "/Images/000002.png"){
							try{
								image = URL.createObjectURL(await (await fetchNoCors("https://retroachievements.org" + game.ImageIcon)).blob());
							}
							catch{}
						}
						if(!image)
							image = getAppHeader(appId);

						result.dlcs ??= [];
						result.dlcs.push({
							name: gameTitle,
							image: image,
							// DEV: all owned until fix
							// https://retroachievements.org/forums/topic/34021?comment=447717#447717
							owned: true
						});
						dlcIndex = result.dlcs.length-1;
					}

					// 1 + ... + 1 sets (achievementTypes=false)
					// 1 + 3 + ... + 1 + 3 sets (achievementTypes=true)
					result.groups.push({
						name: subsetTitle,
						dlc: dlcIndex,
						achievements: []
					});
					if(this.achievementTypes){
						if(multipleSets && isBase)
							subsetTitle = t("defaultAchievementSet");
						let baseName = (multipleSets ? `${subsetTitle} - ` : "");
						result.groups.push(
							{
								name: baseName + t("raAchievementTypeProgression"),
								dlc: dlcIndex,
								achievements: []
							},
							{
								name: baseName + t("raAchievementTypeMissable"),
								dlc: dlcIndex,
								achievements: []
							},
							{
								name: baseName + t("raAchievementTypeCompletion"),
								dlc: dlcIndex,
								achievements: []
							}
						);
					}
				}
				
				let subsetTitle = ((!this.module.hasAchievementSetsSupport && (multipleParents || multipleSubsets) && !isBase && !isBaseGroup) ? 
					gameTitle : 
					undefined);

				// Add achievements
				for(let achievement of Object.values(game.Achievements)
					.sort((a, b) => Number(a.DisplayOrder) - Number(b.DisplayOrder))){

					let groupId = (isBaseGroup ? 0 : groups);
						
					let achieved = !!achievement.DateEarned;

					let achievementType: string | undefined = undefined;
					if(this.achievementTypes){
						switch((achievement as any).Type){
						case 'progression':
							groupId += 1;
							if(!this.module.hasAchievementSetsSupport)
								achievementType = t("raAchievementTypeProgression");
							break;
						case 'missable':
							groupId += 2;
							if(!this.module.hasAchievementSetsSupport)
								achievementType = t("raAchievementTypeMissable");
							break;
						case 'win_condition':
							groupId += 3;
							if(!this.module.hasAchievementSetsSupport)
								achievementType = t("raAchievementTypeCompletion");
							break;
						}
					}
						
					result.groups[groupId].achievements.push({
						bAchieved: achieved,
						bHidden: false,
						flAchieved: (((achievement.NumAwarded ? Number(achievement.NumAwarded) : 0) / (game.NumDistinctPlayersCasual ? Number(game.NumDistinctPlayersCasual) : 1)) * 100.0),
						rtUnlocked: achieved ?
							(achievement.DateEarnedHardcore ? ((new Date(achievement.DateEarnedHardcore).getTime() / 1000) + (new Date(achievement.DateEarnedHardcore).getTimezoneOffset() * 60)) :
								achievement.DateEarned ? ((new Date(achievement.DateEarned).getTime() / 1000) + (new Date(achievement.DateEarned).getTimezoneOffset() * 60)) :
								0) :
							0,
						strDescription: [
							subsetTitle,
							(this.points ? `${achievement.Points} CP` : undefined),
							achievementType,
							achievement.Description
						].filter(d => d).join(' - '),
						strID: achievement.ID,
						strImage: `https://media.retroachievements.org/Badge/${achievement.BadgeName}.png`,
						strImageLocked: `https://media.retroachievements.org/Badge/${achievement.BadgeName}_lock.png`,
						strName: achievement.Title
					});
				}
			}

			return result;
		});
	}

	override icon = <FaGamepad/>;

	override settingsComponent = () => {
		const { loadingData } = useMetaDeckState();
		const [username, setUsername] = useState(this.username);
		const [apiKey, setApiKey] = useState(this.apiKey);
		const [subsets, setSubsets] = useState(this.subsets);

		const [points, setPoints] = useState(this.points);

		const [achievementTypes, setAchievementTypes] = useState(this.achievementTypes);
		const [parentSets, setParentSets] = useState(this.parentSets);
		const [subsetsSets, setSubsetsSets] = useState(this.subsetsSets);

		const authUrl = "https://retroachievements.org/controlpanel.php";

		return (
			<>
				<DialogControlsSection>
					<DialogControlsSectionHeader>{t("settings")}</DialogControlsSectionHeader>
					<Field
						label={t("username")}
						description={
							<TextField
								value={username}
								disabled={loadingData.loading}
								onChange={(event) => {
									setUsername(event.target.value);
									this.username = event.target.value;
								}}/>
						} />
					<Field
						label={t("apiKey")}
						description={
							<TextField
								value={apiKey}
								disabled={loadingData.loading}
								onChange={(event) => {
									setApiKey(event.target.value);
									this.apiKey = event.target.value;
								}}/>
						} />
					<Field description={
						<Markdown>{t("raApiKeyInstructions")
							.replace("{raUrl}", `[retroachievements.org](${authUrl})`)}</Markdown>
					}>
						<DialogButton
							onClick={() => void copyToClipboard(authUrl)}>
							{t("copyAuthUrl")}
						</DialogButton>
					</Field>
					<Field
						label={t("raSubsets")}
						description={t("raSubsetsDesc")}>
						<Toggle
							value={subsets}
							onChange={(checked) => {
								setSubsets(checked);
								this.subsets = checked;
							}}/>
					</Field>
				</DialogControlsSection>

				<DialogControlsSection>
					<Field
						label={t("raPoints")}
						description={t("raPointsDesc")}>
						<Toggle
							value={points}
							disabled={loadingData.loading}
							onChange={(checked) => {
								setPoints(checked);
								this.points = checked;
							}}/>
					</Field>
				</DialogControlsSection>

				<DialogControlsSection>
					<DialogControlsSectionHeader>{(this.module.hasAchievementSetsSupport ? t("settingsAchievementsSets") : t("settingsAchievementsPrefixes"))}</DialogControlsSectionHeader>
					<Field
						label={(this.module.hasAchievementSetsSupport ? t("raAchievementTypesSets") : t("raAchievementTypesPrefix"))}
						description={(this.module.hasAchievementSetsSupport ? t("raAchievementTypesSetsDesc") : t("raAchievementTypesPrefixDesc"))}>
						<Toggle
							value={achievementTypes}
							disabled={loadingData.loading}
							onChange={(checked) => {
								setAchievementTypes(checked);
								this.achievementTypes = checked;
							}}/>
					</Field>
					<Field
						label={(this.module.hasAchievementSetsSupport ? t("raParentSetSets") : t("raParentSetPrefixes"))}
						description={(this.module.hasAchievementSetsSupport ? t("raParentSetSetsDesc") : t("raParentSetPrefixesDesc"))}>
						<Toggle
							value={parentSets}
							disabled={loadingData.loading}
							onChange={(checked) => {
								setParentSets(checked);
								this.parentSets = checked;
							}}/>
					</Field>
					{
						this.module.hasAchievementSetsSupport ? 
							<Field
								label={t("raSubsetSetSets")}
								description={!subsets ?
									t("settingsDependencyNotMet")
										.replace("{setting1}", t("raSubsetSetSets"))
										.replace("{setting2}", t("raSubsets")) :
									t("raSubsetSetSetsDesc")}
								childrenContainerWidth={'fixed'}>
								<Dropdown
									rgOptions={[
										{ data: true, label: t("settingsAchievementsCreateSetNormal") },
										{ data: null, label: t("settingsAchievementsCreateSetDlc") },
										{ data: false, label: t("settingsAchievementsCreateSetNone") }
									]}
									selectedOption={subsetsSets}
									disabled={loadingData.loading}
									onChange={(newVal) => {
										setSubsetsSets(newVal.data);
										this.subsetsSets = newVal.data;
									}} />
							</Field> :
							<Field
								label={t("raSubsetSetPrefixes")}
								description={!subsets ?
									t("settingsDependencyNotMet")
										.replace("{setting1}", t("raSubsetSetPrefixes"))
										.replace("{setting2}", t("raSubsets")) :
									t("raSubsetSetPrefixesDesc")}>
								<Toggle
									value={(subsetsSets ?? true)}
									disabled={loadingData.loading || !subsets}
									onChange={(checked) => {
										setSubsetsSets(checked);
										this.subsetsSets = checked;
									}}/>
							</Field>
					}
				</DialogControlsSection>
			</>
		)
	}


	private async getGameInfoAndProgressInternal(raId: ID): Promise<GetGameInfoAndUserProgressResponse | undefined>{
		// Cache lasts 5 mins
		let game: (typeof this.gameInfo[ID]) | undefined = this.gameInfo[raId];
		if(game && Math.floor(Math.abs(new Date().getTime() - game.retrieved) / (1000 * 60)) < 5)
			return game;

		// Clear cache
		game = undefined;
		delete this.gameInfo[raId];

		const response = await this.raRequest(
			`https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php?` + new URLSearchParams({
				y: this.apiKey,
				u: this.username,
				g: raId.toString()
			}).toString());
		game = await response.json();
		if(game){
			game.retrieved = new Date().getTime();
			this.gameInfo[raId] = game;
		}

		return game;
	}

	public async getGameInfoAndProgress(appId: number): Promise<GetGameInfoAndUserProgressResponse | undefined>{
		if(!this.username || !this.apiKey)
			return undefined;
		
		// A game chosen by hand wins over the ROM hash
		const pinned = this.overrides[appId];
		if (pinned === 0)
			return undefined;
		const resolved = pinned ?? await this.resolve(appId, true);
		if (!resolved)
			return undefined;

		return await this.getGameInfoAndProgressInternal(resolved);
	}
}