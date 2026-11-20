// Title search for lists searched locally (EmuDeck list, LizardByte GameDB) on the "Change Metadata" page.
// The automatic matching keeps its whole-title distance: this is for people typing a query, so it is word based:
// - every word of the query must match a word of the title, in any order ("zelda ocarina");
// - a word may be the start of a title word ("resi" = "Resident");
// - abbreviations match the initials of consecutive words, both ways ("gta" = "Grand Theft Auto",
//   "grand theft auto" = "GTA": in titles only when written in capitals);
// - Roman numerals equal digits ("III" = "3"), letters and digits are split ("re4" = "re 4"),
//   punctuation, accents and case are ignored, and a typo per long word is tolerated.

import { distance } from "fastest-levenshtein";

const ROMAN: Record<string, string> = {
	i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
	xi: "11", xii: "12", xiii: "13", xiv: "14", xv: "15", xvi: "16"
};

// Common abbreviations whose titles don't start like them (LizardByte only downloads titles by their first letters)
const ABBREVIATIONS: Record<string, string[]> = {
	gta: ["grand theft auto"],
	re: ["resident evil"],
	ff: ["final fantasy"],
	mgs: ["metal gear solid"],
	mk: ["mortal kombat", "mario kart"],
	smb: ["super mario bros"],
	nsmb: ["new super mario bros"],
	ssb: ["super smash bros"],
	loz: ["the legend of zelda"],
	zelda: ["the legend of zelda"],
	kh: ["kingdom hearts"],
	dmc: ["devil may cry"],
	gow: ["god of war"],
	nfs: ["need for speed"],
	cod: ["call of duty"],
	sh: ["silent hill"],
	sf: ["street fighter"],
	dk: ["donkey kong"],
	dkc: ["donkey kong country"],
	thps: ["tony hawk's pro skater"],
	tlou: ["the last of us"],
	pkmn: ["pokemon"]
};

/** Comparable words: "Grand Theft Auto: Vice City III" -> ["grand", "theft", "auto", "vice", "city", "3"] */
export function titleWords(text: string): string[]{
	return text
		.normalize("NFD").replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/['’`]/g, "")
		.replace(/([a-z])([0-9])/g, "$1 $2")
		.replace(/([0-9])([a-z])/g, "$1 $2")
		.split(/[^a-z0-9]+/)
		.filter((word) => word)
		.map((word) => ROMAN[word] ?? word);
}

const OPTIONAL_WORDS = new Set(["the", "a", "an", "and", "of"]);

const isAbbreviation = (word: string) => /^[a-z]{2,5}$/.test(word);

/** Index of the first of consecutive unused words whose initials spell the abbreviation, or -1 */
function initialsAt(abbreviation: string, words: string[], used: boolean[]): number{
	for (let start = 0; start + abbreviation.length <= words.length; start++){
		let i = 0;
		while (i < abbreviation.length && !used[start + i] && words[start + i][0] === abbreviation[i])
			i++;
		if (i === abbreviation.length)
			return start;
	}
	return -1;
}

const enum Tier { Exact, StartsWith, Words, Partial, Typo }

/** How well a title matches the query words: lower is better, undefined for no match */
function matchTitle(query: string[], title: string[], titleAbbreviations: Set<string>): number[] | undefined{
	if (!query.length || !title.length)
		return undefined;
	const queryUsed = query.map(() => false);
	const titleUsed = title.map(() => false);
	let tier: number = Tier.Words;

	// Whole words first, wherever they are
	query.forEach((word, q) => {
		const t = title.findIndex((titleWord, i) => !titleUsed[i] && titleWord === word);
		if (t >= 0){
			queryUsed[q] = true;
			titleUsed[t] = true;
		}
	});

	// Abbreviations in the title for words of the query ("GTA" for "grand theft auto")
	title.forEach((word, t) => {
		if (titleUsed[t] || !titleAbbreviations.has(word))
			return;
		const start = initialsAt(word, query, queryUsed);
		if (start < 0)
			return;
		for (let i = 0; i < word.length; i++)
			queryUsed[start + i] = true;
		titleUsed[t] = true;
		tier = Math.max(tier, Tier.Partial);
	});

	for (let q = 0; q < query.length; q++){
		if (queryUsed[q])
			continue;
		const word = query[q];

		// Abbreviations in the query ("gta" for "Grand Theft Auto")
		const start = isAbbreviation(word) ? initialsAt(word, title, titleUsed) : -1;
		if (start >= 0){
			for (let i = 0; i < word.length; i++)
				titleUsed[start + i] = true;
			tier = Math.max(tier, Tier.Partial);
			continue;
		}

		// Start of a word
		let t = title.findIndex((titleWord, i) => !titleUsed[i] && titleWord.startsWith(word));
		if (t >= 0){
			titleUsed[t] = true;
			tier = Math.max(tier, Tier.Partial);
			continue;
		}

		// A typo in a long word
		if (word.length >= 4){
			t = title.findIndex((titleWord, i) => !titleUsed[i] &&
				(distance(word, titleWord) <= 1 || distance(word, titleWord.slice(0, word.length)) <= 1));
			if (t >= 0){
				titleUsed[t] = true;
				tier = Tier.Typo;
				continue;
			}
		}

		// Small words the title may leave out ("ratchet and clank" for "Ratchet & Clank")
		if (OPTIONAL_WORDS.has(word))
			continue;

		return undefined;
	}

	// Ignoring small words: "legend of zelda" starts "The Legend of Zelda", "ratchet and clank" is "Ratchet & Clank"
	const [q, t] = [query, title].map((words) => words.filter((word) => !OPTIONAL_WORDS.has(word)));
	if (tier === Tier.Words && q.length === t.length && q.every((word, i) => word === t[i]))
		tier = Tier.Exact;
	else if (tier === Tier.Words && q.length < t.length && q.every((word, i) => word === t[i]))
		tier = Tier.StartsWith;

	// Then titles with the query as a phrase ("Super Mario 64" before "Mario Kart 64"), then with fewer extra words
	const phrase = t.some((_, start) => q.every((word, i) => t[start + i] === word));
	return [tier, phrase ? 0 : 1, titleUsed.filter((used) => !used).length];
}

/** Same title once punctuation, case, accents, small words and Roman numerals are ignored */
export function sameTitle(a: string, b: string): boolean{
	const words = (text: string) => titleWords(text).filter((word) => !OPTIONAL_WORDS.has(word));
	const [x, y] = [words(a), words(b)];
	return x.length > 0 && x.length === y.length && x.every((word, i) => word === y[i]);
}

/** Same numbers in both titles (Roman numerals too): "Resident Evil" is not "Resident Evil 3" */
export function sameNumbers(a: string, b: string): boolean{
	const numbers = (text: string) => titleWords(text).filter((word) => /^[0-9]+$/.test(word)).map(Number).sort().join(" ");
	return numbers(a) === numbers(b);
}

/** The query and its abbreviation expansions, as word lists */
function queryVariants(query: string): string[][]{
	const words = titleWords(query);
	const variants = [words];
	words.forEach((word, i) => {
		for (const expansion of ABBREVIATIONS[word] ?? [])
			variants.push([...words.slice(0, i), ...titleWords(expansion), ...words.slice(i + 1)]);
	});
	return variants;
}

/**
 * Texts to look a query up by its first letters (LizardByte buckets):
 * the query, its abbreviations expanded and with a leading "The"
 */
export function titleSearchPrefixes(query: string): string[]{
	const prefixes = new Set<string>();
	for (const words of queryVariants(query)){
		const text = words.join(" ");
		prefixes.add(text);
		if (words[0] !== "the")
			prefixes.add(`the ${text}`);
	}
	return [...prefixes];
}

const compareScores = (a: number[], b: number[]) => {
	for (let i = 0; i < a.length; i++)
		if (a[i] !== b[i])
			return a[i] - b[i];
	return 0;
};

/** The items whose title matches the query, best first */
export function rankTitles<T>(query: string, items: T[], getTitle: (item: T) => string): T[]{
	const variants = queryVariants(query);
	const scored: { item: T; title: string; score: number[] }[] = [];
	for (const item of items){
		const title = getTitle(item);
		const words = titleWords(title);
		// Written in capitals: "GTA", not the "Re" of "Re-Boot"
		const abbreviations = new Set((title.match(/\b[A-Z]{2,5}\b/g) ?? []).map((word) => word.toLowerCase()));
		let best: number[] | undefined;
		for (const variant of variants){
			const score = matchTitle(variant, words, abbreviations);
			if (score && (!best || compareScores(score, best) < 0))
				best = score;
		}
		if (best)
			scored.push({ item, title, score: best });
	}
	return scored
		.sort((a, b) => compareScores(a.score, b.score) || a.title.length - b.title.length || a.title.localeCompare(b.title))
		.map((entry) => entry.item);
}
