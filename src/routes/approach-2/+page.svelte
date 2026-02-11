<script lang="ts">
	import { base } from '$app/paths';
	import VoiceButton from '$lib/components/VoiceButton.svelte';
	import ChatLog from '$lib/components/ChatLog.svelte';
	import LatencyBadge from '$lib/components/LatencyBadge.svelte';
	import { chatStore, type ChatMessage } from '$lib/stores/chat';
	import { startMic, float32ToInt16, type MicHandle } from '$lib/audio/mic';
	import { createVAD } from '$lib/audio/vad';
	import { createPlayback, type PlaybackHandle } from '$lib/audio/playback';
	import { untrack } from 'svelte';

	let messages: ChatMessage[] = $state([]);
	let isListening = $state(false);
	let latencyMs: number | null = $state(null);
	let statusText = $state('Click mic to start');
	let micHandle: MicHandle | null = null;
	let playback: PlaybackHandle | null = $state(null);
	let sttWs: WebSocket | null = null;
	let currentTranscript = $state('');
	let speechEndTime = 0;
	let llmProvider = $state<'groq' | 'anthropic' | 'openai'>('groq');
	let conversationHistory: { role: string; content: string }[] = [];
	let sttProvider = $state<'deepgram-nova3' | 'cartesia' | 'openai' | 'browser'>('deepgram-nova3');
	let ttsProvider = $state<'deepgram' | 'openai' | 'cartesia' | 'google' | 'qwen3' | 'browser'>('cartesia');
	let qwen3Url = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('qwen3Url') || '' : '');
	let browserRecognition: any = null;
	let whisperChunks: Int16Array[] = [];
	let whisperTimer: ReturnType<typeof setInterval> | null = null;
	let volume = $state(0.8);
	let logs: string[] = $state([]);
	let showLogs = $state(true);
	let processing = $state(false);

	// Settings panel state
	let showSettings = $state(true);

	// System prompt (editable)
	let systemPrompt = $state(`You are a warm, upbeat companion who chats casually like a close friend. You're genuinely curious about people and love a good conversation.

Personality: Friendly, witty, and a little playful — you tease gently and laugh easily. You have opinions and share them honestly, but you're never preachy. You get excited about things — when something's cool, you say so. You're emotionally perceptive — you pick up on mood and match energy naturally. You tell short stories and anecdotes to make points rather than lecturing.

Voice & Style: Keep responses SHORT — 1 to 3 sentences most of the time. This is a spoken conversation, not an essay. Talk like a real person. Use contractions, casual phrasing, and natural fillers like "oh nice", "honestly", "wait really?" Never use bullet points, lists, markdown, or any formatting — you're speaking, not writing. Jump in with reactions before giving information. Lead with feeling, follow with facts. Ask follow-up questions naturally — not every turn, but when you're genuinely curious. Don't over-explain.

Conversation Flow: Mirror the user's energy. If they're chill, be chill. If they're hyped, match it. Remember details they share and call back to them later — it shows you're actually listening. It's okay to go on tangents — that's how real conversations work. If there's a lull, bring up something fun or ask a random interesting question. You can be a little self-deprecating or silly — it makes you relatable. Disagree sometimes. Having your own take makes you interesting to talk to.

Boundaries: Don't be sycophantic. Not everything the user says is amazing. Be genuine. Avoid starting responses with "That's a great question!" or similar filler praise.`);

	// Cartesia TTS options
	let cartesiaSpeed = $state(1.0);
	let useCartesiaEmotions = $state(true);
	let cartesiaEmotionPrompt = $state(`IMPORTANT — Your text output will be spoken aloud through Cartesia TTS, which supports inline emotion and expressiveness tags. You MUST use these to make the conversation lively, warm, giggly, and fun — like chatting with an enthusiastic friend!

Available tags you can insert inline in your response text:
- <emotion value="excited"/> before enthusiastic or energetic sentences
- <emotion value="happy"/> before cheerful, positive sentences
- <emotion value="curious"/> before questions or inquisitive statements
- <emotion value="content"/> before calm, satisfied statements
- <emotion value="sad"/> before sympathetic or empathetic moments
- <emotion value="surprised"/> before reacting to something unexpected
- <emotion value="angry"/> for playful frustration or strong emphasis
- [laughter] — use sparingly and only after genuinely funny moments or jokes, not as filler
- <break time="300ms"/> for short pauses, <break time="500ms"/> for dramatic pauses
- <speed ratio="1.2"/> to speed up for excitement, <speed ratio="0.8"/> to slow down for emphasis

Style guidelines:
- Be warm and expressive! Only use [laughter] when something is genuinely funny — avoid laughing at your own statements or as a greeting
- Mix emotions throughout your responses, don't just use one
- Add a <break> before important points for dramatic effect
- Keep the energy high and the conversation feeling like a fun chat, not a corporate script`);

	let deepgramVoice = $state('aura-2-asteria-en');

	const GOOGLE_VOICES = [
		{ id: 'en-IN-Standard-A', name: 'Standard A (Female)' },
		{ id: 'en-IN-Standard-B', name: 'Standard B (Male)' },
		{ id: 'en-IN-Standard-C', name: 'Standard C (Male)' },
		{ id: 'en-IN-Standard-D', name: 'Standard D (Female)' },
		{ id: 'en-IN-Standard-E', name: 'Standard E (Female)' },
		{ id: 'en-IN-Standard-F', name: 'Standard F (Male)' },
		{ id: 'en-IN-Wavenet-A', name: 'WaveNet A (Female)' },
		{ id: 'en-IN-Wavenet-B', name: 'WaveNet B (Male)' },
		{ id: 'en-IN-Wavenet-C', name: 'WaveNet C (Male)' },
		{ id: 'en-IN-Wavenet-D', name: 'WaveNet D (Female)' },
		{ id: 'en-IN-Wavenet-E', name: 'WaveNet E (Female)' },
		{ id: 'en-IN-Wavenet-F', name: 'WaveNet F (Male)' },
		{ id: 'en-IN-Neural2-A', name: 'Neural2 A (Female)' },
		{ id: 'en-IN-Neural2-B', name: 'Neural2 B (Male)' },
		{ id: 'en-IN-Neural2-C', name: 'Neural2 C (Male)' },
		{ id: 'en-IN-Neural2-D', name: 'Neural2 D (Female)' },
	] as const;
	let googleVoice = $state('en-IN-Standard-A');

	const CARTESIA_VOICES = [
		{ id: '95d51f79-c397-46f9-b49a-23763d3eaa2d', name: 'Arushi' },
		{ id: 'faf0731e-dfb9-4cfc-8119-259a79b27e12', name: 'Riya' },
		{ id: 'bec003e2-3cb3-429c-8468-206a393c67ad', name: 'Parvati' },
		{ id: '002622d8-19d0-4567-a16a-f99c7397c062', name: 'Huda' },
		{ id: 'fc923f89-1de5-4ddf-b93c-6da2ba63428a', name: 'Nour' },
		{ id: '56e35e2d-6eb6-4226-ab8b-9776515a7094', name: 'Kavitha' },
		{ id: '47f3bbb1-e98f-4e0c-92c5-5f0325e1e206', name: 'Neha' },
		{ id: '25d2c432-139c-4035-bfd6-9baaabcdd006', name: 'Kavya' },
		{ id: '07bc462a-c644-49f1-baf7-82d5599131be', name: 'Sindhu' },
		{ id: '28ca2041-5dda-42df-8123-f58ea9c3da00', name: 'Palak' },
	] as const;
	let cartesiaVoice = $state('95d51f79-c397-46f9-b49a-23763d3eaa2d');

	const CARTESIA_EMOTIONS = ['excited', 'happy', 'enthusiastic', 'elated', 'euphoric', 'triumphant', 'amazed', 'surprised', 'flirtatious', 'joking', 'peaceful', 'serene', 'calm', 'grateful', 'affectionate', 'proud', 'confident', 'determined', 'curious', 'anticipation', 'mysterious', 'contemplative', 'wistful', 'nostalgic', 'content', 'angry', 'sad', 'scared', 'sarcastic'] as const;
	let selectedEmotions = $state<Record<string, boolean>>({});
	let emotionIntensities = $state<Record<string, string>>({});

	function getCartesiaEmotionArray(): string[] {
		return CARTESIA_EMOTIONS
			.filter(e => selectedEmotions[e])
			.map(e => `${e}:${emotionIntensities[e] || 'moderate'}`);
	}

	function log(msg: string) {
		const ts = new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
		logs = [...logs.slice(-50), `${ts} ${msg}`];
	}

	chatStore.subscribe((s) => {
		messages = s.messages;
		latencyMs = s.latencyMs;
	});

	$effect(() => {
		const v = volume;
		const pb = playback;
		untrack(() => {
			if (pb) {
				pb.setVolume(v);
				log(`Volume: ${Math.round(v * 100)}%`);
			}
		});
	});

	$effect(() => {
		if (qwen3Url !== undefined) localStorage.setItem('qwen3Url', qwen3Url);
	});

	async function startDeepgramSTT(model: string = 'nova-3') {
		log(`Connecting to Deepgram STT (${model})...`);
		const resp = await fetch(`${base}/api/approach2/stt-key`);
		const { key } = await resp.json();

		const url = `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&interim_results=true&model=${model}`;
		sttWs = new WebSocket(url, ['token', key]);

		sttWs.onmessage = (e) => {
			try {
				const data = JSON.parse(e.data);
				const alt = data.channel?.alternatives?.[0];
				if (alt?.transcript) {
					currentTranscript = alt.transcript;
					if (data.is_final && alt.transcript.trim()) {
						log(`STT final: "${alt.transcript.trim()}"`);
						handleUserSpeech(alt.transcript.trim());
						currentTranscript = '';
					}
				}
			} catch {}
		};

		sttWs.onerror = () => log('Deepgram WebSocket error');
		sttWs.onclose = () => log('Deepgram WebSocket closed');

		await new Promise<void>((resolve, reject) => {
			sttWs!.onopen = () => { log('Deepgram connected'); resolve(); };
			sttWs!.onerror = () => reject(new Error('Deepgram connection failed'));
		});
	}

	async function startCartesiaSTT() {
		log('Connecting to Cartesia Ink STT...');
		const resp = await fetch(`${base}/api/approach2/cartesia-stt-key`);
		const { token } = await resp.json();

		const params = new URLSearchParams({
			access_token: token,
			cartesia_version: '2025-04-16',
			model: 'ink-whisper',
			language: 'en',
			encoding: 'pcm_s16le',
			sample_rate: '16000'
		});
		sttWs = new WebSocket(`wss://api.cartesia.ai/stt/websocket?${params}`);

		sttWs.onmessage = (e) => {
			try {
				const data = JSON.parse(e.data);
				if (data.type === 'transcript' && data.text) {
					currentTranscript = data.text;
					if (data.is_final && data.text.trim()) {
						log(`STT final: "${data.text.trim()}"`);
						handleUserSpeech(data.text.trim());
						currentTranscript = '';
					}
				} else if (data.type === 'error') {
					log(`Cartesia STT error: ${data.message}`);
				}
			} catch {}
		};

		sttWs.onerror = () => log('Cartesia STT WebSocket error');
		sttWs.onclose = () => log('Cartesia STT WebSocket closed');

		await new Promise<void>((resolve, reject) => {
			sttWs!.onopen = () => { log('Cartesia STT connected'); resolve(); };
			sttWs!.onerror = () => reject(new Error('Cartesia STT connection failed'));
		});
	}

	function startWhisperBuffering() {
		log('Starting OpenAI Whisper batch STT (buffering ~3s)...');
		whisperChunks = [];
		whisperTimer = setInterval(async () => {
			if (whisperChunks.length === 0) return;
			const chunks = whisperChunks;
			whisperChunks = [];

			// Merge chunks into single Int16 buffer
			const totalLen = chunks.reduce((s, c) => s + c.length, 0);
			const merged = new Int16Array(totalLen);
			let offset = 0;
			for (const c of chunks) { merged.set(c, offset); offset += c.length; }

			// Convert to base64
			const bytes = new Uint8Array(merged.buffer);
			let binary = '';
			for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
			const b64 = btoa(binary);

			try {
				const resp = await fetch(`${base}/api/approach2/stt-openai`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ audio: b64, sampleRate: 16000 })
				});
				if (!resp.ok) { log(`Whisper error: ${resp.status}`); return; }
				const { text } = await resp.json();
				if (text?.trim()) {
					log(`STT final: "${text.trim()}"`);
					handleUserSpeech(text.trim());
				}
			} catch (err: any) {
				log(`Whisper request error: ${err.message}`);
			}
		}, 3000);
	}

	function startBrowserSTT() {
		log('Starting browser STT...');
		const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		if (!SpeechRecognition) {
			log('ERROR: Browser Speech Recognition not supported');
			statusText = 'Browser Speech Recognition not supported';
			return;
		}
		browserRecognition = new SpeechRecognition();
		browserRecognition.continuous = true;
		browserRecognition.interimResults = true;

		browserRecognition.onresult = (event: any) => {
			let transcript = '';
			let isFinal = false;
			for (let i = event.resultIndex; i < event.results.length; i++) {
				transcript += event.results[i][0].transcript;
				if (event.results[i].isFinal) isFinal = true;
			}
			currentTranscript = transcript;
			if (isFinal && transcript.trim()) {
				log(`Browser STT final: "${transcript.trim()}"`);
				handleUserSpeech(transcript.trim());
				currentTranscript = '';
			}
		};

		browserRecognition.start();
		log('Browser STT started');
	}

	async function start() {
		chatStore.reset();
		logs = [];
		conversationHistory = [];
		statusText = 'Starting...';
		log('Initializing...');
		playback = createPlayback(24000);

		const vad = createVAD({
			threshold: 0.04,
			silenceFrames: 45,
			onSpeechStart: () => {
				chatStore.setListening(true);
			},
			onSpeechEnd: () => {
				chatStore.setListening(false);
				speechEndTime = Date.now();
			}
		});

		try {
			if (sttProvider === 'browser') {
				startBrowserSTT();
				micHandle = await startMic((pcm) => { vad.process(pcm); }, 16000);
			} else if (sttProvider === 'openai') {
				startWhisperBuffering();
				micHandle = await startMic((pcm) => {
					vad.process(pcm);
					whisperChunks.push(float32ToInt16(pcm));
				}, 16000);
			} else {
				if (sttProvider === 'cartesia') {
					await startCartesiaSTT();
				} else {
					await startDeepgramSTT('nova-3');
				}
				micHandle = await startMic((pcm) => {
					vad.process(pcm);
					if (sttWs?.readyState === WebSocket.OPEN) {
						const int16 = float32ToInt16(pcm);
						sttWs.send(int16.buffer);
					}
				}, 16000);
			}
			log('Mic active');
			isListening = true;
			statusText = 'Listening — speak now';
		} catch (err: any) {
			log(`ERROR: ${err.message}`);
			statusText = `Error: ${err.message}`;
		}
	}

	async function handleUserSpeech(text: string) {
		if (processing) {
			log(`WARN: Skipping speech while processing: "${text.slice(0, 40)}"`);
			return;
		}
		processing = true;
		chatStore.addMessage('user', text);
		conversationHistory.push({ role: 'user', content: text });
		speechEndTime = speechEndTime || Date.now();
		statusText = 'Thinking...';
		log(`Sending to LLM (${llmProvider})...`);
		let firstTextReceived = false;

		const effectiveTts = ttsProvider === 'browser' ? 'none' : ttsProvider;

		try {
			const resp = await fetch(`${base}/api/approach2`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					text,
					messages: conversationHistory.slice(0, -1),
					llmProvider,
					ttsProvider: effectiveTts,
					systemPrompt,
					useCartesiaEmotions: ttsProvider === 'cartesia' ? useCartesiaEmotions : false,
					cartesiaEmotionPrompt: (ttsProvider === 'cartesia' && useCartesiaEmotions) ? cartesiaEmotionPrompt : undefined,
					cartesiaOptions: ttsProvider === 'cartesia' ? {
						speed: cartesiaSpeed,
						emotion: getCartesiaEmotionArray(),
						voiceId: cartesiaVoice,
					} : undefined,
					deepgramVoice: ttsProvider === 'deepgram' ? deepgramVoice : undefined,
					googleTtsOptions: ttsProvider === 'google' ? {
						voiceName: googleVoice,
						languageCode: 'en-IN',
					} : undefined,
					qwen3Url: ttsProvider === 'qwen3' ? qwen3Url : undefined,
					sttProvider
				})
			});

			if (!resp.ok) {
				log(`ERROR: API returned ${resp.status}`);
				statusText = `Error: ${resp.status}`;
				processing = false;
				return;
			}

			chatStore.addMessage('assistant', '');

			const reader = resp.body!.getReader();
			const decoder = new TextDecoder();
			let buf = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				const lines = buf.split('\n');
				buf = lines.pop()!;

				for (const line of lines) {
					if (!line.trim()) continue;
					let msg: { type: string; data: string };
					try {
						msg = JSON.parse(line);
					} catch {
						log(`WARN: unparseable line: ${line.slice(0, 80)}`);
						continue;
					}

					if (msg.type === 'text') {
						if (!firstTextReceived) {
							const lat = Date.now() - speechEndTime;
							chatStore.setLatency(lat);
							firstTextReceived = true;
							statusText = 'Speaking...';
							log(`First text chunk in ${lat}ms`);
						}
						chatStore.appendToLast(msg.data);
					} else if (msg.type === 'audio') {
						if (playback) {
							try {
								const { data: b64, format } = JSON.parse(msg.data);
								log(`Audio received: ${(b64.length / 1024).toFixed(0)}KB ${format}`);
								const binary = atob(b64);
								const bytes = new Uint8Array(binary.length);
								for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
								playback.enqueue(bytes.buffer, format);
							} catch (e: any) {
								log(`ERROR audio decode: ${e.message}`);
							}
						}
					} else if (msg.type === 'speak') {
						log('Cartesia failed → browser TTS fallback');
						const utterance = new SpeechSynthesisUtterance(msg.data);
						utterance.volume = volume;
						speechSynthesis.speak(utterance);
					} else if (msg.type === 'done') {
						log(`Done. Full response: ${msg.data.length} chars`);
						conversationHistory.push({ role: 'assistant', content: msg.data });
					} else if (msg.type === 'timing') {
						const t = JSON.parse(msg.data);
						log(`⏱ LLM first: ${t.llmFirstMs}ms | LLM total: ${t.llmMs}ms | TTS: ${t.ttsMs}ms | Total: ${t.totalMs}ms`);
					} else if (msg.type === 'error') {
						log(`ERROR from server: ${msg.data}`);
					}
				}
			}
			statusText = 'Listening — speak now';
		} catch (err: any) {
			log(`ERROR: ${err.message}`);
			statusText = `Error: ${err.message}`;
		} finally {
			processing = false;
		}
	}

	function stop() {
		log('Stopping...');
		if (micHandle) { micHandle.stop(); micHandle = null; }
		if (sttWs) { sttWs.close(); sttWs = null; }
		if (playback) { playback.destroy(); playback = null; }
		if (browserRecognition) { browserRecognition.stop(); browserRecognition = null; }
		if (whisperTimer) { clearInterval(whisperTimer); whisperTimer = null; }
		whisperChunks = [];
		isListening = false;
		statusText = 'Stopped';
	}

	function toggle() {
		if (isListening) stop();
		else start();
	}
</script>

<div class="layout">
	<div class="settings-panel" class:collapsed={!showSettings}>
		<div class="panel-header">
			<span>Settings</span>
			<button onclick={() => showSettings = !showSettings}>{showSettings ? '←' : '→'}</button>
		</div>
		{#if showSettings}
			<div class="panel-content">
				<!-- Box 0: System Prompt -->
				<div class="settings-box">
					<div class="box-header">
						<span class="box-title">System Prompt</span>
					</div>
					<div class="box-body">
						<textarea class="prompt-editor" bind:value={systemPrompt} rows="10"></textarea>
					</div>
				</div>

				<!-- Box 1: Cartesia TTS -->
				<div class="settings-box" class:disabled-box={ttsProvider !== 'cartesia'}>
					<div class="box-header">
						<span class="box-title">Cartesia TTS</span>
						{#if ttsProvider === 'cartesia'}
							<label class="toggle-switch">
								<input type="checkbox" bind:checked={useCartesiaEmotions} />
								<span class="toggle-slider"></span>
							</label>
						{/if}
					</div>

					<div class="box-body" class:greyed={ttsProvider !== 'cartesia'}>
						<div class="setting-row" style="flex-direction:column;align-items:stretch">
							<span>Emotion Prompt</span>
							<textarea class="prompt-editor" bind:value={cartesiaEmotionPrompt} rows="8" disabled={ttsProvider !== 'cartesia'}></textarea>
						</div>

						<label class="setting-row">
							<span>Speed</span>
							<div class="slider-row">
								<input type="range" min="0.6" max="1.5" step="0.05" bind:value={cartesiaSpeed} disabled={ttsProvider !== 'cartesia'} />
								<span class="val">{cartesiaSpeed.toFixed(2)}</span>
							</div>
						</label>

						<div class="setting-row">
							<span>Emotions</span>
							<div class="emotion-chips">
								{#each CARTESIA_EMOTIONS as emo}
									<button
										class="chip"
										class:active={selectedEmotions[emo]}
										disabled={ttsProvider !== 'cartesia'}
										onclick={() => selectedEmotions[emo] = !selectedEmotions[emo]}
									>{emo}</button>
								{/each}
							</div>
						</div>

						{#each CARTESIA_EMOTIONS.filter(e => selectedEmotions[e]) as emo}
							<label class="setting-row intensity">
								<span>{emo}</span>
								<select bind:value={emotionIntensities[emo]} disabled={ttsProvider !== 'cartesia'}>
									<option value="lowest">lowest</option>
									<option value="low">low</option>
									<option value="moderate" selected>moderate</option>
									<option value="high">high</option>
									<option value="highest">highest</option>
								</select>
							</label>
						{/each}
					</div>
				</div>

				<!-- Box 2: General -->
				<div class="settings-box">
					<div class="box-header">
						<span class="box-title">General</span>
					</div>
					<div class="box-body">
						<label class="setting-row">
							<span>LLM</span>
							<select bind:value={llmProvider} disabled={isListening}>
								<option value="groq">Groq (Llama 3.3)</option>
								<option value="anthropic">Claude</option>
								<option value="openai">GPT-4o-mini</option>
							</select>
						</label>
						<label class="setting-row">
							<span>STT</span>
							<select bind:value={sttProvider} disabled={isListening}>
								<option value="deepgram-nova3">Deepgram Nova-3</option>
								<option value="cartesia">Cartesia Ink</option>
								<option value="openai">OpenAI Whisper</option>
								<option value="browser">Browser (free)</option>
							</select>
						</label>
						<label class="setting-row">
							<span>TTS</span>
							<select bind:value={ttsProvider} disabled={isListening}>
								<option value="deepgram">Deepgram</option>
								<option value="openai">OpenAI</option>
								<option value="cartesia">Cartesia</option>
								<option value="google">Google (en-IN)</option>
								<option value="qwen3">Qwen3 (Colab)</option>
								<option value="browser">Browser (free)</option>
							</select>
						</label>
						{#if ttsProvider === 'deepgram'}
							<label class="setting-row">
								<span>Voice</span>
								<select bind:value={deepgramVoice} disabled={isListening}>
									<option value="aura-2-asteria-en">Asteria (American)</option>
									<option value="aura-2-amalthea-en">Amalthea (Filipino)</option>
									<option value="aura-2-luna-en">Luna (American)</option>
									<option value="aura-2-athena-en">Athena (American)</option>
									<option value="aura-2-hera-en">Hera (American)</option>
									<option value="aura-2-orion-en">Orion (American)</option>
									<option value="aura-2-apollo-en">Apollo (American)</option>
									<option value="aura-2-hermes-en">Hermes (American)</option>
									<option value="aura-2-draco-en">Draco (British)</option>
									<option value="aura-2-pandora-en">Pandora (British)</option>
									<option value="aura-2-hyperion-en">Hyperion (Australian)</option>
									<option value="aura-2-theia-en">Theia (Australian)</option>
									<option value="aura-2-zeus-en">Zeus (American)</option>
									<option value="aura-2-orpheus-en">Orpheus (American)</option>
									<option value="aura-2-aurora-en">Aurora (American)</option>
								</select>
							</label>
						{/if}
						{#if ttsProvider === 'cartesia'}
							<label class="setting-row">
								<span>Voice</span>
								<select bind:value={cartesiaVoice} disabled={isListening}>
									{#each CARTESIA_VOICES as v}
										<option value={v.id}>{v.name}</option>
									{/each}
								</select>
							</label>
						{/if}
						{#if ttsProvider === 'google'}
							<label class="setting-row">
								<span>Voice</span>
								<select bind:value={googleVoice} disabled={isListening}>
									{#each GOOGLE_VOICES as v}
										<option value={v.id}>{v.name}</option>
									{/each}
								</select>
							</label>
						{/if}
						{#if ttsProvider === 'qwen3'}
							<label class="setting-row" style="flex-direction:column;align-items:stretch">
								<span>Colab ngrok URL</span>
								<input type="text" class="url-input" bind:value={qwen3Url} placeholder="https://xxxx.ngrok-free.app" />
							</label>
						{/if}
						<label class="setting-row">
							<span>Volume</span>
							<div class="slider-row">
								<input type="range" min="0" max="1" step="0.05" bind:value={volume} />
								<span class="val">{Math.round(volume * 100)}%</span>
							</div>
						</label>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<div class="main">
		<header>
			<a href="{base}/">← Back</a>
			<h1>Approach 2: STT → LLM → TTS Pipeline</h1>
			<p class="sub">Quantum Automata Voice Agent</p>
			<LatencyBadge {latencyMs} />
		</header>

		{#if currentTranscript}
			<div class="interim">✎ {currentTranscript}</div>
		{/if}

		<ChatLog {messages} />

		<footer>
			<p class="status">{statusText}</p>
			<VoiceButton active={isListening} onclick={toggle} />
		</footer>
	</div>

	<div class="log-panel" class:collapsed={!showLogs}>
		<div class="log-header">
			<span>Debug Log</span>
			<button onclick={() => logs = []}>Clear</button>
			<button onclick={() => showLogs = !showLogs}>{showLogs ? '→' : '←'}</button>
		</div>
		{#if showLogs}
			<div class="log-entries">
				{#each logs as entry}
					<div class="log-line" class:error={entry.includes('ERROR')} class:warn={entry.includes('WARN')}>{entry}</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.layout {
		display: flex;
		height: 100vh;
		overflow: hidden;
	}

	/* ── Settings panel (left sidebar) ── */
	.settings-panel {
		width: 360px;
		height: 100vh;
		display: flex;
		flex-direction: column;
		font-size: 0.8rem;
		border-right: 1px solid #222;
		background: #0a0a12;
		flex-shrink: 0;
		transition: width 0.2s;
	}
	.settings-panel.collapsed {
		width: 36px;
	}
	.panel-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		background: #111;
		border-bottom: 1px solid #222;
	}
	.panel-header span {
		flex: 1;
		opacity: 0.6;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-size: 0.65rem;
	}
	.collapsed .panel-header {
		flex-direction: column;
		padding: 0.3rem;
	}
	.collapsed .panel-header span { display: none; }
	.panel-header button {
		background: none;
		border: 1px solid #333;
		color: #888;
		padding: 0.15rem 0.4rem;
		border-radius: 3px;
		cursor: pointer;
		font-size: 0.65rem;
	}
	.panel-content {
		overflow-y: auto;
		padding: 0.5rem;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	/* ── System prompt editor ── */
	.prompt-editor {
		width: 100%;
		background: #1a1a2e;
		color: #e0e0e0;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.4rem;
		font-size: 0.7rem;
		font-family: inherit;
		line-height: 1.4;
		resize: vertical;
		min-height: 80px;
	}
	.prompt-editor:focus {
		outline: 1px solid #e94560;
		border-color: #e94560;
	}

	/* ── Settings boxes ── */
	.settings-box {
		border: 1px solid #222;
		border-radius: 6px;
		overflow: hidden;
	}
	.settings-box.disabled-box {
		opacity: 0.4;
	}
	.box-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.4rem 0.6rem;
		background: #111;
		border-bottom: 1px solid #222;
	}
	.box-title {
		font-weight: 600;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #ccc;
	}
	.box-body {
		padding: 0.5rem 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.box-body.greyed {
		pointer-events: none;
		opacity: 0.5;
	}

	/* ── Toggle switch ── */
	.toggle-switch {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
	}
	.toggle-switch input { opacity: 0; width: 0; height: 0; }
	.toggle-slider {
		position: absolute;
		cursor: pointer;
		inset: 0;
		background: #333;
		border-radius: 18px;
		transition: 0.2s;
	}
	.toggle-slider::before {
		content: '';
		position: absolute;
		height: 14px;
		width: 14px;
		left: 2px;
		bottom: 2px;
		background: #888;
		border-radius: 50%;
		transition: 0.2s;
	}
	.toggle-switch input:checked + .toggle-slider {
		background: #e94560;
	}
	.toggle-switch input:checked + .toggle-slider::before {
		transform: translateX(14px);
		background: #fff;
	}

	/* ── Setting rows ── */
	.setting-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.setting-row > span {
		font-size: 0.75rem;
		color: #999;
		min-width: 50px;
	}
	.setting-row select {
		flex: 1;
		background: #1a1a2e;
		color: #e0e0e0;
		border: 1px solid #333;
		padding: 0.2rem 0.3rem;
		border-radius: 4px;
		font-size: 0.75rem;
	}
	.slider-row {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.slider-row input[type="range"] {
		flex: 1;
		accent-color: #e94560;
	}
	.val {
		font-size: 0.7rem;
		opacity: 0.6;
		min-width: 3ch;
		text-align: right;
	}
	.intensity {
		font-size: 0.7rem;
		padding-left: 0.5rem;
	}

	/* ── Emotion chips ── */
	.emotion-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		background: #1a1a2e;
		border: 1px solid #333;
		color: #999;
		padding: 2px 8px;
		border-radius: 12px;
		font-size: 0.65rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.chip:hover:not(:disabled) {
		border-color: #e94560;
		color: #ccc;
	}
	.chip.active {
		background: #e94560;
		border-color: #e94560;
		color: #fff;
	}
	.chip:disabled {
		cursor: default;
		opacity: 0.5;
	}

	/* ── URL input ── */
	.url-input {
		width: 100%;
		background: #1a1a2e;
		color: #e0e0e0;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.3rem 0.4rem;
		font-size: 0.75rem;
		font-family: 'Cascadia Code', 'Fira Code', monospace;
	}
	.url-input:focus {
		outline: 1px solid #e94560;
		border-color: #e94560;
	}

	/* ── Main column ── */
	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		max-width: 700px;
		margin: 0 auto;
	}
	header { padding: 1rem; text-align: center; }
	header a { color: #888; text-decoration: none; font-size: 0.85rem; }
	h1 { font-size: 1.4rem; margin: 0.5rem 0 0.25rem; }
	.sub { opacity: 0.6; font-size: 0.85rem; margin-bottom: 0.5rem; }
	.interim {
		padding: 0.5rem 1rem;
		font-style: italic;
		opacity: 0.5;
		font-size: 0.85rem;
	}
	footer {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}
	.status { font-size: 0.8rem; opacity: 0.5; }

	/* ── Log panel (right sidebar) ── */
	.log-panel {
		width: 360px;
		height: 100vh;
		display: flex;
		flex-direction: column;
		font-family: 'Cascadia Code', 'Fira Code', monospace;
		font-size: 0.7rem;
		border-left: 1px solid #222;
		background: #0a0a12;
		flex-shrink: 0;
		transition: width 0.2s;
	}
	.log-panel.collapsed {
		width: 36px;
	}
	.log-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		background: #111;
		border-bottom: 1px solid #222;
	}
	.log-header span {
		flex: 1;
		opacity: 0.6;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-size: 0.65rem;
	}
	.collapsed .log-header {
		flex-direction: column;
		padding: 0.3rem;
	}
	.collapsed .log-header span { display: none; }
	.log-header button {
		background: none;
		border: 1px solid #333;
		color: #888;
		padding: 0.15rem 0.4rem;
		border-radius: 3px;
		cursor: pointer;
		font-size: 0.65rem;
	}
	.log-entries {
		overflow-y: auto;
		padding: 0.4rem 0.5rem;
		flex: 1;
	}
	.log-line {
		padding: 2px 0;
		color: #6a8;
		white-space: pre-wrap;
		word-break: break-all;
		line-height: 1.4;
	}
	.log-line.error { color: #e94560; }
	.log-line.warn { color: #f39c12; }
</style>
