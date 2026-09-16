import { planEffect, planURLs, tileURL } from "./iiif";

const TARGET_TILE_PX = 190;
const IMAGE_LIFETIME_BEATS = 12;

const PALETTE = [
	"#ff2fb9",
	"#00e5ff",
	"#ffe600",
	"#00ff85",
	"#ff6a00",
	"#9d4bff",
];

/** Deterministic noise so a sparkle pattern repeats identically for a beat. */
function hash(col, row, beat) {
	const n = Math.sin(col * 127.1 + row * 311.7 + beat * 74.7) * 43758.5453;
	return n - Math.floor(n);
}

const PATTERNS = [
	function checkerboard(col, row, beat) {
		return (col + row + beat) % 2 === 0;
	},
	function rowSweep(col, row, beat, cols, rows) {
		return row === beat % rows;
	},
	function columnSweep(col, row, beat, cols) {
		return col === beat % cols;
	},
	function rings(col, row, beat, cols, rows) {
		const distance = Math.hypot(col - (cols - 1) / 2, row - (rows - 1) / 2);
		const radius = beat % Math.ceil(Math.hypot(cols, rows) / 2 + 1);
		return Math.abs(distance - radius) < 0.8;
	},
	function sparkle(col, row, beat) {
		return hash(col, row, beat) < 0.35;
	},
	function quadrants(col, row, beat, cols, rows) {
		const left = col < cols / 2;
		const top = row < rows / 2;
		return (left === top) === (beat % 2 === 0);
	},
];

function decodeImage(url) {
	const image = new Image();
	image.src = url;
	return image.decode().catch(() => {});
}

/** Decodes every tile up front so artworks land on the beat they are meant to. */
export function preloadArtworks(artworks, onProgress) {
	let loaded = 0;

	return Promise.all(
		artworks.map((artwork) =>
			decodeImage(tileURL(artwork)).finally(() => onProgress?.(++loaded, artworks.length)),
		),
	);
}

export function createDiscoFloor(container, clock) {
	let cols = 0;
	let rows = 0;
	let tiles = [];
	let patternIndex = 0;
	let queuedPlans = [];
	const dropListeners = new Set();

	function build() {
		const { width, height } = container.getBoundingClientRect();
		cols = Math.max(3, Math.round(width / TARGET_TILE_PX));
		rows = Math.max(3, Math.round(height / TARGET_TILE_PX));

		container.style.setProperty("--cols", cols);
		container.style.setProperty("--rows", rows);
		container.replaceChildren();

		tiles = Array.from({ length: cols * rows }, (_, index) => {
			const element = document.createElement("div");
			element.className = "tile";
			container.append(element);
			return { element, col: index % cols, row: Math.floor(index / cols), image: null, placedAt: -Infinity };
		});
	}

	function flash(beat) {
		if (beat % 8 === 0) {
			patternIndex = (patternIndex + 1 + Math.floor(Math.random() * 2)) % PATTERNS.length;
		}

		const pattern = PATTERNS[patternIndex];

		for (const tile of tiles) {
			const lit = pattern(tile.col, tile.row, beat, cols, rows);
			tile.element.classList.toggle("lit", lit);
			if (lit) {
				const colour = PALETTE[(beat + tile.col + tile.row) % PALETTE.length];
				tile.element.style.setProperty("--flash", colour);
			}
		}
	}

	function expire(beat) {
		for (const tile of tiles) {
			if (tile.image && beat - tile.placedAt >= IMAGE_LIFETIME_BEATS) {
				tile.image = null;
				for (const image of tile.element.querySelectorAll(".tile-image")) {
					image.classList.add("leaving");
					image.addEventListener("animationend", () => image.remove(), { once: true });
				}
			}
		}
	}

	function pickTile() {
		const free = tiles.filter((tile) => !tile.image);
		const candidates = free.length ? free : tiles;
		return candidates[Math.floor(Math.random() * candidates.length)];
	}

	function tileAt(col, row) {
		return tiles[row * cols + col];
	}

	/** Finds the block of the given shape covering the fewest occupied tiles. */
	function pickBlock({ cols: blockCols, rows: blockRows }) {
		if (blockCols > cols || blockRows > rows) return null;

		const blocks = tiles
			.filter((tile) => tile.col + blockCols <= cols && tile.row + blockRows <= rows)
			.map(({ col, row }) => {
				const block = [];
				for (let dy = 0; dy < blockRows; dy++) {
					for (let dx = 0; dx < blockCols; dx++) block.push(tileAt(col + dx, row + dy));
				}
				return block;
			});

		const occupancy = (block) => block.filter((tile) => tile.image).length;
		const best = Math.min(...blocks.map(occupancy));
		const candidates = blocks.filter((block) => occupancy(block) === best);
		return candidates[Math.floor(Math.random() * candidates.length)];
	}

	function mount(tile, image, beat) {
		tile.element.replaceChildren();
		image.addEventListener("error", () => {
			if (tile.image === image) tile.image = null;
			image.remove();
		});

		tile.image = image;
		tile.placedAt = beat;
		tile.element.append(image);

		const pulse = image.animate(
			[{ transform: "scale(1.08)" }, { transform: "scale(1)" }, { transform: "scale(1.08)" }],
			{ duration: clock.beatDuration, iterations: Infinity, easing: "ease-in-out" },
		);
		clock.sync(pulse);
	}

	function createImage(artwork, url) {
		const image = document.createElement("img");
		image.className = "tile-image";
		image.alt = artwork.title ?? "";
		image.src = url;
		return image;
	}

	/** Lands a fully fetched effect on the tiles it needs. */
	function placePlan({ artwork, plan }, beat) {
		const single = plan.block.cols === 1 && plan.block.rows === 1;
		const targets = single ? [pickTile()] : pickBlock(plan.block);
		if (!targets) return placePlan({ artwork, plan: planEffect(artwork, { cols, rows }, "single") }, beat);

		targets.forEach((tile, index) => {
			const spec = plan.tiles[index];
			const image = createImage(artwork, spec.frames[0]);
			image.dataset.frame = 0;
			image.frames = spec.frames;
			mount(tile, image, beat);

			if (spec.gray) {
				const gray = createImage(artwork, spec.gray);
				gray.classList.add("tile-image--gray");
				tile.element.append(gray);
			}
		});

		for (const listener of dropListeners) listener(artwork);
	}

	/** Steps multi-frame tiles to their next region on the beat. */
	function advanceFrames() {
		for (const tile of tiles) {
			const image = tile.image;
			if (!image?.frames || image.frames.length < 2) continue;
			const frame = (Number(image.dataset.frame) + 1) % image.frames.length;
			image.dataset.frame = frame;
			image.src = image.frames[frame];
		}
	}

	return {
		build,

		onBeat(beat) {
			expire(beat);
			advanceFrames();
			flash(beat);

			const ready = queuedPlans;
			queuedPlans = [];
			for (const queued of ready) placePlan(queued, beat);
		},

		onDrop(listener) {
			dropListeners.add(listener);
		},

		/**
		 * Drops a harvested artwork onto a free tile straight away.
		 * @param {Object} artwork
		 * @param {number} beat
		 */
		place(artwork, beat) {
			const tile = pickTile();
			mount(tile, createImage(artwork, tileURL(artwork)), beat);
			for (const listener of dropListeners) listener(artwork);
			return tile;
		},

		/**
		 * Fetches a live IIIF effect, then lands it on the first beat after it arrives.
		 * @param {Object} artwork
		 */
		placeLive(artwork) {
			const plan = planEffect(artwork, { cols, rows });
			return Promise.all(planURLs(plan).map(decodeImage)).then(() => {
				queuedPlans.push({ artwork, plan });
			});
		},
	};
}
