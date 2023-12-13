/**
 * Request DRM key system
 */

// Enumerate all combinations of codecs and robustness
const contentTypes = [
	'audio/webm; codecs="opus"',
	'audio/mp4; codecs="flac"',
	'audio/mp4; codecs="mp4a.40.2"',
	'audio/ogg; codecs="vorbis"'
];
const robustnesses = [
	'SW_SECURE_DECODE',
	'SW_SECURE_CRYPTO',
	''
];
const combination_count = robustnesses.length * (2 ** (contentTypes.length) - 1);
const options = Array.from({length: combination_count}, (_, i) => {
	const robustness = robustnesses[i % robustnesses.length];
	const i2 = Math.trunc(i / robustnesses.length);
	const option = {
		label: 'drmsuxx' + i,
		initDataTypes: ['cenc'],
		audioCapabilities: contentTypes.filter((_, j) => !Boolean(2**j & i2)).map(contentType => ({
			contentType, robustness
		})),
		videoCapabilities: [],
		distinctiveIdentifier: 'optional',
		persistentState: 'optional',
		sessionTypes: ['temporary']
	};
	return option;
});
options.sort((a, b) => (
	b.audioCapabilities.length - a.audioCapabilities.length ||
	robustnesses.indexOf(a.audioCapabilities[0].robustness) - robustnesses.indexOf(b.audioCapabilities[0].robustness)
));

const key_systems = new Map([
	['fairplay', 'com.apple.fps.1_0'],
	['widevine', 'com.widevine.alpha'],
	['playready', 'com.microsoft.playready.hardware'],
	['playready', 'com.microsoft.playready']
]);

let system;
for (const [nice_name, keysystem] of key_systems.entries()) {
	try {
		system = await navigator.requestMediaKeySystemAccess(keysystem, options);
		system.nice_name = nice_name;
		break;
	} catch {}
}

export default system;
