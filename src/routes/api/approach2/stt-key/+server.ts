import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DEEPGRAM_API_KEY } from '$env/static/private';

/** Return the Deepgram key for client-side WebSocket STT (temporary key in production) */
export const GET: RequestHandler = async () => {
	if (!DEEPGRAM_API_KEY) throw error(500, 'DEEPGRAM_API_KEY not configured');
	return json({ key: DEEPGRAM_API_KEY });
};
