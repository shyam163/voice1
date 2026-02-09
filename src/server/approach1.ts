/**
 * Approach 1: OpenAI Realtime API — WebRTC signaling.
 * The browser sends an SDP offer, we relay it to OpenAI and return the answer.
 */

const SYSTEM_PROMPT = `You are a helpful customer support agent. Be concise and friendly.
Ask clarifying questions when needed. Keep responses under 2-3 sentences.`;

export async function createRealtimeSession(apiKey: string, sdpOffer: string): Promise<string> {
	const resp = await fetch('https://api.openai.com/v1/realtime/sessions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: 'gpt-4o-realtime-preview',
			voice: 'verse',
			instructions: SYSTEM_PROMPT,
			input_audio_transcription: { model: 'whisper-1' },
			turn_detection: { type: 'server_vad' }
		})
	});

	if (!resp.ok) {
		const err = await resp.text();
		throw new Error(`OpenAI session creation failed: ${resp.status} ${err}`);
	}

	const session = await resp.json();
	const ephemeralKey = session.client_secret?.value;
	if (!ephemeralKey) throw new Error('No ephemeral key in session response');

	// Now do the WebRTC SDP exchange with the ephemeral key
	const sdpResp = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${ephemeralKey}`,
			'Content-Type': 'application/sdp'
		},
		body: sdpOffer
	});

	if (!sdpResp.ok) {
		const err = await sdpResp.text();
		throw new Error(`OpenAI SDP exchange failed: ${sdpResp.status} ${err}`);
	}

	return sdpResp.text();
}
