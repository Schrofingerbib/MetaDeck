// Adds "Change Metadata..." to the game context menu, right before "Properties...".
//
// The way Steam's internal LibraryContextMenu is resolved and patched (outer
// render -> menu type -> menu body render/shouldComponentUpdate, and the appid
// resolution) is ported from Decky Metadata v0.6.4 (src/contextMenuPatch.tsx),
// itself derived from decky-steamgriddb by the SteamGridDB project:
//   https://github.com/beallio/Decky-Metadata
//   https://github.com/SteamGridDB/decky-steamgriddb
// Licensed under the GNU General Public License v3.0 (or later). See NOTICE.
import {FC} from "react";
import {useTranslations} from "./useTranslations";
import {
	afterPatch,
	Export,
	fakeRenderComponent,
	findInReactTree,
	findInTree,
	findModuleByExport,
	MenuItem,
	Navigation,
	Patch
} from "@decky/ui";
import {AsyncMountable} from "./System";
import Logger from "./logger";

const logger = new Logger("ContextMenu");

const ENTRY_KEY = "metadeck-change-metadata";

const MetaDeckChangeMetadata: FC<{ appId: number }> = ({appId}) =>
{
	const t = useTranslations();

	return <MenuItem
		onSelected={async () =>
		{
			Navigation.CloseSideMenus();
			Navigation.Navigate(`/metadeck/edit/${appId}`);
		}}
	>
		{t("changeMetadata")}...
	</MenuItem>
}

/**
 * Steam's internal LibraryContextMenu class. It isn't exported: find the module
 * referencing it, take the member whose source mentions "navigator:" and read
 * the type back from a throwaway render. Looked up when mounting, so a Steam
 * change can't prevent the whole plugin from loading.
 */
function findLibraryContextMenu(): any {
	try{
		const owningModule = findModuleByExport((member: Export) =>
			typeof member?.toString === "function" &&
			member.toString().includes("().LibraryContextMenu"));
		if (!owningModule)
			return undefined;

		const menuComponent = Object.values(owningModule).find((member: any) =>
			typeof member?.toString === "function" &&
			member.toString().includes("navigator:")) as FC | undefined;
		return menuComponent ? fakeRenderComponent(menuComponent)?.type : undefined;
	}
	catch (e: any){
		logger.error("Library context menu lookup failed", e);
		return undefined;
	}
}

/**
 * Which app the menu is really for: Steam reuses context menu instances, so the
 * appid passed in can be stale. Prefer a fresher appid on the owning React node,
 * otherwise look for an `app.appid` in the tree (newer Steam clients).
 */
function resolveAppId(nodes: any[], fallbackAppId: number): number {
	const fresherNode = (nodes || []).find((node: any) =>
		node?._owner?.pendingProps?.overview?.appid &&
		node._owner.pendingProps.overview.appid !== fallbackAppId);
	if (fresherNode)
		return Number(fresherNode._owner.pendingProps.overview.appid);

	const taggedNode = findInTree(nodes, (node) => node?.app?.appid, { walkable: ["props", "children"] });
	return Number(taggedNode?.app?.appid ?? fallbackAppId);
}

/** Only the per-game menu has a launch action referencing "launchSource" (not e.g. the screenshot menu) */
function isGameContextMenu(items: any[]): boolean {
	return Array.isArray(items) && items.length > 0 &&
		!!findInReactTree(items, (node) => node?.props?.onSelected?.toString?.().includes("launchSource"));
}

function hasAppProperties(items: any[]): boolean {
	return Array.isArray(items) && items.length > 0 &&
		!!findInReactTree(items, (node) => node?.onSelected?.toString?.().includes("AppProperties"));
}

/** Re-renders must not stack copies */
function removeEntry(items: any[]): void {
	if (!Array.isArray(items))
		return;
	for (let index = items.length - 1; index >= 0; index--){
		if (items[index]?.key === ENTRY_KEY)
			items.splice(index, 1);
	}
}

function syncEntry(items: any[], ownerAppId: number, fallbackAppId: number, shouldShow: (appId: number) => boolean): void {
	removeEntry(items);
	if (!isGameContextMenu(items))
		return;

	const appId = ownerAppId > 0 ? ownerAppId : (fallbackAppId > 0 && hasAppProperties(items) ? fallbackAppId : 0);
	if (appId <= 0 || !shouldShow(appId))
		return;

	const propertiesIndex = items.findIndex((node) =>
		findInReactTree(node, (x) => x?.onSelected?.toString?.().includes("AppProperties")));
	items.splice(propertiesIndex >= 0 ? propertiesIndex : items.length, 0,
		<MetaDeckChangeMetadata key={ENTRY_KEY} appId={appId}/>);
}

/**
 * Patches the game context menu.
 * @param shouldShow Whether the entry is shown for an app.
 * @returns A mount that adds the entry, and removes it when dismounted.
 */
const contextMenuPatch = (shouldShow: (appId: number) => boolean): AsyncMountable => {
	let outerPatch: Patch | undefined;
	let innerPatch: Patch | undefined;
	// Menu body prototype patches outlive the menu instance
	const bodyPatches: Patch[] = [];
	const patchedBodies = new Set<object>();

	// Steam reuses one menu instance and the body patches are installed once: they must read
	// the appid of the game currently opening the menu, refreshed by the outer render
	let currentOwnerAppId = 0;
	let currentFallbackAppId = 0;

	return {
		async mount(): Promise<void>
		{
			const LibraryContextMenu = findLibraryContextMenu();
			if (!LibraryContextMenu?.prototype){
				logger.error("Library context menu not found, \"Change Metadata...\" won't be available");
				return;
			}

			outerPatch = afterPatch(LibraryContextMenu.prototype, "render", (_: any[], menu: any) => {
				currentOwnerAppId = Number(menu?._owner?.pendingProps?.overview?.appid ?? 0);
				currentFallbackAppId = resolveAppId(menu?.props?.children ?? [], 0);

				if (!innerPatch){
					innerPatch = afterPatch(menu, "type", (_typeArgs: any[], rendered: any) => {
						const bodyPrototype = rendered?.type?.prototype;
						if (!bodyPrototype || patchedBodies.has(bodyPrototype))
							return rendered;
						patchedBodies.add(bodyPrototype);

						// First render of the menu body
						bodyPatches.push(afterPatch(bodyPrototype, "render", (_args: any[], output: any) => {
							try{
								syncEntry(output?.props?.children?.[0], currentOwnerAppId, currentFallbackAppId, shouldShow);
							}
							catch{
								// Steam reshapes this tree often, skip on mismatch
							}
							return output;
						}));

						// Later updates, when Steam refreshes the app overview
						bodyPatches.push(afterPatch(bodyPrototype, "shouldComponentUpdate", ([nextProps]: any[], shouldUpdate: boolean) => {
							try{
								if (shouldUpdate === true)
									syncEntry(nextProps.children, currentOwnerAppId, currentFallbackAppId, shouldShow);
								else
									removeEntry(nextProps.children);
							}
							catch{
								// Not our menu, leave the decision untouched
							}
							return shouldUpdate;
						}));

						return rendered;
					});
				}
				else if (Array.isArray(menu?.props?.children)){
					try{
						syncEntry(menu.props.children, currentOwnerAppId, currentFallbackAppId, shouldShow);
					}
					catch{
						// Ignore non-matching menus
					}
				}

				return menu;
			});
		},
		async dismount(): Promise<void>
		{
			bodyPatches.splice(0).reverse().forEach((patch) => patch.unpatch());
			patchedBodies.clear();
			outerPatch?.unpatch();
			innerPatch?.unpatch();
			outerPatch = undefined;
			innerPatch = undefined;
		}
	}
}

export default contextMenuPatch
