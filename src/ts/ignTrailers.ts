// IGN trailers, for games without a Steam trailer (trailers.ts).
// The game is found on IGN by its exact title (and the ROM's console, when known), and its trailer among IGN's
// trailers of it by the video's title, with the rules of Decky Metadata v0.6.4 (backend-rust/src/providers/ign.rs,
// find_trailer and trailer_title_score) by beallio:
//   https://github.com/beallio/Decky-Metadata
// Licensed under the GNU General Public License v3.0 or later. See NOTICE.
// Differences: the trailers and their MP4 files come from IGN's GraphQL API (the game's "Trailers" feed) instead of
// its web pages, console names may come before the game's title ("Nintendo Switch Online: Nintendo 64 - Official
// Banjo-Kazooie Trailer"), and merchandise and mods are rejected too.

import { graphql } from "./modules/metadata/IgnSearch";
import { sameTitle, titleWords } from "./titleSearch";
import {
	getFrontEndSystem, getLaunchCommand, isCemuGame, isDuckstationGame, isEmulatedGame, isFlycastGame, isMelonDSGame,
	isPCSX2Game, isPPSSPPGame, isRosaliesMupenGUIGame, isRPCS3Game, isRyujinxGame, isShadPS4Game, isVita3KGame,
	isXemuGame, isXeniaGame
} from "./shortcuts";
import { getAppDetails } from "./util";

export type IgnTrailer = { name: string; mp4: string };

// ES-DE/RetroDECK systems (and EmuDeck "roms" folders) to IGN platform names
const SYSTEM_PLATFORMS: Record<string, string> = {
	psx: "PlayStation", ps2: "PlayStation 2", ps3: "PlayStation 3", ps4: "PlayStation 4", psp: "PlayStation Portable",
	psvita: "PlayStation Vita", n64: "Nintendo 64", gc: "GameCube", wii: "Wii", wiiu: "Wii U", switch: "Nintendo Switch",
	nds: "Nintendo DS", n3ds: "Nintendo 3DS", "3ds": "Nintendo 3DS", gb: "Game Boy", gbc: "Game Boy Color",
	gba: "Game Boy Advance", nes: "NES", famicom: "NES", snes: "Super Nintendo Entertainment System",
	sfc: "Super Nintendo Entertainment System", genesis: "Genesis", megadrive: "Genesis", mastersystem: "Master System",
	sega32x: "Sega 32X", segacd: "Sega CD", megacd: "Sega CD", saturn: "Saturn", dreamcast: "Dreamcast",
	tg16: "TurboGrafx-16", pcengine: "TurboGrafx-16", xbox: "Xbox", xbox360: "Xbox 360"
};

/** The console of an emulated game, as IGN names it; undefined for other games */
async function ignPlatform(appId: number): Promise<string | undefined>{
	const details = await getAppDetails(appId);
	const launchCommand = details ? getLaunchCommand(details) : "";
	if (!launchCommand || !isEmulatedGame(launchCommand))
		return undefined;
	const system = getFrontEndSystem(launchCommand);
	if (system)
		return SYSTEM_PLATFORMS[system];
	const emulators: [(command: string) => boolean, string][] = [
		[isDuckstationGame, "psx"], [isPCSX2Game, "ps2"], [isRPCS3Game, "ps3"], [isShadPS4Game, "ps4"], [isPPSSPPGame, "psp"],
		[isVita3KGame, "psvita"], [isRosaliesMupenGUIGame, "n64"], [isCemuGame, "wiiu"], [isRyujinxGame, "switch"],
		[isMelonDSGame, "nds"], [isFlycastGame, "dreamcast"], [isXemuGame, "xbox"], [isXeniaGame, "xbox360"]
	];
	const emulator = emulators.find(([test]) => test(launchCommand));
	return emulator ? SYSTEM_PLATFORMS[emulator[1]] : undefined;
}

type IgnGame = { slug: string; titles: string[] };

/** The IGN game with exactly this title (on this console): none when there are several */
async function findGame(title: string, platform?: string): Promise<IgnGame | undefined>{
	const data = await graphql(`
		query SearchObjectsByName($name: String!, $count: Int!, $type: ObjectType!) {
			searchObjectsByName(name: $name, count: $count, type: $type) {
				edges { node { slug metadata { names { name short alt } } objectRegions { releases { platformAttributes { name } } } } }
			}
		}`, { name: title, count: 10, type: "Game" });
	const games = (data?.searchObjectsByName?.edges ?? [])
		.map((edge: any) => edge?.node)
		.filter((node: any) => node?.slug)
		.map((node: any) => ({
			slug: String(node.slug),
			titles: [node.metadata?.names?.name, node.metadata?.names?.short, ...(node.metadata?.names?.alt ?? [])]
				.filter((name: unknown): name is string => typeof name === "string" && !!name.trim()),
			platforms: new Set<string>((node.objectRegions ?? [])
				.flatMap((region: any) => region?.releases ?? [])
				.flatMap((release: any) => release?.platformAttributes ?? [])
				.map((platform: any) => platform?.name))
		}))
		.filter((game: { titles: string[]; platforms: Set<string> }) =>
			game.titles.some((name) => sameTitle(title, name)) && (!platform || game.platforms.has(platform)));
	return games.length === 1 ? games[0] : undefined;
}

// Words a trailer's title may have before the game's title, and that make it a trailer of something else
const ALLOWED_BEFORE = new Set([
	"ign", "official", "launch", "story", "gameplay", "reveal", "teaser", "cinematic", "announcement", "debut",
	"trailer", "red", "band", "extended", "final", "new", "first", "look", "world", "premiere", "video", "hd", "k",
	"for", "the",
	// Consoles: "Nintendo Switch Online: Nintendo 64 - Official Banjo-Kazooie Trailer"
	"nintendo", "switch", "online", "playstation", "ps", "psp", "vita", "xbox", "one", "pc", "steam", "wii", "u",
	"gamecube", "ds", "game", "boy", "advance", "color", "dreamcast", "saturn", "genesis", "sega"
]);
const REJECTED = new Set([
	"analysis", "behind", "breakdown", "commercial", "developer", "documentary", "dlc", "edition", "expansion",
	"feature", "guide", "interview", "lore", "making", "news", "patch", "pinball", "plus", "podcast", "promo",
	"promotional", "recap", "remaster", "remastered", "review", "roundtable", "scenes", "stream", "update",
	"walkthrough", "movie", "film", "machine", "booster", "pass", "holiday", "holidays", "collection", "and",
	// Merchandise and mods in IGN's trailers of a game
	"statue", "figure", "figures", "mod", "mods", "sneak", "peek"
]);
// Numbers allowed after these words ("Nintendo 64", "Xbox 360", "Part 2", "v2") and before these ("4K", "3DS")
const NUMBER_AFTER = new Set(["nintendo", "xbox", "playstation", "ps", "switch", "part", "v"]);
const NUMBER_BEFORE = new Set(["k", "ds"]);

const trailerWords = (text: string) => titleWords(text.replace(/&/g, " and "));

/** How surely a video is a trailer of the game (higher is better), undefined when it is not */
export function trailerTitleScore(gameTitle: string, videoTitle: string): number | undefined{
	const game = trailerWords(gameTitle);
	while (["the", "a", "an"].includes(game[0]))
		game.shift();
	const video = trailerWords(videoTitle);
	while (["the", "a", "an"].includes(video[0]))
		video.shift();
	if (video[video.length - 1] === "ign")
		video.pop();
	if (!game.length || !video.length)
		return undefined;

	const start = video.findIndex((_, i) => game.every((word, j) => video[i + j] === word));
	if (start < 0)
		return undefined;
	const before = video.slice(0, start);
	const surrounding = [...before, ...video.slice(start + game.length)];
	if (!surrounding.length || surrounding.some((word) => REJECTED.has(word)))
		return undefined;
	if (before.some((word) => !ALLOWED_BEFORE.has(word) && !/^[0-9]+$/.test(word)))
		return undefined;
	if (!surrounding.some((word) => word === "trailer" || word === "teaser"))
		return undefined;
	// Other numbers are other games: sequels, years, "E3"
	const strayNumber = surrounding.some((word, i) => /^[0-9]+$/.test(word) &&
		!NUMBER_AFTER.has(surrounding[i - 1]) && !NUMBER_BEFORE.has(surrounding[i + 1]));
	if (strayNumber)
		return undefined;

	const has = (word: string) => surrounding.includes(word);
	return (has("trailer") ? 50 : 35) + (has("official") ? 20 : 0) + (has("launch") ? 20 : 0) + (has("gameplay") ? 15 : 0)
		+ (has("story") ? 12 : 0) + (has("reveal") ? 10 : 0) + (has("cinematic") ? 5 : 0);
}

/** The 720p file, or the closest one */
function chooseAsset(assets: any[]): string | undefined{
	const files = (assets ?? [])
		.filter((asset) => typeof asset?.url === "string" && /^https:\/\/assets[0-9]*\.ign\.com\/.+\.mp4(\?|$)/i.test(asset.url)
			&& typeof asset.height === "number")
		.sort((a, b) => a.height - b.height);
	return (files.find((asset) => asset.height >= 720) ?? files[files.length - 1])?.url;
}

const trailers = new Map<string, Promise<IgnTrailer | null>>();

/** The best IGN trailer of an app's game, by its title */
export function ignTrailer(appId: number, title: string): Promise<IgnTrailer | null>{
	const clean = title.replace(/(\s*[([][^)\]]*[)\]])+\s*$/, "").trim(); // "Resident Evil 2 (Leon Kennedy Disc)"
	const key = `${appId}:${clean}`;
	let trailer = trailers.get(key);
	if (!trailer){
		trailer = (async () => {
			if (!clean)
				return null;
			const game = await findGame(clean, await ignPlatform(appId));
			if (!game)
				return null;
			const data = await graphql(`
				query ObjectTrailers($slug: String!) {
					objectSelectByTypeAndSlug(type: Game, slug: $slug, state: Published) {
						contentFeed(filter: Trailers, count: 20) {
							feedItems { ... on ModernVideo { content { title } assets { url height } } }
						}
					}
				}`, { slug: game.slug });
			let best: { score: number; trailer: IgnTrailer } | undefined;
			for (const item of data?.objectSelectByTypeAndSlug?.contentFeed?.feedItems ?? []){
				const name = String(item?.content?.title ?? "");
				const scores = game.titles.slice(0, 2).map((gameTitle) => trailerTitleScore(gameTitle, name) ?? -1);
				const score = Math.max(...scores);
				const mp4 = score >= 0 ? chooseAsset(item?.assets) : undefined;
				// Newest first: the newest of the best ones
				if (mp4 && (!best || score > best.score))
					best = { score, trailer: { name, mp4 } };
			}
			return best?.trailer ?? null;
		})();
		trailers.set(key, trailer);
		trailer.catch(() => trailers.delete(key)); // Retried on the next visit
	}
	return trailer;
}
