import { auth } from "./auth.mjs";
import { BasePlayer } from "./base-player.mjs";

function draw_viz(draw_context, analyzer_node) {
	draw_context.resetTransform();
	draw_context.strokeStyle = 'white';
	draw_context.fillStyle = '';
	draw_context.lineWidth = 2;
	
	const offset_y = draw_context.canvas.height / 2;
	const scale_y = offset_y;

	const data = new Float32Array(draw_context.canvas.width);

	function step_viz() {

		analyzer_node.getFloatTimeDomainData(data);

		draw_context.clearRect(0, 0, draw_context.canvas.width, draw_context.canvas.height);
		draw_context.beginPath();
		for (let x = 0; x < draw_context.canvas.width; ++x) {
			draw_context.lineTo(x, offset_y + scale_y * data[x]);
		}
		draw_context.stroke();

		if (analyzer_node.context.state == 'running') requestAnimationFrame(step_viz);
	}
	step_viz();
}

export class FancyPlayer extends HTMLElement {
	#inner = new BasePlayer();
	#actx = new AudioContext();
	#mes_node = new MediaElementAudioSourceNode(this.#actx, { mediaElement: this.#inner });
	#an_node = new AnalyserNode(this.#actx, {fftSize: 1024});
	#canvas = document.createElement('canvas');
	#dctx = this.#canvas.getContext('2d');

	#tracks = [];
	#shuffle;
	#i = 0;

	constructor() {
		super();

		// Setup the edges of the audio context's graph
		this.#mes_node.connect(this.#actx.destination);
		this.#mes_node.connect(this.#an_node);

		// Setup the waveform vis
		this.#canvas.width = this.#an_node.fftSize;
		this.#canvas.height = 50;
		// TODO: Animation frame
		this.#inner.addEventListener('play', async () => {
			await this.#actx.resume();
			draw_viz(this.#dctx, this.#an_node);
		});
		this.#inner.addEventListener('pause', async () => await this.#actx.suspend());

		this.attachShadow({mode: 'open'});
		this.shadowRoot.innerHTML = `
			<link rel="stylesheet" href="${new URL('./fancy-player.css', import.meta.url)}">
			<img width="300" height="300">
			<div class="controls">
				<button id="previoustrack">⏮</button>
				<button id="playpause">⏯</button>
				<button id="nexttrack">⏭</button>
			</div>
			<h1><a id="title">Title</a></h1>
			<p><a id="album">Album</a></p>
			<p><a id="artist">Artist</a></p>
		`;
		this.shadowRoot.append(this.#canvas, this.#inner);

		this.#inner.addEventListener('media-metadata', ({metadata}) => {
			navigator.mediaSession.metadata = metadata;
			const update_dom = async () => {
				// TODO: Add hrefs to the links
				this.shadowRoot.querySelector('#title').innerText = metadata.title;
				this.shadowRoot.querySelector('#album').innerText = metadata.album;
				this.shadowRoot.querySelector('#artist').innerText = metadata.artist;
				if (metadata.artwork[0]?.src) {
					const img = new Image(300, 300);
					img.src = metadata.artwork[0].src;
					this.shadowRoot.querySelector('img').replaceWith(img);
					// Wait for the image to load:
					await new Promise(res => img.addEventListener('load', res, {once: true}));
				}
			};
			if (document.startViewTransition) {
				document.startViewTransition(update_dom);
			} else {
				update_dom();
			}
			// navigator.mediaSession.playbackState = 'paused';
		});

		const update_position_state = () => {
			navigator.mediaSession.setPositionState({
				duration: this.#inner.duration,
				playbackRate: this.#inner.playbackRate,
				position: this.#inner.currentTime
			});
		};
		this.#inner.addEventListener('durationchange', update_position_state);
		this.#inner.addEventListener('ratechange', update_position_state);
		this.#inner.addEventListener('seeked', update_position_state);

		const update_playback_state = () => {
			navigator.mediaSession.playbackState = this.#inner.paused ? 'paused' : 'playing';
		};
		this.#inner.addEventListener('playing', update_playback_state);
		this.#inner.addEventListener('pause', update_playback_state);
		this.#inner.addEventListener('waiting', update_playback_state);

		navigator.mediaSession.setActionHandler('play', () => this.#inner.play());
		navigator.mediaSession.setActionHandler('pause', () => this.#inner.pause());
		navigator.mediaSession.setActionHandler('seekto', ({fastSeek, seekTime}) => {
			if (fastSeek) {
				this.#inner.fastSeek(seekTime);
			} else {
				this.#inner.currentTime = seekTime;
			}
		});

		this.shadowRoot.addEventListener('click', ({target}) => {
			if (target.matches('button#previoustrack')) {
				this.switch_track(-1);
			}
			else if (target.matches('button#playpause')) {
				this.#inner.paused ? this.#inner.play() : this.#inner.pause();
			}
			else if (target.matches('button#nexttrack')) {
				this.switch_track(1);
			}
		});
		navigator.mediaSession.setActionHandler('nexttrack', () => this.switch_track(1));
		navigator.mediaSession.setActionHandler('previoustrack', () => this.switch_track(-1));
		this.#inner.addEventListener('ended', () => this.switch_track(1));
		this.#inner.autoplay = true;

		navigation.addEventListener('navigate', e => {
			console.log(e);
			if (e.canIntercept) {
				e.intercept({
					async handler() { await this.load_tracks(e.destination); }
				});
			}
		});

		this.load_tracks();
	}
	switch_track(dir = 1) {
		const new_i = this.#i + dir;
		if (dir == -1 && this.#inner.currentTime > 10) {
			this.#inner.currentTime = 0;
			return;
		}
		else if (new_i < 0) {
			this.#i = 0;
		}
		else if (new_i >= this.#tracks.length) {
			this.#i = 0;
			this.#inner.pause();
		} else {
			this.#i = new_i;
		}

		// TODO: Shuffling?
		const songid = this.#tracks[this.#i];
		if (songid) {
			this.#inner.setAttribute('songid', songid);
		}
	}
	async load_tracks(url = location) {
		const single_track = new URLPattern({pathname: '/track/:id'});
		let res = single_track.exec(url);
		if (res) {
			debugger;
		}

		const playlist = new URLPattern({pathname: '/playlist/:id'});
		res = playlist.exec(url);
		if (res) {
			const {id} = res.pathname.groups;

			// TODO: Support fetching more than the first page of tracks.
			const {tracks: {items, next}} = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}`, {
				headers: { ...await auth(), accept: 'application/json' }
			}).then(res => res.json());

			this.#tracks = items.map(v => v?.track?.id).filter(t => typeof t == 'string');
		}

		const artist = new URLPattern({pathname: '/artist/:id'});
		res = artist.exec(url);
		if (res) {
			debugger;
		}

		const album = new URLPattern({pathname: '/album/:id'});
		res = album.exec(url);
		if (res) {
			debugger;
		}

		this.#i = 0;
		this.switch_track(0);
	}
}
customElements.define('fancy-player', FancyPlayer);
