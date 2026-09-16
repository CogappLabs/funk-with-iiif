import "../styles.css";
import { analyseTempo } from "./audio";
import { createBeatClock } from "./beat";
import { createDiscoFloor, preloadArtworks } from "./discofloor";
import { getRandomMusicEmojis } from "./emoji";
import { artworks, cueAt, liveArtworks, localArtworks, lyrics } from "./lyrics";

const audioElement = document.querySelector(".audio-player");
const lyricsContainer = document.querySelector(".lyrics");
const floorContainer = document.querySelector(".discofloor");
const creditElement = document.querySelector(".credit");
const playButton = document.querySelector("#play-button");
const playLabel = playButton.querySelector(".play-label");

const clock = createBeatClock(audioElement);
const floor = createDiscoFloor(floorContainer, clock);

floor.build();
window.addEventListener("resize", floor.build);

let currentCue = null;
let pendingDrops = [];

const SOURCE_NAMES = { aic: "Art Institute of Chicago", vam: "Victoria and Albert Museum" };

function currentBeat() {
	return Math.floor(
		(audioElement.currentTime * 1000 - (Number.parseFloat(audioElement.dataset.beatOffset) || 0)) /
			clock.beatDuration,
	);
}

function drop(artwork) {
	if (artwork.source === "vam") floor.placeLive(artwork);
	else floor.place(artwork, currentBeat());
}

function randomLiveArtwork() {
	return liveArtworks[Math.floor(Math.random() * liveArtworks.length)];
}

/** Names the artwork that just landed, then fades out over a few bars. */
function showCredit(artwork) {
	creditElement.replaceChildren();
	const title = document.createElement("span");
	title.className = "credit-title";
	title.textContent = artwork.title;
	creditElement.append(title, ` ${[artwork.artist_display, SOURCE_NAMES[artwork.source]].filter(Boolean).join(" · ")}`);

	for (const animation of creditElement.getAnimations()) animation.cancel();
	creditElement.animate(
		[
			{ opacity: 0, transform: "translateY(0.5rem)" },
			{ opacity: 1, transform: "translateY(0)", offset: 0.08 },
			{ opacity: 1, offset: 0.7 },
			{ opacity: 0 },
		],
		{ duration: clock.beatDuration * 8, fill: "forwards", easing: "ease-out" },
	);
}

/** Spreads a cue's artworks evenly across the time the line is sung. */
function scheduleCue(cue) {
	for (const timer of pendingDrops) clearTimeout(timer);
	pendingDrops = [];

	if (!cue.images.length) return;

	const step = ((cue.end - cue.start) / cue.images.length) * 1000;

	pendingDrops = cue.images.map(({ artwork }, index) => setTimeout(() => drop(artwork), index * step));
}

clock.onBeat((beat) => {
	floor.onBeat(beat);

	if (!currentCue && beat % 2 === 0) {
		lyricsContainer.textContent = getRandomMusicEmojis().join(" ");
	}

	if (!currentCue && beat % 4 === 0 && liveArtworks.length) {
		floor.placeLive(randomLiveArtwork());
	}
});

floor.onDrop(showCredit);

clock.onFrame((time) => {
	const cue = cueAt(time);
	if (cue === currentCue) return;

	currentCue = cue;
	if (cue) {
		lyricsContainer.innerHTML = cue.formattedText;
		scheduleCue(cue);
	}
});

playButton.addEventListener("click", async () => {
	playButton.disabled = true;

	await Promise.all([
		preloadArtworks(localArtworks, (loaded, total) => {
			playLabel.textContent = `Loading the floor… ${Math.round((loaded / total) * 100)}%`;
		}),
		analyseTempo(audioElement),
	]);

	playButton.remove();
	audioElement.play();
});

console.log(`${lyrics.length} cues, ${artworks.length} artworks (${localArtworks.length} local, ${liveArtworks.length} live).`);
