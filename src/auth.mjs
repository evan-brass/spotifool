export let token = null;
try {
	token = JSON.parse(document.querySelector('script#session')?.innerText ?? null);
} catch {};

// Provide a login / logout buttton:
export const inout = document.createElement('button');
function update_inout() {
	if (token?.isAnonymous == false) {
		inout.innerText = 'Logout';
		inout.onclick = () => {
			token = null;
			fetch('/logout');
			update_inout();
		};
	} else {
		inout.innerText = 'Login';
		inout.onclick = () => location.replace('https://accounts.spotify.com/login?continue=' + encodeURIComponent(location));
	}
}
update_inout();

// Get an access token:
export async function get_token(tries = 2) {
	while (tries--) {
		try {
			if (token?.accessToken && Date.now() < token?.accessTokenExpirationTimestampMs) return token.accessToken;
			
			const res = await fetch('/get_access_token?reason=transport&productType=web-player');
			if (!res.ok) return;
	
			token = await res.json();
			update_inout();
		} catch {}
	}
}

// TODO: Switch to a context based system that passes a need-token event up to aquire a token

export async function auth() {
	const token = await get_token();
	if (!token) throw new Error("Couldn't get an auth token");
	return {
		'authorization': 'Bearer ' + token
	};
}
