const DEFAULT_TEMPO = 100;

/**
 * Drives every animation from the audio clock so visuals stay on the beat.
 * @param {HTMLAudioElement} audioElement
 */
export function createBeatClock(audioElement) {
	const beatListeners = new Set();
	const frameListeners = new Set();

	let lastBeat = -1;
	let beatOrigin = 0;

	const tempo = () => Number.parseFloat(audioElement.dataset.tempo) || DEFAULT_TEMPO;
	const offsetMs = () => Number.parseFloat(audioElement.dataset.beatOffset) || 0;

	const clock = {
		get beatDuration() {
			return (60 / tempo()) * 1000;
		},

		onBeat(listener) {
			beatListeners.add(listener);
		},

		onFrame(listener) {
			frameListeners.add(listener);
		},

		/** Phase-locks an animation to the beat grid, whenever it was created. */
		sync(animation, { beatsPerCycle = 1 } = {}) {
			const cycle = clock.beatDuration * beatsPerCycle;
			const elapsed = document.timeline.currentTime - beatOrigin;
			animation.startTime = beatOrigin + Math.ceil(elapsed / cycle) * cycle;
		},
	};

	function tick() {
		const beatDuration = clock.beatDuration;
		const audioMs = audioElement.currentTime * 1000 - offsetMs();
		const beat = Math.floor(audioMs / beatDuration);

		beatOrigin = document.timeline.currentTime - (audioMs - beat * beatDuration);

		for (const listener of frameListeners) listener(audioElement.currentTime);

		if (beat !== lastBeat && !audioElement.paused) {
			lastBeat = beat;
			for (const listener of beatListeners) listener(beat);
		}

		requestAnimationFrame(tick);
	}

	requestAnimationFrame(tick);

	return clock;
}
