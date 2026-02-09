import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CARTESIA_API_KEY } from '$env/static/private';

/** Generate a short-lived Cartesia access token for client-side STT WebSocket */
export const GET: RequestHandler = async () => {
	if (!CARTESIA_API_KEY) throw error(500, 'CARTESIA_API_KEY not configured');

	const resp = await fetch('https://api.cartesia.ai/access-token', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${CARTESIA_API_KEY}`,
			'Cartesia-Version': '2025-04-16',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ grants: { stt: true }, expires_in: 300 })
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw error(resp.status, `Cartesia token error: ${text}`);
	}

	const { token } = await resp.json();
	return json({ token });
};
