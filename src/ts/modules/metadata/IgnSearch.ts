// IGN game search, for the "Change Metadata" page.
// Uses the public GraphQL API behind ign.com, with the same queries Decky Metadata
// v0.6.4 uses (backend-rust/src/providers/ign.rs) by beallio:
//   https://github.com/beallio/Decky-Metadata
// Licensed under the GNU General Public License v3.0 or later. See NOTICE.

import { fetchNoCors } from "@decky/api";
import { version } from "@decky/pkg";
import { StoreCategory, type MetadataData } from "../../Interfaces";

const IGN_GRAPHQL_URL = "https://mollusk.apis.ign.com/graphql";

export interface IgnSearchResult {
	id: string;
	slug: string;
	title: string;
	description: string;
	rating?: number;
}

export async function graphql(query: string, variables: Record<string, unknown>): Promise<any> {
	const response = await fetchNoCors(IGN_GRAPHQL_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Accept": "application/json",
			"Origin": "https://www.ign.com",
			"Referer": "https://www.ign.com/",
			"User-Agent": `MetaDeck/${version} (+Decky Loader)`
		},
		body: JSON.stringify({ query, variables })
	});
	if (!response.ok)
		throw new Error(`IGN request failed: ${response.status}`);

	const payload = await response.json();
	if (payload?.errors?.length)
		throw new Error(`IGN error: ${JSON.stringify(payload.errors).slice(0, 200)}`);
	return payload?.data;
}

function htmlToText(html?: string | null): string {
	return (html ?? "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// IGN scores are 0-10
const ratingToPercent = (score: unknown): number | undefined =>
	typeof score === "number" && score > 0 ? Math.round(score * 10) : undefined;

const toPeople = (list: any): { name: string; url: string }[] =>
	(Array.isArray(list) ? list : [])
		.map((item) => String(item?.name ?? "").trim())
		.filter((name) => name.length)
		.map((name) => ({ name, url: "" }));

/** IGN has no store categories: infer them from the title, description, genres and features */
function inferCategories(text: string): StoreCategory[] {
	const categories = new Set<StoreCategory>();
	const rules: [RegExp, StoreCategory][] = [
		[/single[\s-]?player/, StoreCategory.SinglePlayer],
		[/multi[\s-]?player/, StoreCategory.MultiPlayer],
		[/co[\s-]?op|cooperative/, StoreCategory.CoOp],
		[/split[\s-]?screen/, StoreCategory.SplitScreen],
		[/online multi[\s-]?player/, StoreCategory.OnlineMultiPlayer],
		[/local multi[\s-]?player/, StoreCategory.LocalMultiPlayer],
		[/online co[\s-]?op/, StoreCategory.OnlineCoOp],
		[/local co[\s-]?op/, StoreCategory.LocalCoOp],
		[/\bmmo\b/, StoreCategory.MMO]
	];
	for (const [rule, category] of rules)
		if (rule.test(text))
			categories.add(category);
	return [...categories];
}

export async function searchIgn(query: string, count = 10): Promise<IgnSearchResult[]> {
	const name = query.trim();
	if (!name)
		return [];

	const data = await graphql(`
		query SearchObjectsByName($name: String!, $count: Int!, $type: ObjectType!) {
			searchObjectsByName(name: $name, count: $count, type: $type) {
				edges {
					node {
						id
						slug
						metadata {
							names { name short }
							descriptions { short }
						}
						primaryReview { score }
					}
				}
			}
		}`, { name, count, type: "Game" });

	return (data?.searchObjectsByName?.edges ?? [])
		.map((edge: any) => edge?.node)
		.filter((node: any) => node?.slug)
		.map((node: any): IgnSearchResult => ({
			id: String(node.id ?? node.slug),
			slug: node.slug,
			title: node.metadata?.names?.name || node.metadata?.names?.short || node.slug,
			description: htmlToText(node.metadata?.descriptions?.short),
			rating: ratingToPercent(node.primaryReview?.score)
		}));
}

export async function fetchIgn(slug: string): Promise<MetadataData | undefined> {
	const data = await graphql(`
		query ObjectSelectByTypeAndSlug($objectType: ObjectType!, $slug: String!, $state: State) {
			objectSelectByTypeAndSlug(type: $objectType, slug: $slug, state: $state) {
				id
				slug
				metadata {
					names { name short }
					descriptions { short long }
				}
				producers { name }
				publishers { name }
				genres { name }
				features { name }
				primaryReview { score }
				objectRegions { releases { date } }
			}
		}`, { slug, objectType: "Game", state: "Published" });

	const game = data?.objectSelectByTypeAndSlug;
	if (!game)
		return undefined;

	const short = htmlToText(game.metadata?.descriptions?.short);
	const long = htmlToText(game.metadata?.descriptions?.long);
	// Earliest release among all regions
	const dates = (game.objectRegions ?? [])
		.flatMap((region: any) => region?.releases ?? [])
		.map((release: any) => Date.parse(release?.date))
		.filter((time: number) => Number.isFinite(time));
	const title = game.metadata?.names?.name || game.metadata?.names?.short || slug;
	const text = [
		title, long || short,
		...(game.genres ?? []).map((genre: any) => genre?.name),
		...(game.features ?? []).map((feature: any) => feature?.name)
	].join(" ").toLowerCase();

	return {
		id: String(game.id ?? slug),
		title,
		description: short || long,
		developers: toPeople(game.producers),
		publishers: toPeople(game.publishers),
		release_date: dates.length ? Math.floor(Math.min(...dates) / 1000) : undefined,
		rating: ratingToPercent(game.primaryReview?.score),
		store_categories: inferCategories(text)
	};
}
