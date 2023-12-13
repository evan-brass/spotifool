import system from "./drm.mjs";
import { auth } from "./auth.mjs";

if (!system) throw new Error("No Key System");

// Get the certificate for Spotify's license API
const cert = await fetch(`https://spclient.wg.spotify.com/${system.nice_name}-license/v1/application-certificate`).then(res => res.arrayBuffer());

class LicenseError extends CustomEvent {
	constructor(detail) { super('license-error', {detail}) }
}

export class SpotifyKeys extends MediaKeys {
	createSession(sessionType, signal) {
		const ret = super.createSession(sessionType);
		ret.addEventListener('message', async ({message: body}) => {
			try {
				// TODO: Support video?
				const response = await fetch(`https://spclient.wg.spotify.com/${system.nice_name}-license/v1/audio/license`, {
					body,
					method: 'post',
					headers: { ...await auth() },
					signal
				});
				if (!response.ok) throw new Error(`License Failure (${response.status}): ${response.statusText}`);
				await ret.update(await response.arrayBuffer());
			} catch (e) {
				ret.dispatchEvent(new LicenseError(e));
			}
		});
		return ret;
	}
	static async new_keys() {
		const ret = await system.createMediaKeys();
		if (!await ret.setServerCertificate(cert)) throw new Error('Something happened while setting the certificate.');
		Object.setPrototypeOf(ret, this.prototype); // What are YOU lookin at, huh?
		return ret;
	}
}
