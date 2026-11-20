// Game trailers on a game's page, over its header artwork: the Steam trailer of a Steam game, or of the Steam game
// matched to a shortcut ("Find a Steam Match" on the "Change Metadata" page), else an IGN trailer of the game found by
// its title (ignTrailers.ts). The artwork stays when there is none.
//
// Ported from Decky Metadata v0.6.4 (src/trailers) by beallio:
//   https://github.com/beallio/Decky-Metadata
// Licensed under the GNU General Public License v3.0 or later. See NOTICE.
// Its Detail view is kept (fade-in delay, audio fading in, hidden logo, X to mute, Y to enlarge, stopped on launch);
// the player differs: Steam's trailers are DASH or HLS streams only, which Decky Metadata plays with its own
// player, while this uses Steam's (the one of its game recordings).

import { appDetailsHeaderClasses, findModuleExport, Router } from "@decky/ui";
import type { MetaDeckState } from "./MetaDeckState";
import type { Mountable } from "./System";
import { matchedApp } from "./steamMatchFeatures";
import { ignTrailer } from "./ignTrailers";
import { SteamAppTypeShortcut } from "./Interfaces";
import { fetchNoCorsLegacyTimeout } from "./util";
import { t } from "./useTranslations";
import { defaultTrailerSettings, type TrailerSettings } from "./trailerSettings";
import Logger from "./logger";

const logger = new Logger("trailers");

const STEAM_APP_TYPE_GAME = 1;

// Buttons of Steam's "vgp_onbuttondown" events (Steam Deck/Xbox names)
const BUTTON_B = 2;
const BUTTON_X = 3;
const BUTTON_Y = 4;

const FADE_MS = 800;

type Trailer = { name: string; dash?: string; mp4?: string }; // A DASH stream (Steam) or an MP4 file (IGN)

const trailers = new Map<number, Promise<Trailer | null>>(); // By Steam app

/** A Steam game's trailer: the highlighted one, else the first one */
function steamTrailer(steamAppId: number): Promise<Trailer | null>{
	let trailer = trailers.get(steamAppId);
	if (!trailer){
		trailer = (async () => {
			const response = await fetchNoCorsLegacyTimeout(`https://store.steampowered.com/api/appdetails?appids=${steamAppId}&filters=movies`);
			if (!response.ok)
				throw Error(`Steam trailers of ${steamAppId} failed (${response.status})`);
			const json = await response.json();
			const movies: any[] = json?.[steamAppId]?.data?.movies ?? [];
			const movie = movies.find((movie) => movie?.highlight && movie.dash_h264) ?? movies.find((movie) => movie?.dash_h264);
			return movie ? { name: String(movie.name ?? ""), dash: String(movie.dash_h264) } : null;
		})();
		trailers.set(steamAppId, trailer);
		trailer.catch(() => trailers.delete(steamAppId)); // Retried on the next visit
	}
	return trailer;
}

/** The Steam game whose trailer a page shows: itself, or the one matched to a shortcut */
function trailerSource(state: MetaDeckState, appId: number): number | undefined{
	if (appStore.GetAppOverviewByAppID(appId)?.app_type === STEAM_APP_TYPE_GAME)
		return appId;
	return matchedApp(state, appId);
}

/** A page's trailer: the Steam one, else IGN's by the game's title (not for software, nor for apps MetaDeck leaves out) */
async function findTrailer(state: MetaDeckState, appId: number): Promise<{ trailer: Trailer; source: string } | undefined>{
	const steamAppId = trailerSource(state, appId);
	if (steamAppId){
		const trailer = await steamTrailer(steamAppId).catch((e) => {
			logger.debug(`Steam trailers of ${steamAppId} failed`, e);
			return null;
		});
		if (trailer)
			return { trailer, source: `Steam app ${steamAppId}` };
	}

	const overview = appStore.GetAppOverviewByAppID(appId);
	const metadata = state.modules.metadata;
	if (overview?.app_type === SteamAppTypeShortcut &&
		(!metadata?.isValid || metadata.excludedApps.includes(appId) || metadata.isSoftware(appId)))
		return undefined;
	if (overview?.app_type !== STEAM_APP_TYPE_GAME && overview?.app_type !== SteamAppTypeShortcut)
		return undefined;
	const trailer = await ignTrailer(appId, overview.display_name).catch((e) => {
		logger.debug(`IGN trailers of ${appId} failed`, e);
		return null;
	});
	return trailer ? { trailer, source: "IGN" } : undefined;
}

/** The game page's app: "/library/app/<appid>", not its subpages */
function pageApp(pathname: string | undefined): number | undefined{
	const appId = Number(pathname?.match(/^\/library\/app\/(\d+)\/?$/)?.[1]);
	return appId > 0 ? appId : undefined;
}

const mainWindow = () => Router?.WindowStore?.GamepadUIMainWindowInstance as any;

/** The visible header artwork of the game page */
function findHeader(doc: Document): HTMLElement | undefined{
	const headers = [...doc.querySelectorAll<HTMLElement>(`.${appDetailsHeaderClasses.HeaderBackgroundImage}`)];
	return headers.reverse().find((header) => header.offsetWidth > 0 && header.offsetHeight > 0);
}

/** One trailer on one game page */
class Playback{
	readonly appId: number;
	private readonly settings: TrailerSettings;
	private readonly doc: Document;
	private readonly container: HTMLDivElement;
	private readonly video: HTMLVideoElement;
	private readonly player?: any; // Steam's DASH player, for Steam trailers
	private readonly timers: number[] = [];
	private readonly hints: HTMLElement[] = [];
	private header: HTMLElement;
	private ready = false;
	private due = false;
	private hiddenLogos: HTMLElement[] = [];
	private closed = false;
	shown = false;
	enlarged = false;

	constructor(Player: any, appId: number, header: HTMLElement, trailer: Trailer, settings: TrailerSettings, showAt: number, private readonly onEnd: () => void){
		this.appId = appId;
		this.settings = settings;
		this.header = header;
		this.doc = header.ownerDocument;

		this.container = this.doc.createElement("div");
		this.container.className = "metadeck-trailer";
		Object.assign(this.container.style, {
			position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none",
			opacity: "0", transition: `opacity ${FADE_MS}ms ease`, background: "black"
		});
		this.video = this.doc.createElement("video");
		this.video.muted = true;
		this.video.playsInline = true;
		Object.assign(this.video.style, { width: "100%", height: "100%", objectFit: "cover", display: "block" });
		this.container.appendChild(this.video);
		header.appendChild(this.container);

		this.video.addEventListener("canplay", () => {
			this.ready = true;
			this.reveal();
		});
		for (const event of ["ended", "error", "valve-ended", "valve-playbackerror", "valve-downloadfailed"])
			this.video.addEventListener(event, () => this.finish(event));

		if (trailer.dash){
			// Steam's player: buffers paused, plays when shown, picks the quality from the video's size
			this.player = new Player(this.video);
			this.player.SetUserPlayChoice(false);
			this.player.SetMuteOnAutoplayBlocked?.(true);
			this.player.PlayMPD(trailer.dash);
		}
		else{
			this.video.preload = "auto";
			this.video.src = trailer.mp4!;
		}

		this.timers.push(window.setTimeout(() => {
			this.due = true;
			this.reveal();
		}, Math.max(0, showAt - Date.now())));
		// Steam may render the page again: back into its new header
		this.timers.push(window.setInterval(() => this.keepAttached(), 500));
	}

	private reveal(): void{
		if (this.closed || this.shown || !this.ready || !this.due)
			return;
		this.shown = true;
		this.play();
		this.container.style.opacity = "1";
		if (this.settings.hide_logo){
			this.hiddenLogos = [...this.doc.querySelectorAll<HTMLElement>(`.${appDetailsHeaderClasses.TitleImageContainer}`)];
			for (const logo of this.hiddenLogos){
				logo.style.transition = `opacity ${FADE_MS}ms ease`;
				logo.style.opacity = "0";
			}
		}
		if (this.settings.audio)
			this.fadeInAudio();
		this.showHints();
	}

	private fadeInAudio(): void{
		this.video.volume = 0;
		this.video.muted = false;
		const start = Date.now();
		const step = window.setInterval(() => {
			const progress = Math.min(1, (Date.now() - start) / 1000);
			this.video.volume = progress;
			if (progress >= 1)
				window.clearInterval(step);
		}, 50);
		this.timers.push(step);
	}

	toggleMute(): void{
		this.video.muted = !this.video.muted;
		if (!this.video.muted)
			this.video.volume = 1;
		this.showHints();
	}

	/** Full screen above the page, or back over the artwork */
	toggleEnlarged(): void{
		this.enlarged = !this.enlarged;
		Object.assign(this.container.style, this.enlarged
			? { position: "fixed", zIndex: "10000" }
			: { position: "absolute", zIndex: "" });
		this.video.style.objectFit = this.enlarged ? "contain" : "cover";
		// Fixed to the window, out of the page's scrolling and transforms
		(this.enlarged ? this.doc.body : this.header).appendChild(this.container);
		this.showHints();
	}

	private keepAttached(): void{
		if (this.shown && this.hints.some((hint) => !hint.isConnected))
			this.showHints();
		if (this.enlarged || this.container.parentElement?.isConnected)
			return;
		const header = findHeader(this.doc);
		if (!header)
			return;
		this.header = header;
		header.appendChild(this.container);
		if (this.shown)
			this.play();
	}

	private play(): void{
		if (this.player)
			this.player.Play();
		else
			this.video.play().catch((e) => logger.debug(`Trailer of ${this.appId} did not play`, e));
	}

	/** X and Y in Steam's footer, beside its own actions */
	private showHints(): void{
		const footer = this.doc.querySelector<HTMLElement>("#Footer > div");
		const template = [...(footer?.children ?? [])].find((hint) =>
			hint.querySelector("img[src*='shared_button_a']")) as HTMLElement | undefined;
		this.hints.forEach((hint) => hint.remove());
		this.hints.length = 0;
		if (!footer || !template || this.closed)
			return;
		const actions: [string, string][] = [
			["shared_button_y", this.enlarged ? t("trailerShrink") : t("trailerEnlarge")],
			["shared_button_x", this.video.muted ? t("trailerUnmute") : t("trailerMute")]
		];
		for (const [glyph, label] of actions){
			const hint = template.cloneNode(true) as HTMLElement;
			const image = hint.querySelector("img");
			image?.setAttribute("src", image.getAttribute("src")!.replace("shared_button_a", glyph));
			image?.setAttribute("aria-label", glyph === "shared_button_x" ? "X Button" : "Y Button");
			const text = hint.children[hint.children.length - 1];
			if (text)
				text.textContent = label;
			hint.dataset.metadeckTrailer = "";
			footer.insertBefore(hint, template);
			this.hints.push(hint);
		}
	}

	/** The trailer ended or failed: the artwork comes back */
	private finish(reason: string): void{
		if (this.closed)
			return;
		if (reason !== "ended" && reason !== "valve-ended")
			logger.debug(`Trailer of ${this.appId} stopped: ${reason}`);
		this.onEnd();
	}

	close(): void{
		if (this.closed)
			return;
		this.closed = true;
		this.timers.forEach((timer) => window.clearTimeout(timer)); // Intervals too: they share their IDs
		this.hints.forEach((hint) => hint.remove());
		for (const logo of this.hiddenLogos)
			logo.style.opacity = "";
		try{
			if (this.player)
				this.player.Close();
			else{
				this.video.pause();
				this.video.removeAttribute("src");
				this.video.load(); // Stops the download
			}
		}
		catch (e){
			logger.debug("Trailer player close failed", e);
		}
		const container = this.container;
		if (this.shown && !this.enlarged && container.isConnected){
			container.style.opacity = "0";
			window.setTimeout(() => container.remove(), FADE_MS);
		}
		else
			container.remove();
	}
}

let instance: Trailers | undefined;

/** The trailer settings were changed: the current page follows them */
export function onTrailerSettingsChange(): void{
	instance?.restart();
}

export class Trailers implements Mountable{
	private readonly state: MetaDeckState;
	private Player: any;
	private playback?: Playback;
	private visit = 0; // A newer page visit cancels the work of an older one
	private doc?: Document;
	private unlisten?: () => void;
	private unregisters: (() => void)[] = [];

	constructor(state: MetaDeckState){
		this.state = state;
	}

	private get settings(): TrailerSettings{
		return { ...defaultTrailerSettings, ...this.state.settings.config.trailers };
	}

	mount(): void{
		instance = this;
		this.Player = findModuleExport((e: any) => typeof e === "function" &&
			typeof e.prototype?.PlayMPD === "function" && typeof e.prototype?.SetUserPlayChoice === "function" && typeof e.prototype?.Close === "function");
		const steamWindow = mainWindow();
		const history = steamWindow?.m_history;
		this.doc = steamWindow?.m_BrowserWindow?.document;
		if (!this.Player || !history?.listen || !this.doc){
			logger.error("Steam's video player or game pages not found: no trailers");
			return;
		}

		this.unlisten = history.listen((location: { pathname: string }) => this.onPage(location.pathname));
		// Stopped when a game starts, and while Steam is hidden behind one
		const actionStart = SteamClient.Apps.RegisterForGameActionStart?.(() => this.stop());
		const lifetime = SteamClient.GameSessions.RegisterForAppLifetimeNotifications((update: { bRunning: boolean }) => {
			if (update.bRunning)
				this.stop();
		});
		this.unregisters.push(() => actionStart?.unregister(), () => lifetime?.unregister());
		const onVisibility = () => this.doc!.hidden ? this.stop() : this.onPage(history.location?.pathname);
		const onButton = (event: Event) => this.onButton(event as CustomEvent);
		this.doc.addEventListener("visibilitychange", onVisibility);
		this.doc.addEventListener("vgp_onbuttondown", onButton, true);
		this.unregisters.push(
			() => this.doc?.removeEventListener("visibilitychange", onVisibility),
			() => this.doc?.removeEventListener("vgp_onbuttondown", onButton, true)
		);
		this.onPage(history.location?.pathname);
	}

	dismount(): void{
		this.stop();
		this.unlisten?.();
		this.unregisters.forEach((unregister) => unregister());
		this.unregisters = [];
		if (instance === this)
			instance = undefined;
	}

	/** Again on the current page, with the current settings */
	restart(): void{
		this.stop();
		this.onPage(mainWindow()?.m_history?.location?.pathname);
	}

	private stop(): void{
		this.visit++;
		this.playback?.close();
		this.playback = undefined;
	}

	private onPage(pathname: string | undefined): void{
		const appId = pageApp(pathname);
		if (appId !== undefined && appId === this.playback?.appId)
			return;
		this.stop();
		if (appId !== undefined && this.settings.enabled && !this.doc?.hidden)
			void this.start(appId, this.visit);
	}

	private async start(appId: number, visit: number): Promise<void>{
		const settings = this.settings;
		const showAt = Date.now() + Math.max(0, settings.delay) * 1000;
		const found = await findTrailer(this.state, appId);
		if (!found || visit !== this.visit)
			return;
		const { trailer, source } = found;

		// The page may still be appearing
		let header: HTMLElement | undefined;
		for (let attempt = 0; attempt < 50 && visit === this.visit; attempt++){
			header = findHeader(this.doc!);
			if (header)
				break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		if (!header || visit !== this.visit)
			return;

		logger.debug(`Trailer of ${appId} (${source}): ${trailer.name}`);
		this.playback = new Playback(this.Player, appId, header, trailer, settings, showAt, () => {
			if (visit === this.visit)
				this.stop();
		});
	}

	private onButton(event: CustomEvent): void{
		const playback = this.playback;
		const detail = event.detail ?? {};
		if (!playback?.shown || detail.is_repeat)
			return;
		if (mainWindow()?.m_MenuStore?.IsAnySideMenuVisible?.())
			return;
		// Menus, dialogs and text fields keep their buttons
		const target = event.target as HTMLElement | null;
		if (target?.closest?.("input, textarea, select, [contenteditable], [role='dialog'], [role='menu']"))
			return;
		if ([...this.doc!.querySelectorAll<HTMLElement>("[role='dialog'], [role='menu']")].some((element) => element.offsetWidth > 0))
			return;

		switch (detail.button){
			case BUTTON_X:
				playback.toggleMute();
				break;
			case BUTTON_Y:
				playback.toggleEnlarged();
				break;
			case BUTTON_B:
				if (!playback.enlarged)
					return;
				playback.toggleEnlarged();
				break;
			default:
				return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
	}
}
