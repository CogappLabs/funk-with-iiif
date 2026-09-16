import { planEffect, planURLs, tileURL } from "./iiif";

const TARGET_TILE_PX = 190;
const IMAGE_LIFETIME_BEATS = 12;
const BUILD_REVEAL_BEATS = 8;
const BUILD_HOLD_BEATS = 4;

/** Beats a whole-floor build needs before it starts peeling away. */
export const FILL_BEATS = BUILD_REVEAL_BEATS + BUILD_HOLD_BEATS;

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
	let tileAspect = 1;
	let tiles = [];
	let patternIndex = 0;
	let queuedPlans = [];
	let builds = [];
	let pendingReveals = 0;
	const dropListeners = new Set();

	function build() {
		const { width, height } = container.getBoundingClientRect();
		cols = Math.max(3, Math.round(width / TARGET_TILE_PX));
		rows = Math.max(3, Math.round(height / TARGET_TILE_PX));
		tileAspect = width / cols / (height / rows);
		builds = [];

		container.style.setProperty("--cols", cols);
		container.style.setProperty("--rows", rows);
		container.replaceChildren();

		tiles = Array.from({ length: cols * rows }, (_, index) => {
			const element = document.createElement("div");
			element.className = "tile";
			container.append(element);
			return {
				element,
				col: index % cols,
				row: Math.floor(index / cols),
				image: null,
				placedAt: -Infinity,
				reserved: false,
			};
		});
	}

	function grid() {
		return { cols, rows, tileAspect };
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

	function clear(tile) {
		tile.image = null;
		for (const image of tile.element.querySelectorAll(".tile-image")) {
			image.classList.add("leaving");
			image.addEventListener("animationend", () => image.remove(), { once: true });
		}
	}

	function expire(beat) {
		for (const tile of tiles) {
			if (!tile.reserved && tile.image && beat - tile.placedAt >= IMAGE_LIFETIME_BEATS) clear(tile);
		}
	}

	/** Prefers a free tile, then any tile that a build has not reserved. */
	function pickTile() {
		const available = tiles.filter((tile) => !tile.reserved);
		const free = available.filter((tile) => !tile.image);
		const candidates = free.length ? free : available;
		if (!candidates.length) return null;
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
			})
			.filter((block) => block.every((tile) => !tile.reserved));
		if (!blocks.length) return null;

		const occupancy = (block) => block.filter((tile) => tile.image).length;
		const best = Math.min(...blocks.map(occupancy));
		const candidates = blocks.filter((block) => occupancy(block) === best);
		return candidates[Math.floor(Math.random() * candidates.length)];
	}

	function mount(tile, image, beat, { pulse = true } = {}) {
		tile.element.replaceChildren();
		image.addEventListener("error", () => {
			if (tile.image === image) tile.image = null;
			image.remove();
		});

		tile.image = image;
		tile.placedAt = beat;
		tile.element.append(image);
		if (!pulse) return;

		const pulseAnimation = image.animate(
			[{ transform: "scale(1.08)" }, { transform: "scale(1)" }, { transform: "scale(1.08)" }],
			{ duration: clock.beatDuration, iterations: Infinity, easing: "ease-in-out" },
		);
		clock.sync(pulseAnimation);
	}

	function createImage(artwork, url) {
		const image = document.createElement("img");
		image.className = "tile-image";
		image.alt = artwork.title ?? "";
		image.src = url;
		return image;
	}

	/** Orders cells by the beat on which the current flash pattern first lights them. */
	function revealOrder(targets) {
		const pattern = PATTERNS[patternIndex];
		const firstLit = (tile) => {
			for (let beat = 0; beat < targets.length; beat++) {
				if (pattern(tile.col, tile.row, beat, cols, rows)) return beat;
			}
			return targets.length;
		};

		return targets
			.map((tile, index) => ({ index, key: firstLit(tile) + Math.random() }))
			.sort((a, b) => a.key - b.key)
			.map(({ index }) => index);
	}

	/** Reserves the block so the cells can land one beat at a time. */
	function startBuild(artwork, plan, targets) {
		for (const tile of targets) tile.reserved = true;

		builds.push({
			artwork,
			plan,
			targets,
			order: revealOrder(targets),
			perBeat: Math.ceil(targets.length / BUILD_REVEAL_BEATS),
			revealed: 0,
			peeled: 0,
			completedAt: null,
		});

		for (const listener of dropListeners) listener(artwork);
	}

	function revealCells(build, beat) {
		const { artwork, plan, targets, order, perBeat } = build;
		for (const index of order.slice(build.revealed, build.revealed + perBeat)) {
			const image = createImage(artwork, plan.tiles[index].frames[0]);
			image.classList.add("tile-image--cell");
			mount(targets[index], image, beat, { pulse: false });
		}

		build.revealed = Math.min(targets.length, build.revealed + perBeat);
		if (build.revealed === targets.length) build.completedAt = beat;
	}

	/** Removes cells in reverse order of arrival and frees their tiles. */
	function peelCells(build) {
		const { targets, order, perBeat } = build;
		const end = targets.length - build.peeled;
		for (const index of order.slice(Math.max(0, end - perBeat), end)) {
			targets[index].reserved = false;
			clear(targets[index]);
		}

		build.peeled = Math.min(targets.length, build.peeled + perBeat);
	}

	/** Frees every tile held by a build so a whole-floor build can start clean. */
	function cancelBuilds() {
		for (const build of builds) {
			for (const tile of build.targets) {
				tile.reserved = false;
				clear(tile);
			}
		}
		builds = [];
	}

	/** Lays, holds, then peels every build in progress. */
	function advanceBuilds(beat) {
		for (const build of builds) {
			if (build.completedAt === null) revealCells(build, beat);
			else if (beat - build.completedAt >= BUILD_HOLD_BEATS) peelCells(build);
		}

		builds = builds.filter((build) => build.peeled < build.targets.length);
	}

	/** Lands a fully fetched effect on the tiles it needs. */
	function placePlan({ artwork, plan }, beat) {
		if (plan.reveal) pendingReveals--;
		if (plan.reveal && plan.block.cols === cols && plan.block.rows === rows) cancelBuilds();

		const single = plan.block.cols === 1 && plan.block.rows === 1;
		const targets = single ? [pickTile()] : pickBlock(plan.block);
		if (single && !targets[0]) return;
		if (!targets) return placePlan({ artwork, plan: planEffect(artwork, grid(), "single") }, beat);
		if (plan.reveal) return startBuild(artwork, plan, targets);

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
			advanceBuilds(beat);
			flash(beat);

			const ready = queuedPlans;
			queuedPlans = [];
			for (const queued of ready) placePlan(queued, beat);
		},

		onDrop(listener) {
			dropListeners.add(listener);
		},

		/** True while a build is being fetched, laid, held, or peeled. */
		building() {
			return builds.length > 0 || pendingReveals > 0;
		},

		/**
		 * Drops a harvested artwork onto a free tile straight away.
		 * @param {Object} artwork
		 * @param {number} beat
		 */
		place(artwork, beat) {
			const tile = pickTile();
			if (!tile) return null;
			mount(tile, createImage(artwork, tileURL(artwork)), beat);
			for (const listener of dropListeners) listener(artwork);
			return tile;
		},

		/**
		 * Fetches a live IIIF effect, then lands it on the first beat after it arrives.
		 * @param {Object} artwork
		 * @param {string} [effect] a named effect instead of a random one
		 */
		placeLive(artwork, effect) {
			const plan = planEffect(artwork, grid(), effect);
			if (plan.reveal) pendingReveals++;
			return Promise.all(planURLs(plan).map(decodeImage)).then(() => {
				queuedPlans.push({ artwork, plan });
			});
		},
	};
}
