import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { OPENAI_API_KEY } from '$env/static/private';

/** Batch STT via OpenAI Whisper — accepts audio as base64 PCM, returns transcript */
export const POST: RequestHandler = async ({ request }) => {
	if (!OPENAI_API_KEY) throw error(500, 'OPENAI_API_KEY not configured');

	const { audio, sampleRate } = await request.json();
	if (!audio) throw error(400, 'Missing audio data');

	// Decode base64 PCM Int16 and wrap in WAV
	const pcmBytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
	const wav = createWav(pcmBytes, sampleRate || 16000, 1, 16);

	const form = new FormData();
	form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
	form.append('model', 'whisper-1');

	const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
		body: form
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw error(resp.status, `OpenAI Whisper error: ${text}`);
	}

	const result = await resp.json();
	return json({ text: result.text });
};

function createWav(pcm: Uint8Array, sampleRate: number, channels: number, bitsPerSample: number): ArrayBuffer {
	const byteRate = sampleRate * channels * (bitsPerSample / 8);
	const blockAlign = channels * (bitsPerSample / 8);
	const buf = new ArrayBuffer(44 + pcm.length);
	const view = new DataView(buf);

	// RIFF header
	writeString(view, 0, 'RIFF');
	view.setUint32(4, 36 + pcm.length, true);
	writeString(view, 8, 'WAVE');

	// fmt chunk
	writeString(view, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);

	// data chunk
	writeString(view, 36, 'data');
	view.setUint32(40, pcm.length, true);
	new Uint8Array(buf, 44).set(pcm);

	return buf;
}

function writeString(view: DataView, offset: number, str: string) {
	for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
