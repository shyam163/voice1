/**
 * Approach 2: STT → LLM → TTS Pipeline
 * Server-side orchestration for the pipeline approach.
 */

export interface CartesiaOptions {
	speed?: number;
	emotion?: string[];
	voiceId?: string;
}

export interface GoogleTTSOptions {
	voiceName?: string;
	languageCode?: string;
}

export interface PipelineConfig {
	deepgramKey: string;
	groqKey?: string;
	anthropicKey?: string;
	openaiKey?: string;
	cartesiaKey: string;
	googleTtsKey?: string;
	llmProvider: 'groq' | 'anthropic' | 'openai';
	ttsProvider?: string;
	useCartesiaEmotions?: boolean;
	cartesiaOptions?: CartesiaOptions;
	googleTtsOptions?: GoogleTTSOptions;
	systemPrompt?: string;
	cartesiaEmotionPrompt?: string;
}

const QUANTUM_AUTOMATA_PROMPT = `You are a friendly, professional voice assistant for Quantum Automata, an end-to-end automation company based in Kochi, Kerala, India.

About the company:
- Quantum Automata specializes in custom hardware, embedded systems, and AI-powered solutions.
- Services include: PCB design, Battery Management Systems (BMS), IoT solutions, AI video analytics, WhatsApp chatbots, voice agents, and building automation (HVAC, lighting, access control).
- Website: quantumautomata.in
- Contact: +91 98464 22115

Be concise and friendly. Keep responses to 2-3 sentences. Answer questions about the company knowledgeably. For topics outside the company's domain, be helpful but brief.`;

const CARTESIA_EMOTION_INSTRUCTIONS = `

IMPORTANT — Your text output will be spoken aloud through Cartesia TTS, which supports inline emotion and expressiveness tags. You MUST use these to make the conversation lively, warm, giggly, and fun — like chatting with an enthusiastic friend!

Available tags you can insert inline in your response text:
- <emotion value="excited"/> before enthusiastic or energetic sentences
- <emotion value="happy"/> before cheerful, positive sentences
- <emotion value="curious"/> before questions or inquisitive statements
- <emotion value="content"/> before calm, satisfied statements
- <emotion value="sad"/> before sympathetic or empathetic moments
- <emotion value="surprised"/> before reacting to something unexpected
- <emotion value="angry"/> for playful frustration or strong emphasis
- [laughter] — sprinkle these generously! Laugh naturally between sentences, after jokes, or when being playful
- <break time="300ms"/> for short pauses, <break time="500ms"/> for dramatic pauses
- <speed ratio="1.2"/> to speed up for excitement, <speed ratio="0.8"/> to slow down for emphasis

Style guidelines:
- Be bubbly and expressive! Use [laughter] often — after greetings, when something is fun or interesting, or just to keep the vibe light
- Mix emotions throughout your responses, don't just use one
- Add a <break> before important points for dramatic effect
- Keep the energy high and the conversation feeling like a fun chat, not a corporate script`;

/** Call LLM with streaming, returns an async iterator of text chunks */
export async function* streamLLM(
	config: PipelineConfig,
	messages: { role: string; content: string }[]
): AsyncGenerator<string> {
	let systemContent = config.systemPrompt || QUANTUM_AUTOMATA_PROMPT;
	if (config.useCartesiaEmotions && config.ttsProvider === 'cartesia') {
		systemContent += '\n\n' + (config.cartesiaEmotionPrompt || CARTESIA_EMOTION_INSTRUCTIONS);
	}

	const systemMsg = {
		role: 'system',
		content: systemContent
	};

	if (config.llmProvider === 'groq') {
		const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${config.groqKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: 'llama-3.3-70b-versatile',
				messages: [systemMsg, ...messages],
				stream: true,
				frequency_penalty: 0.7,
				presence_penalty: 0.5
			})
		});
		if (!resp.ok) throw new Error(`Groq error: ${resp.status}`);
		yield* parseSSEStream(resp.body!);
	} else if (config.llmProvider === 'anthropic') {
		const resp = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'x-api-key': config.anthropicKey!,
				'anthropic-version': '2023-06-01',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: 'claude-haiku-4-5-20251001',
				max_tokens: 256,
				system: systemMsg.content,
				messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
				stream: true
			})
		});
		if (!resp.ok) throw new Error(`Anthropic error: ${resp.status}`);
		yield* parseAnthropicSSE(resp.body!);
	} else {
		const resp = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${config.openaiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [systemMsg, ...messages],
				stream: true,
				frequency_penalty: 0.7,
				presence_penalty: 0.5
			})
		});
		if (!resp.ok) throw new Error(`OpenAI error: ${resp.status}`);
		yield* parseSSEStream(resp.body!);
	}
}

async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		const lines = buf.split('\n');
		buf = lines.pop()!;
		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const data = line.slice(6);
			if (data === '[DONE]') return;
			try {
				const json = JSON.parse(data);
				const text = json.choices?.[0]?.delta?.content;
				if (text) yield text;
			} catch {}
		}
	}
}

async function* parseAnthropicSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		const lines = buf.split('\n');
		buf = lines.pop()!;
		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			try {
				const json = JSON.parse(line.slice(6));
				if (json.type === 'content_block_delta' && json.delta?.text) {
					yield json.delta.text;
				}
			} catch {}
		}
	}
}

export type TTSProvider = 'deepgram' | 'openai' | 'cartesia' | 'google' | 'qwen3';

export interface TTSKeys {
	deepgramKey?: string;
	openaiKey?: string;
	cartesiaKey?: string;
	googleTtsKey?: string;
	qwen3Url?: string;
}

/** Synthesize speech using the selected TTS provider. Returns MP3/WAV audio. */
export async function synthesizeSpeech(
	provider: TTSProvider,
	keys: TTSKeys,
	text: string,
	cartesiaOptions?: CartesiaOptions,
	deepgramVoice?: string,
	googleTtsOptions?: GoogleTTSOptions
): Promise<{ audio: ArrayBuffer; format: 'mp3' | 'wav' }> {
	if (provider === 'deepgram') {
		if (!keys.deepgramKey) throw new Error('Deepgram key not configured');
		const dgModel = deepgramVoice || 'aura-2-asteria-en';
		const resp = await fetch(
			`https://api.deepgram.com/v1/speak?model=${dgModel}&encoding=mp3`,
			{
				method: 'POST',
				headers: {
					Authorization: `Token ${keys.deepgramKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ text })
			}
		);
		if (!resp.ok) throw new Error(`Deepgram TTS: ${resp.status}`);
		return { audio: await resp.arrayBuffer(), format: 'mp3' };
	}

	if (provider === 'openai') {
		if (!keys.openaiKey) throw new Error('OpenAI key not configured');
		const resp = await fetch('https://api.openai.com/v1/audio/speech', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${keys.openaiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: 'tts-1',
				input: text,
				voice: 'nova',
				response_format: 'mp3'
			})
		});
		if (!resp.ok) throw new Error(`OpenAI TTS: ${resp.status}`);
		return { audio: await resp.arrayBuffer(), format: 'mp3' };
	}

	if (provider === 'cartesia') {
		if (!keys.cartesiaKey) throw new Error('Cartesia key not configured');
		const voiceId = cartesiaOptions?.voiceId || '95d51f79-c397-46f9-b49a-23763d3eaa2d';
		const speed = cartesiaOptions?.speed ?? 1.0;
		const emotion = cartesiaOptions?.emotion ?? [];

		const body: Record<string, any> = {
			transcript: text,
			model_id: 'sonic-3',
			voice: { mode: 'id', id: voiceId },
			output_format: { container: 'wav', sample_rate: 24000, encoding: 'pcm_s16le' }
		};

		if (speed !== 1.0 || emotion.length > 0) {
			body.generation_config = {};
			if (speed !== 1.0) body.generation_config.speed = speed;
			if (emotion.length > 0) body.generation_config.emotion = emotion;
		}

		const resp = await fetch('https://api.cartesia.ai/tts/bytes', {
			method: 'POST',
			headers: {
				'X-API-Key': keys.cartesiaKey,
				'Cartesia-Version': '2025-04-16',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});
		if (!resp.ok) throw new Error(`Cartesia TTS: ${resp.status}`);
		return { audio: await resp.arrayBuffer(), format: 'wav' };
	}

	if (provider === 'qwen3') {
		if (!keys.qwen3Url) throw new Error('Qwen3 Colab URL not configured');
		const url = keys.qwen3Url.replace(/\/+$/, '') + '/tts';
		const resp = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, language: 'English' })
		});
		if (!resp.ok) throw new Error(`Qwen3 TTS: ${resp.status} ${await resp.text().catch(() => '')}`);
		return { audio: await resp.arrayBuffer(), format: 'wav' };
	}

	if (provider === 'google') {
		if (!keys.googleTtsKey) throw new Error('Google TTS key not configured');
		const voiceName = googleTtsOptions?.voiceName || 'en-IN-Standard-A';
		const languageCode = googleTtsOptions?.languageCode || voiceName.slice(0, 5); // e.g. "en-IN"
		const resp = await fetch(
			`https://texttospeech.googleapis.com/v1/text:synthesize?key=${keys.googleTtsKey}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					input: { text },
					voice: { languageCode, name: voiceName },
					audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 }
				})
			}
		);
		if (!resp.ok) throw new Error(`Google TTS: ${resp.status}`);
		const { audioContent } = await resp.json();
		// audioContent is base64 — decode to ArrayBuffer
		const binary = Buffer.from(audioContent, 'base64');
		return { audio: binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength), format: 'mp3' };
	}

	throw new Error(`Unknown TTS provider: ${provider}`);
}
