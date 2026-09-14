import { readFile, writeFile } from "node:fs/promises";
import posTagger from "wink-pos-tagger";

const wink = posTagger();

const POS_TAGS = ["NN", "NNS", "NNP", "JJ"];
const POOL_SIZE = 6;
const AIC_SEARCH_URL = "https://api.artic.edu/api/v1/artworks/search";
const AIC_SEARCH_FIELDS = "id,title,image_id,artist_display,_score";
/** AIC returns the same filler results for any word it cannot match. */
const AIC_MIN_SCORE = 10;
const AIC_HEADERS = { "AIC-User-Agent": "FunkWithIIIF (https://github.com/CogappLabs/FunkWithIIIF)" };
const VAM_SEARCH_URL = "https://api.vam.ac.uk/v2/objects/search";

/** Interjections the tagger labels as nouns. */
const IGNORED_WORDS = new Set(["oo", "ooh", "uh", "huh", "yeah", "oh", "hey", "la", "wanna", "gonna"]);

function parseTimecode(timecode) {
	const [hours, minutes, seconds] = timecode.split(":");
	return Number(hours) * 3600 + Number(minutes) * 60 + Number.parseFloat(seconds);
}

function parseVTT(data) {
	const cues = [];
	let cue = {};

	for (const line of data.split("\n").map((line) => line.trim())) {
		if (line.includes("-->")) {
			const [start, end] = line.split("-->");
			cue = { start: parseTimecode(start.trim()), end: parseTimecode(end.trim()), text: "" };
		} else if (line) {
			cue.text = cue.text ? `${cue.text} ${line}` : line;
		} else if (cue.start !== undefined) {
			cues.push(cue);
			cue = {};
		}
	}
	if (cue.start !== undefined) cues.push(cue);

	return cues.filter((cue) => cue.text);
}

function highlightWords(text, words) {
	const wordSet = new Set(words);
	return text
		.split(" ")
		.map((word) => (wordSet.has(word) ? `<span class="highlighted">${word}</span>` : word))
		.join(" ");
}

/** Turns a sung token into a word a collection search understands. */
function searchTerm(token) {
	if (!/^[a-z]+'?$/i.test(token)) return null;
	const term = token.toLowerCase().replace(/in'$/, "ing").replace(/'$/, "");
	if (term.length < 3 || IGNORED_WORDS.has(term)) return null;
	return term;
}

/** Puts artworks whose title contains the word ahead of looser matches. */
function byTitleMatch(word) {
	const pattern = new RegExp(`\\b${word}`, "i");
	return (a, b) => Number(pattern.test(b.title ?? "")) - Number(pattern.test(a.title ?? ""));
}

async function fetchJSON(url, headers = {}) {
	const response = await fetch(url, { headers });
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	return response.json();
}

async function searchAIC(word) {
	const url = new URL(AIC_SEARCH_URL);
	url.searchParams.set("q", word);
	url.searchParams.set("query[term][is_public_domain]", "true");
	url.searchParams.set("size", POOL_SIZE);
	url.searchParams.set("fields", AIC_SEARCH_FIELDS);

	const { data } = await fetchJSON(url, AIC_HEADERS);
	return data
		.filter((artwork) => artwork.image_id && artwork._score >= AIC_MIN_SCORE)
		.map((artwork) => ({
			source: "aic",
			id: artwork.id,
			title: artwork.title,
			artist_display: artwork.artist_display,
			image_id: artwork.image_id,
		}));
}

async function searchVAM(word) {
	const url = new URL(VAM_SEARCH_URL);
	url.searchParams.set("q", word);
	url.searchParams.set("images_exist", "1");
	url.searchParams.set("page_size", POOL_SIZE);

	const { records } = await fetchJSON(url);
	return records
		.filter((record) => record._images?._iiif_image_base_url)
		.map((record) => ({
			source: "vam",
			id: record.systemNumber,
			title: record._primaryTitle || record.objectType,
			artist_display: [record._primaryMaker?.name, record._primaryDate].filter(Boolean).join(", "),
			iiif: record._images._iiif_image_base_url.replace(/\/$/, ""),
		}));
}

/** Records the image dimensions so regions can be cut in pixels. */
async function addDimensions(artwork) {
	if (artwork.width) return artwork;
	const { width, height } = await fetchJSON(`${artwork.iiif}/info.json`);
	return Object.assign(artwork, { width, height });
}

/** Alternates the two collections so a recurring word cycles through both. */
function interleave(first, second) {
	const pool = [];
	for (let index = 0; index < Math.max(first.length, second.length); index++) {
		if (first[index]) pool.push(first[index]);
		if (second[index]) pool.push(second[index]);
	}
	return pool;
}

const pools = new Map();
const cursors = new Map();

async function nextArtwork(word) {
	if (!pools.has(word)) {
		const [aic, vam] = await Promise.all([
			searchAIC(word).catch((error) => (console.warn(`AIC "${word}": ${error.message}`), [])),
			searchVAM(word).catch((error) => (console.warn(`V&A "${word}": ${error.message}`), [])),
		]);
		aic.sort(byTitleMatch(word));
		vam.sort(byTitleMatch(word));
		const vamFirst = pools.size % 2 === 1;
		pools.set(word, vamFirst ? interleave(vam, aic) : interleave(aic, vam));
		cursors.set(word, 0);
	}

	const pool = pools.get(word);
	if (!pool.length) return null;

	const cursor = cursors.get(word);
	cursors.set(word, cursor + 1);
	const artwork = pool[cursor % pool.length];
	return artwork.source === "vam" ? addDimensions(artwork) : artwork;
}

const vtt = await readFile(new URL("../src/iiif.vtt", import.meta.url), "utf8");
const cues = parseVTT(vtt);
const manifest = [];

for (const cue of cues) {
	const tokens = wink
		.tagSentence(cue.text.replace(/’/g, "'"))
		.filter((token) => POS_TAGS.includes(token.pos))
		.map((token) => token.value);

	const images = [];
	for (const token of tokens) {
		const word = searchTerm(token);
		if (!word) continue;
		try {
			const artwork = await nextArtwork(word);
			if (artwork) images.push({ word: token, artwork });
		} catch (error) {
			console.warn(`Skipping "${word}": ${error.message}`);
		}
	}

	manifest.push({
		start: cue.start,
		end: cue.end,
		text: cue.text,
		formattedText: highlightWords(cue.text, images.map((image) => image.word)),
		images,
	});
	console.log(`${cue.text} -> ${images.map((image) => `${image.word}:${image.artwork.source}`).join(" ") || "-"}`);
}

await writeFile(
	new URL("../src/lyrics.json", import.meta.url),
	`${JSON.stringify(manifest, null, "\t")}\n`,
);

const drops = manifest.flatMap((cue) => cue.images);
const unique = new Set(drops.map(({ artwork }) => `${artwork.source}:${artwork.id}`));
console.log(
	`\n${manifest.length} cues, ${pools.size} words queried, ${drops.length} drops, ${unique.size} unique artworks ` +
		`(${drops.filter(({ artwork }) => artwork.source === "aic").length} AIC, ${drops.filter(({ artwork }) => artwork.source === "vam").length} V&A).`,
);
