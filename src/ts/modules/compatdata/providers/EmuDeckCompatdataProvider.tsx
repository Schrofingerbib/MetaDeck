import {CompatdataData, SteamDeckCompatCategory, SteamTestResult, VerifiedDBResults, YesNo, type ID} from "../../../Interfaces";
import {distanceWithLimit, getAppDetails, toasterToast} from "../../../util";
import {fetchNoCors} from "@decky/api";
import {t} from "../../../useTranslations";
import {
	getLaunchCommand, isCemuGame, isDolphinGame, isDuckstationGame, isEmulatedGame, isFlycastGame,
	isMelonDSGame, isMGBAGame, isPCSX2Game, isPPSSPPGame, isRosaliesMupenGUIGame, isRPCS3Game,
	isShadPS4Game, isRyujinxGame, isVita3KGame, isXemuGame, isXeniaGame
} from "../../../shortcuts";
import { FuzzySearchCompatdataProvider, type FuzzySearchCompatdataProviderCache, type FuzzySearchCompatdataProviderConfig } from "./FuzzySearchCompatdataProvider";
import Logger from "../../../logger";
import { FaGamepad } from "react-icons/fa";
import { distance } from "fastest-levenshtein";
import { rankTitles } from "../../../titleSearch";

// RetroDECK / ES-DE system folders -> EmuDeck list consoles
const SYSTEM_CONSOLES: Record<string, string[]> = {
	psx: ['PS1', 'PSX'], ps2: ['PS2'], ps3: ['PS3'], ps4: ['PS4'], psp: ['PSP'], psvita: ['PS Vita', 'PSVITA'],
	n64: ['N64'], n64dd: ['N64'], gc: ['Gamecube'], wii: ['Wii'], wiiu: ['Wii U'], switch: ['Switch'],
	nds: ['DS'], n3ds: ['3DS'], gb: ['Gameboy'], gbc: ['Gameboy Color'], gba: ['Gameboy Advance'],
	nes: ['NES'], famicom: ['NES'], snes: ['SNES'], sfc: ['SNES'],
	dreamcast: ['Dreamcast'], saturn: ['Sega Saturn'], saturnjp: ['Sega Saturn'],
	genesis: ['Genesis/Megadrive'], megadrive: ['Genesis/Megadrive'], megadrivejp: ['Genesis/Megadrive'],
	segacd: ['Sega CD'], megacd: ['Sega CD'], megacdjp: ['Sega CD'], mastersystem: ['Sega Master System'], mark3: ['Sega Master System'],
	xbox: ['Xbox'], xbox360: ['Xbox 360'],
	tg16: ['TurboGrafx-16'], pcengine: ['TurboGrafx-16'], tg_cd: ['TurboGrafx-16'], pcenginecd: ['TurboGrafx-16'],
	ngp: ['Neo Geo Pocket/Color'], ngpc: ['Neo Geo Pocket/Color'], c64: ['Commodore 64'], cdimono1: ['Phillips CD-i'],
	'3do': ['3DO'], atarijaguar: ['Atari Jaguar'], dos: ['DOS'], doom: ['DOOM'], scummvm: ['ScummVM'], mame: ['MAME'], arcade: ['MAME']
};

/** Consoles of a game launched by a front-end (RetroDECK "-s ps2", or an ES-DE ".../roms/ps2/..." path) */
function frontEndConsoleNames(launchCommand?: string): string[] | undefined{
	const system = launchCommand?.match(/(?:^|\s)(?:-s|--system)\s+"?([A-Za-z0-9_-]+)/)?.[1] ??
		launchCommand?.match(/\/roms\/([A-Za-z0-9_-]+)\//)?.[1];
	return system ? SYSTEM_CONSOLES[system.toLowerCase().replace(/-/g, "_")] : undefined;
}

export interface EmuDeckCompatdataProviderConfig extends FuzzySearchCompatdataProviderConfig{

}

export interface EmuDeckCompatdataProviderCache extends FuzzySearchCompatdataProviderCache{

}

export class EmuDeckCompatdataProvider extends FuzzySearchCompatdataProvider<"emudeck">{
	identifier = "emudeck" as const;
	title = t("providerCompatdataEmuDeck");

	logger = new Logger(this.identifier);

	// Every Steam Deck report (several per game: consoles, emulators, users) and the titles to search
	private verifiedRows: VerifiedDBResults[] = [];
	private verifiedTitles: string[] = [];

	override async mount(): Promise<void>{
		const response = (await fetchNoCors("https://opensheet.elk.sh/1fRqvAh_wW8Ho_8i966CCSBgPJ2R_SuDFIvvKsQCv05w/Database"));
		if (!response.ok || response.status !== 200){
			toasterToast(t("initError"), this);

			return;
		}

		const verifiedDB: VerifiedDBResults[] = await response.json();
		// Previously keyed by title: reports of the same game for other consoles overwrote each other
		this.verifiedRows = verifiedDB
			.filter(r => !r.Platform || r.Platform.trim() === "Steam Deck")
			.map((r, i) => ({ ...r, Row: i }));
		this.verifiedTitles = [...new Set(this.verifiedRows.map(r => r.Game))];
	}

	private async getConsoleNames(appId: number): Promise<string[] | undefined>{
		const details = await getAppDetails(appId);
		if (!details)
			return undefined;
		const launchCommand = getLaunchCommand(details);

		if(isXemuGame(launchCommand))
			return ['Xbox'];
		else if(isXeniaGame(launchCommand))
			return ['Xbox 360'];

		else if(isDuckstationGame(launchCommand))
			return ['PS1', 'PSX'];
		else if(isPCSX2Game(launchCommand))
			return ['PS2'];
		else if(isRPCS3Game(launchCommand))
			return ['PS3'];
		else if(isShadPS4Game(launchCommand))
			return ['PS4'];
		else if(isPPSSPPGame(launchCommand))
			return ['PSP'];
		else if(isVita3KGame(launchCommand))
			return ['PS Vita', 'PSVITA'];

		else if(isDolphinGame(launchCommand))
			return ['Wii', 'Gamecube'];
		else if(isCemuGame(launchCommand))
			return ['Wii U'];
		else if(isMelonDSGame(launchCommand))
			return ['DS'];
		else if(isMGBAGame(launchCommand))
			return ['Gameboy', 'Gameboy Color', 'Gameboy Advance'];
		else if(isRosaliesMupenGUIGame(launchCommand))
			return ['N64'];
		else if(isRyujinxGame(launchCommand))
			return ['Switch'];

		else if(isFlycastGame(launchCommand))
			return ['Dreamcast'];
		
		else
			// Emulators launched by a front-end such as RetroDECK; undefined: unknown (match all)
			return frontEndConsoleNames(launchCommand);
	}

	override async test(appId: number): Promise<boolean>{
		if (this.overrides[appId] === 0)
			return false;

		const details = await getAppDetails(appId);
		if(!details)
			return false;
		if(!isEmulatedGame(getLaunchCommand(details)))
			return false;

		return await super.test(appId);
	}

	protected search(title: string, consoleNames?: string[]): Promise<CompatdataData[]>{
		return Promise.resolve(this.searchReports(title, consoleNames, 5));
	}

	/** Search of the whole list (any console) by words, for the "Change Metadata" page */
	override searchByQuery(query: string): Promise<CompatdataData[]>{
		const order = new Map(rankTitles(query, this.verifiedTitles, (title) => title).map((title, i) => [title, i]));
		const groups: Record<string, VerifiedDBResults[]> = {};
		for (const row of this.verifiedRows)
			if (order.has(row.Game))
				(groups[`${row.Game}\u0000${row.Console}`] ??= []).push(row);

		return Promise.resolve(Object.values(groups)
			.sort((a, b) => order.get(a[0].Game)! - order.get(b[0].Game)! || a[0].Console.localeCompare(b[0].Console))
			.slice(0, 30)
			.map(reports => this.toEntry(reports)));
	}

	private searchReports(title: string, consoleNames: string[] | undefined, limit: number): CompatdataData[]{
		// Search with double the fuzziness to retrieve them all, they will be filtered later
		const closestNames = new Set(distanceWithLimit(this.fuzziness * 2, title, this.verifiedTitles));
		let results = this.verifiedRows.filter(r => closestNames.has(r.Game));

		// If we have console(s), filter by them
		if(consoleNames?.length)
			results = results.filter(r => consoleNames.includes(r.Console?.trim()));

		// One entry per game and console, closest titles first
		title = title.toLowerCase(); // Lowercase for efficiency
		const groups: Record<string, VerifiedDBResults[]> = {};
		for(let result of results)
			(groups[`${result.Game}\u0000${result.Console}`] ??= []).push(result);

		return Object.values(groups)
			.sort((a, b) => distance(title, a[0].Game.toLowerCase()) - distance(title, b[0].Game.toLowerCase()))
			.slice(0, limit)
			.map(reports => this.toEntry(reports));
	}

	/** An entry from the reports of a game on a console */
	private toEntry(reports: VerifiedDBResults[]): CompatdataData{
		let compat = Math.max(
			SteamDeckCompatCategory.UNKNOWN,
			...reports.map(r => {
				if (r.Boots == YesNo.YES && r.Playable == YesNo.YES)
					return SteamDeckCompatCategory.VERIFIED;
				else if (r.Boots == YesNo.YES && (r.Playable == YesNo.NO || r.Playable == YesNo.PARTIAL))
					return SteamDeckCompatCategory.PLAYABLE;
				else
					return SteamDeckCompatCategory.UNSUPPORTED;
			})
		);

		let notes: CompatdataData['deck_test_results'] = reports.map(r => r.Notes)
			.filter(n => n)
			.map(n => ({
				test_loc_token: n,
				test_result: SteamTestResult.Notes
			}));

		return {
			title: reports[0].Game,
			id: Math.min(...reports.map(r => r.Row)),
			// The sheet's column is "Emulator " (with a trailing space)
			console: reports[0].Console?.trim(),
			emulator: ((reports[0] as any)["Emulator "] ?? reports[0].Emulator)?.trim(),

			deck_compat_category: compat,
			frame_compat_category: compat, // We assume the Frame to be as powerful as the Deck

			// We need to duplicate the arrays since they might be edited later
			deck_test_results: notes,
			machine_test_results: [...notes],
			os_test_results: [...notes],
			frame_test_results: [...notes]
		};
	}

	// Pinned entries are looked up by ID (any title or console)
	override getEntryById(id: ID): CompatdataData | undefined{
		const row = this.verifiedRows.find(r => r.Row === Number(id));
		return row ? this.toEntry(this.verifiedRows.filter(r => r.Game === row.Game && r.Console === row.Console)) : undefined;
	}

	protected override async enrichCompatdataForGame(appId: number, game: CompatdataData): Promise<void> {
		// Retrieve missing info
		if(game.deck_test_results?.every(r => r.test_result === SteamTestResult.Notes) === false)
			return;

		const details = (await getAppDetails(appId))!;
		const launchCommand = getLaunchCommand(details);

		game.deck_test_results ??= [];
		game.machine_test_results ??= [];
		game.os_test_results ??= [];
		game.frame_test_results ??= [];
		
		const deckMachineAndFrame = [
			[game.deck_test_results, "SteamDeckVerified" as string],
			[game.machine_test_results, "SteamMachine" as string],
			[game.frame_test_results, "SteamFrame" as string]
		] as const;
		const deckMachineOSAndFrame = [
			[game.deck_test_results, "SteamDeckVerified" as string],
			[game.machine_test_results, "SteamMachine" as string],
			[game.os_test_results, "SteamOS" as string],
			[game.frame_test_results, "SteamFrame" as string]
		] as const;
		const machineAndFrame = [
			[game.machine_test_results, "SteamMachine" as string],
			[game.frame_test_results, "SteamFrame" as string]
		] as const;

		// Only on Xbox and Xbox 360 the glyphs do match
		if(isXemuGame(launchCommand) || isXeniaGame(launchCommand)){
			game.deck_test_results!.push({
				test_loc_token: '#SteamDeckVerified_TestResult_ControllerGlyphsMatchDeckDevice',
				test_result: SteamTestResult.Verified
			});
			machineAndFrame.forEach(([results, cat]) => {
				results.push(
					{
						test_loc_token: `#${cat}_TestResult_ControllerGlyphsMatchDevice`,
						test_result: SteamTestResult.Verified
					}
				);
			});
		}
		else{
			game.deck_test_results.push({
				test_loc_token: '#SteamDeckVerified_TestResult_ControllerGlyphsDoNotMatchDeckDevice',
				test_result: SteamTestResult.Playable
			});
			machineAndFrame.forEach(([results, cat]) => {
				results.push(
					{
						test_loc_token: `#${cat}_TestResult_ControllerGlyphsDoNotMatchDevice`,
						test_result: SteamTestResult.Playable
					}
				);
			});
		}

		// Controller works on:
		// PS1, PS2, PS3, PS4, PSP, PS Vita
		// Xbox, Xbox 360
		// N64
		// Dreamcast
		// Note: GameCube also has controller but we cannot detect it from Dolphin here (or maybe we could retrieve the id6)
		if(isDuckstationGame(launchCommand) || isPCSX2Game(launchCommand) || isRPCS3Game(launchCommand) || isShadPS4Game(launchCommand) ||
				isPPSSPPGame(launchCommand) || isVita3KGame(launchCommand) ||
			isXemuGame(launchCommand) || isXeniaGame(launchCommand) ||
			isRosaliesMupenGUIGame(launchCommand) ||
			isFlycastGame(launchCommand)){

			deckMachineAndFrame.forEach(([results, cat]) => {
				results.push(
					{
						test_loc_token: `#${cat}_TestResult_DefaultControllerConfigFullyFunctional`,
						test_result: SteamTestResult.Verified
					}
				);
			});
		}
		else{
			deckMachineOSAndFrame.forEach(([results, cat]) => {
				results.push(
					{
						test_loc_token: `#${cat}_TestResult_DefaultControllerConfigNotFullyFunctional`,
						test_result: SteamTestResult.Playable
					}
				);
			});
		}

		// Default configuration works fine for playable games
		if(game.deck_compat_category === SteamDeckCompatCategory.VERIFIED){
			deckMachineAndFrame.forEach(([results, cat]) => {
				results.push(
					{
						test_loc_token: `#${cat}_TestResult_DefaultConfigurationIsPerformant`,
						test_result: SteamTestResult.Verified
					}
				);
			});
		}

		// Portable consoles should have correct interface text size on Deck
		if(isPPSSPPGame(launchCommand) || isVita3KGame(launchCommand) || isMelonDSGame(launchCommand) || isMGBAGame(launchCommand) || isRyujinxGame(launchCommand)){
			game.deck_test_results.push({
				test_loc_token: '#SteamDeckVerified_TestResult_InterfaceTextIsLegible',
				test_result: SteamTestResult.Verified
			});
		}

		// Only PS3, PS4, Xbox 360 and Switch should have the correct deck resolution
		if(!isRPCS3Game(launchCommand) && !isShadPS4Game(launchCommand) && !isXeniaGame(launchCommand) && !isRyujinxGame(launchCommand)){
			game.deck_test_results.push({
				test_loc_token: '#SteamDeckVerified_TestResult_NativeResolutionNotDefault',
				test_result: SteamTestResult.Playable
			});
		}
	}

	protected override async getAllCompatdataForGame(appId: number): Promise<CompatdataData[]>{
		if (this.overrides[appId] === 0)
			return [];

		const details = await getAppDetails(appId);
		if(!details)
			return [];

		const display_name = details.strDisplayName;
		const console_names = await this.getConsoleNames(appId);
		return await this.search(display_name, console_names);
	}

	override icon = <FaGamepad/>;
}