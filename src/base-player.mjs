import { auth } from "./auth.mjs";
import system from "./drm.mjs";
import {SpotifyKeys} from "./license.mjs";
import { b62_to_hex } from "./b62.mjs";

// Map: Spotify format field -> codec
const formats = new Map([
	['OGG_VORBIS_320', 'audio/ogg; codecs="vorbis"'],
	['MP4_256', 'audio/mp4; codecs="mp4a.40.2"'],
	['OGG_VORBIS_160', 'audio/ogg; codecs="vorbis"'],
	['MP4_128', 'audio/mp4; codecs="mp4a.40.2"'],
	['OGG_VORBIS_96', 'audio/ogg; codecs="vorbis"'],
	['AAC_24', 'audio/mp4; codecs="flac"'],
]);

function codec_supported(codec) {
	const conf = system.getConfiguration();
	const drm_codecs = [...conf.audioCapabilities, ...conf.videoCapabilities].map(c => c.contentType);

	return MediaSource.isTypeSupported(codec) && drm_codecs.includes(codec);
}

async function* files(gid, signal) {
	try {
		const metadata = await fetch(`https://spclient.wg.spotify.com/metadata/4/track/${encodeURIComponent(gid)}?market=from_token`, {
			signal,
			headers: {
				...await auth(),
				accept: 'application/json'
			}
		}).then(res => res.json());

		// Fill a map with the format -> file_id
		const file_ids = new Map(
			Array.from(metadata?.file ?? [])
				.filter(f => typeof f?.file_id == 'string' && typeof f?.format == 'string')
				.map(({file_id, format}) => [format, file_id])
		);

		// Iterate over the file_ids, but prioritize them by the order of the formats map instead of the order of the file things
		for (const [format, codec] of Array.from(formats.entries())) {
			try {
				const file_id = file_ids.get(format);
				if (!file_id || !codec_supported(codec)) continue;
	
				// Resolve the file_id to cdnurls
				const resolved = await fetch(`https://spclient.wg.spotify.com/storage-resolve/v2/files/audio/interactive/10/${encodeURIComponent(file_id)}?alt=json`, {
					signal,
					headers: {
						...await auth(),
						accept: 'application/json'
					}
				}).then(res => res.json());

				yield { ...metadata, file: resolved, format, codec };
			} catch {}
		}

		// Yield files for alternatives:
		for (const {gid} of Array.from(metadata?.alternative ?? []).filter(a => typeof a?.gid == 'string')) {
			yield* files(gid, signal);
		}
	} catch {}
}

class MediaMetadataExt extends MediaMetadata {
	title_ext;
	album_ext;
	artists_ext;
	raw;
	constructor(metadata) {
		const title = metadata.name;
		const album = metadata.album?.name;
		const artist = Array.from(metadata.artist ?? []).map(a => a?.name).join(', ');
		const artwork = Array.from(metadata.album?.cover_group?.image ?? [])
			.filter(i => typeof i?.width == 'number' && typeof i?.height == 'number' && typeof i?.file_id == 'string')
			.map(i => ({
				src: `https://i.scdn.co/image/${encodeURIComponent(i.file_id)}`,
				sizes: `${i.width}x${i.height}`
			}));
		super({title, album, artist, artwork});
		this.raw = metadata;
	}
}
class MetadataEvent extends CustomEvent {
	constructor(metadata) {
		super('media-metadata', {bubbles: true});
		this.metadata = metadata;
	}
}
export class BasePlayer extends HTMLAudioElement {
	mediaKeys = SpotifyKeys.new_keys().then(async keys => {
		await this.setMediaKeys(keys);
		this.mediaKeys = keys;
		return keys;
	});
	constructor() {
		super();
		this.preservesPitch = false;
		// DEBUG:
		[
			'abort', 'error', 'license-error', 'stalled',
			'encrypted', 'waiting',
			'pause', 'play', 'ended',
			'loadedmetadata', 'loadstart', 'durationchange', 'emptied',
			'playing', 'suspend',
			'canplay', 'canplaythrough', 
			'seeked', 'seeking', 'ratechange', 'volumechange',
			// 'timeupdate', 'progress',
		].forEach(ev => this.addEventListener(ev, console.log));
	}
	static observedAttributes = ['songid'];
	async attributeChangedCallback(_attr, old_songid, songid) {
		if (old_songid == songid) return;

		const gid = (songid.length == 22) ? b62_to_hex(songid) : songid;
		
		// EME requires us to use MSE
		const ms = new MediaSource(); {
			const url = URL.createObjectURL(ms);
			this.src = url;
			ms.addEventListener('sourceclose', () => URL.revokeObjectURL(url));
			await new Promise(res => ms.addEventListener('sourceopen', res, {once: true}));
		}

		// Cancel Download if the player starts playing a different song
		let signal; {
			const controller = new AbortController();
			signal = controller.signal;
			ms.addEventListener('sourceclose', () => controller.abort('source closed'));
		}

		// Wait for the key container to become ready (if it isn't already)
		await this.mediaKeys;

		try {
			let buff;
			for await(const metadata of files(gid, signal)) {
				// Create / reconfigure the audio source buffer
				if (!buff) {
					buff = ms.addSourceBuffer(metadata.codec);
				} else {
					if (buff.updating) {
						buff.abort();
						await new Promise(res => buff.addEventListener('updateend', res, {once: true}));
					}
					buff.changeType(metadata.codec);
					buff.timestampOffset = 0;
					buff.remove(0, Infinity);
					await new Promise(res => buff.addEventListener('updateend', res, {once: true}));
				}

				// Pass along the metadata
				this.dispatchEvent(new MetadataEvent(new MediaMetadataExt(metadata)));

				// Handle licensing
				const licensed = new Promise((res, rej) => {
					const session = this.mediaKeys.createSession('temporary', signal);
					this.addEventListener('encrypted', async ({initDataType, initData}) => {
						// As we download the ecrypted file, the audio tag will extract the initialization data we need to pass to the keysession
						await session.generateRequest(initDataType, initData);
					}, {once: true});
					session.addEventListener('keystatuseschange', () => {
						// Licensing succeeds when all keys are usable, and there is at least one key
						if (session.keyStatuses.size && Array.from(session.keyStatuses.values()).every(status => status == 'usable')) res();
					});
					session.addEventListener('license-error', e => {
						rej(e);

						// Push this codec to the back of the formats map:
						formats.delete(metadata.format);
						formats.set(metadata.format, metadata.codec);
					});
					// Release any / all licenses when the audio tag changes source
					ms.addEventListener('sourceclose', async () => await session.close());
				});

				// Abort reading the file if licensing fails
				let file_signal; {
					const cont = new AbortController();
					signal.addEventListener('abort', () => cont.abort(signal.reason));
					licensed.catch(e => cont.abort(e));
					file_signal = cont.signal;
				}

				// Read the encrypted file from the first URL that succeeds
				let reader; for (const url of Array.from(metadata.file.cdnurl ?? [])) {
					const res = await fetch(url, {signal: file_signal});
					if (res.ok) {
						reader = res.body.getReader()
						break;
					}
				}
				if (!reader) continue;

				// Stream the encrypted file to the source buffer
				try {
					while (1) {
						const {done, value} = await reader.read();
						if (buff.updating) await new Promise(res => buff.addEventListener('updateend', res, {once: true}));
						if (file_signal.aborted || done) break;
						buff.appendBuffer(value);
					}
	
					await licensed;

					// Once the file has been both loaded and licensed then we're done handling the songid attribute change and we can end the stream
					ms.endOfStream();
					return;
				} catch (e) {
					if (signal.aborted) break;
					// If the user hasn't switched song playback then we'll continue the loop and try another file.
					else { /* We'll continue the loop and try another file for this song */ }
				}
			}
			throw new Error('Playback failed for all file options of this song')
		} catch (e) {
			ms.endOfStream(e);
			throw e;
		}
	}
}
customElements.define('base-player', BasePlayer, {extends: 'audio'});
