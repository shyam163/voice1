import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createRealtimeSession } from '../../../server/approach1';
import { OPENAI_API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	if (!OPENAI_API_KEY) throw error(500, 'OPENAI_API_KEY not configured');

	const { sdp } = await request.json();
	if (!sdp) throw error(400, 'Missing SDP offer');

	const answerSdp = await createRealtimeSession(OPENAI_API_KEY, sdp);
	return new Response(answerSdp, {
		headers: { 'Content-Type': 'application/sdp' }
	});
};
