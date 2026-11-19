// Adds "Change Metadata..." to the game context menu, right before "Properties..."
import {FC} from "react";
import {useTranslations} from "./useTranslations";
import {
	afterPatch,
	fakeRenderComponent,
	findInReactTree,
	findModuleChild,
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

// Always add before "Properties..."
const spliceChangeMetadata = (children: any[], appid: number, shouldShow: (appId: number) => boolean) => {
	// Re-renders must not stack copies
	const existingIdx = children.findIndex((x: any) => x?.key === ENTRY_KEY);
	if (existingIdx != -1)
		children.splice(existingIdx, 1);

	if (!shouldShow(appid))
		return;

	const propertiesMenuItemIdx = children.findIndex((item) =>
		findInReactTree(
			item,
			(x) => x?.onSelected && x.onSelected.toString().includes('AppProperties')
		)
	)
	children.splice(
		propertiesMenuItemIdx >= 0 ? propertiesMenuItemIdx : children.length,
		0,
		<MetaDeckChangeMetadata key={ENTRY_KEY}
			appId={appid}
		/>
	)
}

/**
 * Game context menu component, looked up when mounting so a Steam change
 * can't prevent the whole plugin from loading.
 */
function findLibraryContextMenu(): any {
	try{
		return fakeRenderComponent(
			findModuleChild((m) => {
				if (typeof m !== 'object') return
				for (const prop in m) {
					if (m[prop]?.toString()?.includes('().LibraryContextMenu')) {
						return Object.values(m).find(
							(sibling) =>
								sibling?.toString().includes('createElement') &&
								sibling?.toString().includes('navigator:')
						);
					}
				}
				return
			})
		)?.type;
	}
	catch (e: any){
		logger.error("Library context menu not found", e);
		return undefined;
	}
}

/**
 * Patches the game context menu.
 * @param shouldShow Whether the entry is shown for an app.
 * @returns A mount that adds the entry, and removes it when dismounted.
 */
const contextMenuPatch = (shouldShow: (appId: number) => boolean): AsyncMountable => {
	const patches: {
		outer?: Patch
		inner?: Patch
	} = {}
	return {
		async mount(): Promise<void>
		{
			const LibraryContextMenu = findLibraryContextMenu();
			if (!LibraryContextMenu?.prototype){
				logger.error("Library context menu not found, \"Change Metadata...\" won't be available");
				return;
			}

			patches.outer = afterPatch(
				   LibraryContextMenu.prototype,
				   'render',
				   (_: Record<string, unknown>[], component: any) => {
					   const appid: number = component._owner.pendingProps.overview.appid

					   if (!patches.inner) {
						   patches.inner = afterPatch(
								 component.type.prototype,
								 'shouldComponentUpdate',
								 ([nextProps]: any, shouldUpdate: any) => {
									 if (Array.isArray(nextProps.children))
									 {
										 const gtmIdx = nextProps.children.findIndex((x: any) => x?.key === ENTRY_KEY);
										 if (gtmIdx != -1) nextProps.children.splice(gtmIdx, 1)

										 if (shouldUpdate === true)
										 {
											 let updatedAppid: number = appid
											 // find the first menu component that has the correct appid assigned to _owner
											 const parentOverview = nextProps.children.find(
												    (x: any) =>
														  x?._owner?.pendingProps?.overview?.appid &&
														  x._owner.pendingProps.overview.appid !== appid
											 )
											 // if found then use that appid
											 if (parentOverview)
											 {
												 updatedAppid = parentOverview._owner.pendingProps.overview.appid
											 }
											 spliceChangeMetadata(nextProps.children, updatedAppid, shouldShow)
										 }
									 }

									 return shouldUpdate
								 }
						   )
					   }
					   else {
						   spliceChangeMetadata(component.props.children, appid, shouldShow)
					   }

					   return component
				   }
			)
		},
		async dismount(): Promise<void>
		{
			patches.outer?.unpatch()
			patches.inner?.unpatch()
			patches.outer = undefined
			patches.inner = undefined
		}
	}
}

export default contextMenuPatch
