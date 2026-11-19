import {getFrontEndSystem, getLaunchCommand, isEmulatedGame, isPCSX2Game, romRegex} from "../../../shortcuts";
import {getAppDetails} from "../../../util";
import { call } from "@decky/api";
import { MultiIdSerialStationResolver, type MultiIdSerialStationResolverCache, type MultiIdSerialStationResolverConfig } from "./MultiIdSerialStationResolver";
import { SiPlaystation2 } from "react-icons/si";

export interface MultiIdPCSX2ResolverConfig extends MultiIdSerialStationResolverConfig{
	
}

export interface MultiIdPCSX2ResolverCache extends MultiIdSerialStationResolverCache{

}

export class MultiIdPCSX2Resolver extends MultiIdSerialStationResolver<"pcsx2">{
	identifier = "pcsx2" as const;

	async test(appId: number): Promise<boolean>{
		const details = await getAppDetails(appId);
		if (!details)
			return false;

		const launchCommand = getLaunchCommand(details);
		// Also PS2 games launched by RetroDECK / ES-DE (PCSX2 there too): the serial comes from PCSX2's game list
		return isPCSX2Game(launchCommand) || (isEmulatedGame(launchCommand) && getFrontEndSystem(launchCommand) === "ps2");
	}

	protected async retrieveTitleId(appId: number): Promise<string | undefined> {
		const details = await getAppDetails(appId);
		if (!details)
			return undefined;
		const launchCommand = getLaunchCommand(details);

		const rom = launchCommand.match(romRegex)?.[0];
		if(!rom)
			return undefined;

		return await call<[string], string | null>("pcsx2_get_titleid", rom) ?? undefined;
	}

	override icon = <SiPlaystation2/>;
}