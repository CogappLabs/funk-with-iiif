import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const IIIF_ROOT = "https://www.artic.edu/iiif/2";
const TILE_SIZE = 400;
const PAUSE_MS = 2000;
const TIMEOUT_MS = 180_000;
const HEADERS = {
	Referer: "https://www.artic.edu/",
	"AIC-User-Agent": "FunkWithIIIF (https://github.com/CogappLabs/FunkWithIIIF)",
};

const tilesDir = new URL("../public/artworks/", import.meta.url);
const cues = JSON.parse(await readFile(new URL("../src/lyrics.json", import.meta.url), "utf8"));

const imageIds = [
	...new Set(
		cues
			.flatMap((cue) => cue.images)
			.map(({ artwork }) => artwork)
			.filter((artwork) => artwork.source === "aic")
			.map((artwork) => artwork.image_id),
	),
];

async function exists(url) {
	return stat(url).then((info) => info.size > 0).catch(() => false);
}

function isJPEG(bytes) {
	return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function download(imageId) {
	const url = `${IIIF_ROOT}/${imageId}/square/!${TILE_SIZE},${TILE_SIZE}/0/default.jpg`;
	const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);

	const bytes = new Uint8Array(await response.arrayBuffer());
	if (!isJPEG(bytes)) throw new Error(`not a JPEG (${response.headers.get("content-type")})`);
	return bytes;
}

await mkdir(tilesDir, { recursive: true });

let downloaded = 0;
const failed = [];

for (const [index, imageId] of imageIds.entries()) {
	const label = `[${index + 1}/${imageIds.length}] ${imageId}`;
	const destination = new URL(`${imageId}.jpg`, tilesDir);

	if (await exists(destination)) {
		console.log(`${label} skip`);
		continue;
	}

	try {
		const bytes = await download(imageId);
		await writeFile(destination, bytes);
		downloaded++;
		console.log(`${label} ok ${bytes.byteLength}B`);
	} catch (error) {
		failed.push(imageId);
		console.warn(`${label} FAIL ${error.message}`);
	}

	await sleep(PAUSE_MS);
}

console.log(`\n${imageIds.length} tiles referenced, ${downloaded} downloaded, ${failed.length} failed.`);
if (failed.length) {
	console.log(failed.join("\n"));
	process.exitCode = 1;
}
