/**
 * Filming a play-test: the pull request's video and screenshots come from
 * the real game, running the real map, against real bots.
 *
 * The game's canvas is WebGL without `preserveDrawingBuffer`, so reading it
 * outside its own frame returns black. `captureStream` is the one reader that
 * sees every presented frame, so the pipeline is:
 *
 *   game canvas ─captureStream→ <video> ─drawImage→ 800×600 canvas ─captureStream→ MediaRecorder
 *
 * The middle canvas pins the output to the game's logical 800×600 whatever the
 * player's device pixel ratio — a Retina play-test would otherwise be a
 * 1600×1200 clip four times the size for no detail anybody reviews — and it is
 * also what a snapshot reads.
 */

const CLIP_W = 800;
const CLIP_H = 600;
/** One clip, kept short: it is committed to the repository with the map. */
export const MAX_CLIP_SECONDS = 20;
const CLIP_BITRATE = 1_400_000;
const FPS = 30;

const MIME_CANDIDATES = [
	"video/webm;codecs=vp9",
	"video/webm;codecs=vp8",
	"video/webm",
	"video/mp4;codecs=avc1",
	"video/mp4",
];

export function clipMime(): string | null {
	if (typeof MediaRecorder === "undefined") return null;
	return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export function clipExtension(mime: string): "webm" | "mp4" {
	return mime.includes("mp4") ? "mp4" : "webm";
}

export class Capture {
	private readonly video = document.createElement("video");
	private readonly frame = document.createElement("canvas");
	private readonly ctx: CanvasRenderingContext2D;
	private source: MediaStream | null = null;
	private output: MediaStream | null = null;
	private raf = 0;
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private startedAt = 0;
	private stopTimer = 0;
	private resolveStop:
		| ((clip: { blob: Blob; seconds: number } | null) => void)
		| null = null;

	constructor() {
		this.frame.width = CLIP_W;
		this.frame.height = CLIP_H;
		const ctx = this.frame.getContext("2d");
		if (!ctx) throw new Error("capture: no 2d context");
		this.ctx = ctx;
		this.video.muted = true;
		this.video.playsInline = true;
	}

	/** Attach to the game's canvas. Safe to call again after the game reloads. */
	async attach(gameCanvas: HTMLCanvasElement): Promise<void> {
		this.detachSource();
		this.source = gameCanvas.captureStream(FPS);
		this.video.srcObject = this.source;
		await this.video.play().catch(() => undefined);
		if (!this.output) this.output = this.frame.captureStream(FPS);
		const pump = () => {
			if (this.video.readyState >= 2) {
				this.ctx.drawImage(this.video, 0, 0, CLIP_W, CLIP_H);
			}
			this.raf = requestAnimationFrame(pump);
		};
		cancelAnimationFrame(this.raf);
		pump();
	}

	get attached(): boolean {
		return this.source !== null && this.video.readyState >= 2;
	}

	get recording(): boolean {
		return this.recorder?.state === "recording";
	}

	/** Seconds into the current take. */
	get elapsed(): number {
		return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
	}

	/** Start a take. It stops itself at `MAX_CLIP_SECONDS`. */
	start(
		onAutoStop: (clip: { blob: Blob; seconds: number } | null) => void,
	): boolean {
		const mime = clipMime();
		if (!mime || !this.output || this.recording) return false;
		this.chunks = [];
		this.recorder = new MediaRecorder(this.output, {
			mimeType: mime,
			videoBitsPerSecond: CLIP_BITRATE,
		});
		this.recorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.chunks.push(e.data);
		};
		this.recorder.onstop = () => {
			const seconds = (performance.now() - this.startedAt) / 1000;
			const blob = new Blob(this.chunks, { type: mime.split(";")[0] ?? mime });
			const clip = blob.size > 0 ? { blob, seconds } : null;
			const resolve = this.resolveStop;
			this.resolveStop = null;
			if (resolve) resolve(clip);
			else onAutoStop(clip);
		};
		this.startedAt = performance.now();
		this.recorder.start(1000);
		window.clearTimeout(this.stopTimer);
		this.stopTimer = window.setTimeout(() => {
			if (this.recording) this.recorder?.stop();
		}, MAX_CLIP_SECONDS * 1000);
		return true;
	}

	/** Finish the take; resolves with the clip (or null if nothing was filmed). */
	stop(): Promise<{ blob: Blob; seconds: number } | null> {
		window.clearTimeout(this.stopTimer);
		if (!this.recording || !this.recorder) return Promise.resolve(null);
		return new Promise((resolve) => {
			this.resolveStop = resolve;
			this.recorder?.stop();
		});
	}

	/** The current frame as a PNG, or null before the first frame arrives. */
	snapshot(): Promise<Blob | null> {
		if (!this.attached) return Promise.resolve(null);
		// Read straight from the video, not the pump's last draw, so a snapshot
		// is never a frame behind.
		this.ctx.drawImage(this.video, 0, 0, CLIP_W, CLIP_H);
		if (blank(this.ctx)) return Promise.resolve(null);
		return new Promise((resolve) =>
			this.frame.toBlob((b) => resolve(b), "image/png"),
		);
	}

	private detachSource() {
		for (const t of this.source?.getTracks() ?? []) t.stop();
		this.source = null;
	}

	dispose() {
		window.clearTimeout(this.stopTimer);
		cancelAnimationFrame(this.raf);
		if (this.recording) this.recorder?.stop();
		this.detachSource();
		for (const t of this.output?.getTracks() ?? []) t.stop();
		this.output = null;
		this.video.srcObject = null;
	}
}

/** A frame that is one flat colour is a frame from before the game drew. */
function blank(ctx: CanvasRenderingContext2D): boolean {
	const { data } = ctx.getImageData(0, 0, CLIP_W, CLIP_H);
	const r = data[0];
	const g = data[1];
	const b = data[2];
	for (let i = 0; i < data.length; i += 4 * 997) {
		if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b) return false;
	}
	return true;
}
