import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createRoomToken } from '../../../server/approach3';
import { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
		throw error(500, 'LiveKit credentials not configured');
	}

	const { room, name, voice, systemPrompt, llmProvider } = await request.json();
	const metadata: Record<string, string> = {};
	if (voice) metadata.voice = voice;
	if (systemPrompt) metadata.systemPrompt = systemPrompt;
	if (llmProvider) metadata.llmProvider = llmProvider;
	const token = await createRoomToken(
		{ apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET, url: LIVEKIT_URL },
		room || `room-${Date.now()}`,
		name || 'user',
		Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : undefined
	);

	return json({ token, url: LIVEKIT_URL });
};
