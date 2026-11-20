// Shows Steam's own mini achievement stat beside Play Time on the game page.
// The Gaming Mode game page passes no onSeek, and Valve's MiniAchievements row
// renders nothing without it (ValveSoftware/steam-for-linux#13540), so one is
// supplied here. Shortcuts get it too, so achievements provided by MetaDeck
// (RetroAchievements, RPCS3, Xenia...) show up in the same row.
//
// Ported from Decky Metadata v0.6.4 (src/steam/miniAchievements.ts) by beallio,
// which derives from Decky UI Restored by beallio:
//   https://github.com/beallio/Decky-Metadata
//   https://github.com/beallio/Decky-UI-Restored
// Licensed under the GNU General Public License v3.0 or later. See NOTICE.

import { routerHook } from "@decky/api";
import { afterPatch, findClassModule, findInReactTree } from "@decky/ui";
import Logger from "../../logger";

const logger = new Logger("miniAchievements");

// ES2021 (the project targets ES2020); Steam's CEF provides it at runtime.
declare class WeakRef<T extends object> {
	constructor(target: T);
	deref(): T | undefined;
}

const GAME_DETAIL_ROUTES = [
	"/library/app/:appid",
	"/library/details/:appid",
	"/library/:collection/app/:appid",
];

const CAPTURE_RETRY_DELAYS_MS = [0, 50, 250, 1000] as const;
const MAX_FIBER_DEPTH = 12;

type StatsInstance = {
	props?: unknown;
	forceUpdate?: () => void;
	BUserHasContentToClaim?: unknown;
};

type PatchedStats = { instance: WeakRef<StatsInstance>; raw: () => unknown };

// Valve's row only checks this for truthiness and opens My Achievements itself.
const NOOP_SEEK = (): void => {};

/** SharedJSContext does not own Big Picture's DOM: collect the real SteamUI documents. */
function steamUiDocuments(): Document[] {
	const contexts = new Set<any>([globalThis]);
	try {
		const currentWindow = globalThis as any;
		contexts.add(currentWindow.parent);
		contexts.add(currentWindow.top);
	}
	catch {
		// A cross-origin parent can still leave the SteamUI bridge usable.
	}

	const documents = new Set<Document>();
	for (const context of contexts) {
		try {
			const windowStore = context?.SteamUIStore?.m_WindowStore;
			for (const browserWindow of [
				windowStore?.MainWindowInstance?.m_BrowserWindow,
				windowStore?.GamepadUIMainWindowInstance?.m_BrowserWindow,
			]) {
				const document = browserWindow?.document;
				if (typeof document?.querySelector === "function")
					documents.add(document);
			}
		}
		catch {
			// Continue with the context documents when a Steam private field changes.
		}
	}
	for (const context of contexts) {
		const document = context?.document;
		if (typeof document?.querySelector === "function")
			documents.add(document);
	}
	return Array.from(documents);
}

// The play bar's CSS module. Looked up on use: it may not be registered when the plugin loads.
let statsClassesCache: Record<string, string> | undefined;
function statsClasses(): Record<string, string> {
	if (!statsClassesCache?.GameStatsSection) {
		try {
			const found: unknown = findClassModule((module) => module.GameStat && module.Playtime);
			if (found && typeof found === "object")
				statsClassesCache = found as Record<string, string>;
		}
		catch {
			// A failed lookup keeps the previous classes and retries on the next use.
		}
	}
	return statsClassesCache ?? {};
}

// Repeated reads must return the same object so prop comparisons stay stable.
const seekProps = new WeakMap<object, object>();

function withSeek(raw: unknown): unknown {
	if (!raw || typeof raw !== "object")
		return raw;
	if (Reflect.get(raw, "onSeek"))
		return raw;
	const cached = seekProps.get(raw);
	if (cached)
		return cached;
	const injected = { ...(raw as Record<string, unknown>), onSeek: NOOP_SEEK };
	seekProps.set(raw, injected);
	return injected;
}

/** The mounted stats component that owns a rendered section, from its fiber. */
function ownerInstance(section: unknown): StatsInstance | undefined {
	if (!section || typeof section !== "object")
		return undefined;
	const key = Object.keys(section).find(
		(name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"),
	);
	let fiber: unknown = key ? Reflect.get(section, key) : undefined;
	for (let depth = 0; fiber && typeof fiber === "object" && depth < MAX_FIBER_DEPTH; depth += 1) {
		const stateNode: unknown = Reflect.get(fiber, "stateNode");
		if (
			stateNode &&
			typeof stateNode === "object" &&
			typeof Reflect.get(stateNode, "BUserHasContentToClaim") === "function" &&
			typeof Reflect.get(stateNode, "forceUpdate") === "function"
		)
			return stateNode as StatsInstance;
		fiber = Reflect.get(fiber, "return");
	}
	return undefined;
}

function rerender(instance: StatsInstance): void {
	try {
		instance.forceUpdate?.();
	}
	catch (e) {
		logger.debug("Achievement stat rerender failed", e);
	}
}

/** Install the onSeek supply and return its disposer. */
export function installMiniAchievementsPatch(): () => void {
	const unpatchers: Array<() => void> = [];
	const patched = new WeakSet<StatsInstance>();
	const patchedStats = new Set<PatchedStats>();
	let observer: MutationObserver | undefined;
	let observedSection: unknown;
	let captureTimer: ReturnType<typeof setTimeout> | undefined;
	let captureAttempt = 0;
	let disposed = false;

	const patchInstance = (instance: StatsInstance): void => {
		if (patched.has(instance))
			return;
		// React owns this property; if it is not reassignable the accessor cannot survive.
		const descriptor = Object.getOwnPropertyDescriptor(instance, "props");
		if (!descriptor || !("value" in descriptor) || !descriptor.configurable) {
			logger.debug("Achievement stat props are not patchable");
			return;
		}
		let raw = descriptor.value;
		try {
			Object.defineProperty(instance, "props", {
				configurable: true,
				enumerable: true,
				get: () => withSeek(raw),
				set: (value: unknown) => {
					raw = value;
				},
			});
		}
		catch (e) {
			logger.debug("Achievement stat props patch failed", e);
			return;
		}
		patched.add(instance);
		patchedStats.add({ instance: new WeakRef(instance), raw: () => raw });
		rerender(instance);
	};

	const observeSection = (section: unknown): void => {
		if (section === observedSection)
			return;
		observer?.disconnect();
		observedSection = section;
		if (!section || typeof section !== "object")
			return;
		const ownerDocument = Reflect.get(section, "ownerDocument");
		const view = ownerDocument && typeof ownerDocument === "object" ? Reflect.get(ownerDocument, "defaultView") : undefined;
		const Constructor = view ? Reflect.get(view, "MutationObserver") : undefined;
		if (typeof Constructor !== "function")
			return;
		const classes = statsClasses();
		const closest = Reflect.get(section, "closest");
		const playBar = classes.PlayBar && typeof closest === "function" ? closest.call(section, `.${classes.PlayBar}`) : null;
		const scope = playBar ?? Reflect.get(section, "parentElement") ?? section;
		observer = new Constructor(() => requestSync());
		try {
			// A subtree watch survives Steam replacing the stats section itself.
			(observer as MutationObserver).observe(scope as Node, { childList: true, subtree: true });
		}
		catch {
			observer = undefined;
		}
	};

	const sync = (): boolean => {
		if (disposed)
			return true;
		try {
			const sectionClass = statsClasses().GameStatsSection;
			if (!sectionClass)
				return false;
			let found = false;
			let firstSection: unknown = undefined;
			for (const uiDocument of steamUiDocuments()) {
				let sections: ArrayLike<unknown>;
				try {
					sections = uiDocument.querySelectorAll(`.${sectionClass}`);
				}
				catch {
					continue;
				}
				const list = Array.from(sections);
				if (firstSection === undefined)
					firstSection = list[0];
				for (const section of list) {
					const instance = ownerInstance(section);
					if (!instance)
						continue;
					found = true;
					patchInstance(instance);
				}
			}
			observeSection(firstSection);
			for (const entry of patchedStats)
				if (!entry.instance.deref())
					patchedStats.delete(entry);
			return found;
		}
		catch (e) {
			logger.warn("Achievement stat sync failed", e);
			return true;
		}
	};

	const scheduleSync = (): void => {
		if (disposed || captureTimer !== undefined)
			return;
		const delay = CAPTURE_RETRY_DELAYS_MS[captureAttempt];
		if (delay === undefined)
			return;
		captureTimer = setTimeout(() => {
			captureTimer = undefined;
			if (sync() || disposed)
				return;
			captureAttempt += 1;
			scheduleSync();
		}, delay);
	};

	/** A route render replaces the page, so its retry burst starts over at once. */
	const requestSync = (): void => {
		if (disposed)
			return;
		captureAttempt = 0;
		if (captureTimer !== undefined) {
			clearTimeout(captureTimer);
			captureTimer = undefined;
		}
		scheduleSync();
	};

	requestSync();

	for (const route of GAME_DETAIL_ROUTES) {
		try {
			const patch = routerHook.addPatch(route, (tree: any) => {
				try {
					const routeProps = findInReactTree(tree, (node) => node?.renderFunc);
					if (typeof routeProps?.renderFunc === "function") {
						const renderPatch = afterPatch(routeProps, "renderFunc", (_args: unknown[], rendered: unknown) => {
							requestSync();
							return rendered;
						});
						unpatchers.push(() => renderPatch.unpatch());
					}
				}
				catch (e) {
					logger.warn("Achievement stat patch failed", e);
				}
				return tree;
			});
			unpatchers.push(() => routerHook.removePatch(route, patch));
		}
		catch (e) {
			logger.warn("Achievement stat route hook failed", e);
		}
	}

	return () => {
		if (disposed)
			return;
		disposed = true;
		observer?.disconnect();
		observer = undefined;
		observedSection = undefined;
		if (captureTimer !== undefined) {
			clearTimeout(captureTimer);
			captureTimer = undefined;
		}
		for (const entry of patchedStats) {
			const instance = entry.instance.deref();
			if (!instance)
				continue;
			try {
				// Hand the latest real props back so Valve's row hides without a reload.
				Object.defineProperty(instance, "props", {
					value: entry.raw(),
					writable: true,
					configurable: true,
					enumerable: true,
				});
			}
			catch (e) {
				logger.debug("Achievement stat props restore failed", e);
			}
			rerender(instance);
		}
		patchedStats.clear();
		for (const unpatch of unpatchers.splice(0)) {
			try {
				unpatch();
			}
			catch {
				// Steam may already have released the route.
			}
		}
	};
}
