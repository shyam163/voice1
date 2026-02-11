import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { streamLLM, synthesizeSpeech, type PipelineConfig, type TTSProvider, type CartesiaOptions, type GoogleTTSOptions } from '../../../server/approach2';
import { logConversation } from '../../../server/db';
import { GROQ_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, CARTESIA_API_KEY, DEEPGRAM_API_KEY, GOOGLE_TTS_API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	const {
		text,
		messages,
		llmProvider = 'groq',
		ttsProvider = 'deepgram',
		useCartesiaEmotions = false,
		cartesiaOptions,
		systemPrompt,
		cartesiaEmotionPrompt,
		deepgramVoice,
		googleTtsOptions,
		qwen3Url,
		sttProvider = 'unknown'
	} = await request.json();
	if (!text) throw error(400, 'Missing text');

	const config: PipelineConfig = {
		deepgramKey: DEEPGRAM_API_KEY,
		groqKey: GROQ_API_KEY,
		anthropicKey: ANTHROPIC_API_KEY,
		openaiKey: OPENAI_API_KEY,
		cartesiaKey: CARTESIA_API_KEY,
		llmProvider,
		ttsProvider,
		useCartesiaEmotions,
		systemPrompt,
		cartesiaEmotionPrompt
	};

	const allMessages = [...(messages || []), { role: 'user', content: text }];

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			let closed = false;
			const send = (type: string, data: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(JSON.stringify({ type, data }) + '\n'));
				} catch {
					closed = true;
				}
			};

			try {
				const llmStart = Date.now();
				let firstChunkTime = 0;
				let fullText = '';
				let sentenceBuf = '';
				const ttsKeys = { deepgramKey: DEEPGRAM_API_KEY, openaiKey: OPENAI_API_KEY, cartesiaKey: CARTESIA_API_KEY, googleTtsKey: GOOGLE_TTS_API_KEY, qwen3Url };
				let ttsMs = 0;
				let sentenceCount = 0;
				const doTts = ttsProvider !== 'none';
				// Chain ensures audio events are sent in sentence order even if TTS resolves out of order
				let sendChain: Promise<void> = Promise.resolve();

				const flushSentence = (text: string) => {
					if (!text.trim() || !doTts) return;
					sentenceCount++;
					const idx = sentenceCount;
					const ttsStart = Date.now();
					console.log(`[approach2] TTS chunk ${idx}: "${text.trim().slice(0, 50)}..."`);
					// Fire TTS immediately (parallel)
					const ttsPromise = synthesizeSpeech(
						ttsProvider as TTSProvider,
						ttsKeys,
						text.trim(),
						cartesiaOptions as CartesiaOptions | undefined,
						deepgramVoice,
						googleTtsOptions as GoogleTTSOptions | undefined
					);
					// But send audio in order via chain
					sendChain = sendChain.then(async () => {
						try {
							const { audio, format } = await ttsPromise;
							const chunkMs = Date.now() - ttsStart;
							ttsMs += chunkMs;
							const b64 = Buffer.from(audio).toString('base64');
							console.log(`[approach2] TTS chunk ${idx} done: ${(b64.length / 1024).toFixed(0)}KB in ${chunkMs}ms`);
							send('audio', JSON.stringify({ data: b64, format }));
						} catch (e: any) {
							console.error(`[approach2] TTS chunk ${idx} failed:`, e.message);
						}
					});
				};

				for await (const chunk of streamLLM(config, allMessages)) {
					if (!firstChunkTime) firstChunkTime = Date.now();
					fullText += chunk;
					sentenceBuf += chunk;
					send('text', chunk);

					// Check for sentence boundaries and flush
					const sentenceEnd = sentenceBuf.search(/[.!?][\s\n]|[.!?]$/);
					if (sentenceEnd !== -1) {
						// Find the actual end position (after the punctuation)
						const punctEnd = sentenceEnd + 1;
						const sentence = sentenceBuf.slice(0, punctEnd);
						sentenceBuf = sentenceBuf.slice(punctEnd);
						flushSentence(sentence);
					}
				}

				const llmMs = Date.now() - llmStart;
				const llmFirstMs = firstChunkTime ? firstChunkTime - llmStart : llmMs;
				console.log(`[approach2] LLM done: ${fullText.length} chars in ${llmMs}ms (first chunk ${llmFirstMs}ms)`);

				// Flush any remaining text
				if (sentenceBuf.trim()) {
					flushSentence(sentenceBuf);
				}

				// Wait for all TTS chunks to send in order
				await sendChain;

				if (!doTts || !fullText.trim()) {
					send('speak', fullText);
				}

				send('timing', JSON.stringify({ llmFirstMs, llmMs, ttsMs, totalMs: llmMs + ttsMs, sentences: sentenceCount }));

				try {
					logConversation({
						userText: text,
						assistantText: fullText,
						sttProvider,
						llmProvider,
						ttsProvider,
						llmFirstMs,
						llmTotalMs: llmMs,
						ttsMs,
						totalMs: llmMs + ttsMs
					});
				} catch (e: any) {
					console.error(`[approach2] DB log failed:`, e.message);
				}

				send('done', fullText);
			} catch (e: any) {
				console.error(`[approach2] Pipeline error:`, e.message);
				send('error', e.message);
			}
			if (!closed) controller.close();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson',
			'Cache-Control': 'no-cache'
		}
	});
};
