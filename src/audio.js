import { guess } from "web-audio-beat-detector";

/**
 * Works out the tempo of the track and stores it on the element so the
 * beat clock can read it.
 * @param {HTMLAudioElement} audioElement
 */
export async function analyseTempo(audioElement) {
	const audioContext = new (window.AudioContext || window.webkitAudioContext)();
	const response = await fetch(audioElement.src);
	const audioBuffer = await audioContext.decodeAudioData(await response.arrayBuffer());

	try {
		const { tempo, offset } = await guess(audioBuffer);
		audioElement.dataset.tempo = tempo;
		audioElement.dataset.beatOffset = offset * 1000;
	} catch (error) {
		console.warn("Could not detect a tempo, falling back to the default.", error);
	}
}
