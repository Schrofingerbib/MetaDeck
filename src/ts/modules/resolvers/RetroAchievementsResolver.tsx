import { call, fetchNoCors } from "@decky/api";
import type { ID } from "../../Interfaces";
import {
	getLaunchCommand, isCemuGame, isEmulatedGame, isRPCS3Game, isShadPS4Game, isRyujinxGame,
	isVita3KGame, isXemuGame, isXeniaGame, romRegex
} from "../../shortcuts";
import { t } from "../../useTranslations";
import { getAppDetails, toasterToast } from "../../util";
import { Resolver, type ResolverCache, type ResolverConfig } from "../Resolver";
import { version } from "@decky/pkg";
import { FaGamepad } from "react-icons/fa";
import Logger from "../../logger";

export interface RetroAchievementsResolverConfig extends ResolverConfig{

}

export interface RetroAchievementsResolverCache extends ResolverCache{
	hashes: Record<number, string>;
	// RetroAchievements ID resolved for each app's hash, so the whole hash library
	// is only needed for apps not resolved yet (or when an entry expires)
	ids?: Record<number, {
		md5: string;
		id: number;
		retrieved: number; // Date.getTime()
	}>;
}

// Resolved IDs are checked again against the hash library after this time
const RESOLVED_ID_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class RetroAchievementsResolver extends Resolver<"ra">{
	identifier = "ra" as const;
	title = t("providerAchievementsRA");

	protected logger = new Logger(this.identifier);

	private hashLibrary?: Promise<Record<string, number> | undefined>;

	get hashes(): Record<number, string | null>{
		return this.cache.hashes;
	}

	override async mount(): Promise<void> {
		// The hash library (every hash known by RetroAchievements, several MB) used to be downloaded
		// at every startup, delaying the whole mount: it's now loaded on demand, see loadHashLibrary
	}

	/** Downloads the hash library once per session, only when an app needs it */
	private loadHashLibrary(): Promise<Record<string, number> | undefined>{
		this.hashLibrary ??= (async () => {
			try{
				// DEV: check if works, if not replace with new authenticated API
				const response = await fetchNoCors("https://retroachievements.org/dorequest.php?r=hashlibrary", {
					headers: { "User-Agent": `MetaDeck/${version} (+https://github.com/Xriuk/MetaDeck)` }
				});
				if(!response.ok)
					throw new Error(`${response.status}`);

				const body = await response.text();
				return (JSON.parse(body.toLowerCase()) as { md5list: Record<string, number>; }).md5list;
			}
			catch (e: any){
				this.logger.error("Hash library download failed", e);
				toasterToast(t("initError"), this);
				// Allow retrying on the next request
				this.hashLibrary = undefined;
				return undefined;
			}
		})();
		return this.hashLibrary;
	}

	override async test(appId: number): Promise<boolean>{
		const details = await getAppDetails(appId);
		if(!details)
			return false;

		const launchCommand = getLaunchCommand(details);
		return isEmulatedGame(launchCommand) &&
			!isRPCS3Game(launchCommand) && !isShadPS4Game(launchCommand) && !isVita3KGame(launchCommand) &&
			!isXemuGame(launchCommand) && !isXeniaGame(launchCommand) &&
			!isCemuGame(launchCommand) && !isRyujinxGame(launchCommand);
	}

	async resolve(appId: number): Promise<ID | undefined>{
		const details = await getAppDetails(appId);
		if (!details)
			return undefined;

		let md5 = this.hashes[appId];
		if(!md5){
			const launchCommand = getLaunchCommand(details);
			const rom = launchCommand?.match(romRegex)?.[0];
			if(!rom)
				return undefined;
			md5 = await call<[string], string>("hash", rom);
			if(!md5 && rom.endsWith(".cue"))
				md5 = await call<[string], string>("hash", rom.substring(0, rom.length - 4) + ".bin");
			if(md5)
				this.hashes[appId] = md5;
		}
		this.logger.debug(`${appId} md5: `, md5);
		if(!md5)
			return undefined;

		const resolved = this.cache.ids?.[appId];
		const known = resolved?.md5 === md5 ? resolved : undefined;
		if(known && new Date().getTime() - known.retrieved < RESOLVED_ID_TTL_MS)
			return known.id;

		const id = (await this.loadHashLibrary())?.[md5];
		if(id){
			(this.cache.ids ??= {})[appId] = { md5, id, retrieved: new Date().getTime() };
			void this.saveCache();
		}

		// If the library couldn't be downloaded keep using the last known ID
		return id ?? known?.id;
	}

	override icon = <FaGamepad/>;
}
