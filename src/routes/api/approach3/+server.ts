import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createRoomToken } from '../../../server/approach3';
import { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
		throw error(500, 'LiveKit credentials not configured');
	}

	const { room, name, voice } = await request.json();
	const token = await createRoomToken(
		{ apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET, url: LIVEKIT_URL },
		room || `room-${Date.now()}`,
		name || 'user',
		voice ? JSON.stringify({ voice }) : undefined
	);

	return json({ token, url: LIVEKIT_URL });
};
