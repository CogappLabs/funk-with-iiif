import cues from "./lyrics.json";

/**
 * Cue list with artwork matches resolved ahead of time by
 * `npm run fetch:artworks`, so playback never waits on the API.
 */
export const lyrics = cues;

export const artworks = [
	...new Map(
		cues.flatMap((cue) => cue.images).map(({ artwork }) => [`${artwork.source}:${artwork.id}`, artwork]),
	).values(),
];

/** Harvested tiles, decoded before play so they can drop on cue. */
export const localArtworks = artworks.filter((artwork) => artwork.source === "aic");

/** Fetched live from the IIIF server, so effects can request regions. */
export const liveArtworks = artworks.filter((artwork) => artwork.source === "vam");

export function cueAt(time) {
	return lyrics.find((cue) => time >= cue.start && time <= cue.end);
}
