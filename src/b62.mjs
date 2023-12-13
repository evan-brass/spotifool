export function b62_to_hex(t, padlen = 32) {
	const bd = t.split('').map(s => '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(s));
	const n = bd.reverse().reduce((a, v, i) => a + BigInt(v) * 62n ** BigInt(i), 0n);

	return n.toString(16).padStart(padlen, '0');
}
export function hex_to_b62(t, padlen = 22) {
	let n = BigInt('0x' + t);
	let ret = '';
	while (n > 0n) {
		ret = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.charAt(Number(n % 62n)) + ret;
		n = n / 62n;
	}
	return ret.padStart(padlen, '0');
}
