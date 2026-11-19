// Steam Deck compatibility of the Steam app matched to a shortcut ("Find a Steam Match" on the
// "Change Metadata" page): Valve's own rating and test results, for every device.
// Uses the same store report as Decky Metadata v0.6.4 (backend-rust/src/providers/steam.rs) by beallio:
//   https://github.com/beallio/Decky-Metadata
// Licensed under the GNU General Public License v3.0 or later. See NOTICE.
//
// It comes first among the compatibility providers, so a Steam match replaces MetaDeck's
// compatibility; excluding an app from this provider keeps MetaDeck's (emulator lists...).

import { CompatdataData, SteamDeckCompatCategory, SteamTestResult } from "../../../Interfaces";
import { t } from "../../../useTranslations";
import Logger from "../../../logger";
import type { ProviderConfig, ProviderCache } from "../../Provider";
import { CompatdataProvider } from "../CompatdataProvider";
import { FaSteam } from "react-icons/fa";
import { fetchNoCorsLegacyTimeout } from "../../../util";

export interface SteamMatchCompatdataProviderConfig extends ProviderConfig{
}

export interface SteamMatchCompatdataProviderCache extends ProviderCache{
}

type ReportItem = {
	display_type?: number; // Same values as SteamTestResult
	loc_token?: string;
};

function category(value: unknown): SteamDeckCompatCategory | undefined {
	const number = Number(value);
	return Number.isInteger(number) && number >= SteamDeckCompatCategory.UNKNOWN && number <= SteamDeckCompatCategory.VERIFIED ?
		number as SteamDeckCompatCategory :
		undefined;
}

function testResults(items: unknown): NonNullable<CompatdataData["deck_test_results"]> {
	return (Array.isArray(items) ? items as ReportItem[] : [])
		.filter((item) => item?.loc_token)
		.map((item) => ({
			test_loc_token: item.loc_token!,
			test_result: (item.display_type ?? SteamTestResult.Unknown) as SteamTestResult
		}));
}

export class SteamMatchCompatdataProvider extends CompatdataProvider<any>{
	identifier = "steam_match" as const;
	title = t("providerCompatdataSteamMatch");

	logger = new Logger(this.identifier);

	private steamMatch(appId: number): number | undefined{
		return this.state.modules.metadata.getSteamMatch(appId);
	}

	// No resolvers: any app with a Steam match
	override async test(appId: number, external = false): Promise<boolean>{
		if (!external && this.excludedApps.includes(appId))
			return false;
		return !!this.steamMatch(appId);
	}

	async provide(appId: number): Promise<CompatdataData | undefined>{
		const steamAppId = this.steamMatch(appId);
		if (!steamAppId)
			return undefined;

		const response = await fetchNoCorsLegacyTimeout(
			`https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${steamAppId}&l=english`);
		if (!response.ok)
			return undefined;

		const report = JSON.parse(await response.text());
		const results = report?.success ? report.results : undefined;
		const deck = category(results?.resolved_category);
		// Not rated by Valve: let the other providers try
		if (deck === undefined || deck === SteamDeckCompatCategory.UNKNOWN)
			return undefined;

		return {
			title: String(steamAppId),
			id: steamAppId,

			deck_compat_category: deck,
			machine_compat_category: category(results.machine_resolved_category),
			os_compat_category: category(results.steamos_resolved_category),
			frame_compat_category: category(results.frame_resolved_category),

			deck_test_results: testResults(results.resolved_items),
			machine_test_results: testResults(results.machine_resolved_items),
			os_test_results: testResults(results.steamos_resolved_items),
			frame_test_results: testResults(results.frame_resolved_items)
		};
	}

	override icon = <FaSteam/>;
}
