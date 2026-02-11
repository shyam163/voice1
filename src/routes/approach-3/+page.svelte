<script lang="ts">
	import { base } from '$app/paths';
	import VoiceButton from '$lib/components/VoiceButton.svelte';
	import ChatLog from '$lib/components/ChatLog.svelte';
	import LatencyBadge from '$lib/components/LatencyBadge.svelte';
	import type { ChatMessage } from '$lib/stores/chat';
	import { Room, RoomEvent, Track, type TranscriptionSegment } from 'livekit-client';

	const VOICES = [
		{ id: 'f8f5f1b2-f02d-4d8e-a40d-fd850a487b3d', name: 'Kiara - Joyful Woman' },
		{ id: '791d5162-d5eb-40f0-8189-f19db44611d8', name: 'Ayush - Friendly Neighbor' },
		{ id: '1259b7e3-cb8a-43df-9446-30971a46b8b0', name: 'Devansh - Warm Support Agent' },
		{ id: 'c63361f8-d142-4c62-8da7-8f8149d973d6', name: 'Krishna - Friendly Pal' },
		{ id: '9cebb910-d4b7-4a4a-85a4-12c79137724c', name: 'Aarti - Conversationalist' },
		{ id: '56e35e2d-6eb6-4226-ab8b-9776515a7094', name: 'Kavita - Customer Care Agent' },
		{ id: '39d518b7-fd0b-4676-9b8b-29d64ff31e12', name: 'Aarav - Old Time Storyteller' },
		{ id: '95d51f79-c397-46f9-b49a-23763d3eaa2d', name: 'Arushi' },
		{ id: 'faf0731e-dfb9-4cfc-8119-259a79b27e12', name: 'Riya' },
		{ id: 'bec003e2-3cb3-429c-8468-206a393c67ad', name: 'Parvati' },
		{ id: '002622d8-19d0-4567-a16a-f99c7397c062', name: 'Huda' },
		{ id: 'fc923f89-1de5-4ddf-b93c-6da2ba63428a', name: 'Nour' },
		{ id: '47f3bbb1-e98f-4e0c-92c5-5f0325e1e206', name: 'Neha' },
		{ id: '25d2c432-139c-4035-bfd6-9baaabcdd006', name: 'Kavya' },
		{ id: '07bc462a-c644-49f1-baf7-82d5599131be', name: 'Sindhu' },
		{ id: '28ca2041-5dda-42df-8123-f58ea9c3da00', name: 'Palak' },
	] as const;

	let selectedVoice = $state(VOICES[0].id);
	let llmProvider = $state<'groq' | 'anthropic' | 'openai'>('groq');
	let messages: ChatMessage[] = $state([]);
	let isActive = $state(false);
	let latencyMs: number | null = $state(null);
	let statusText = $state('Click mic to connect');
	let logs: string[] = $state([]);
	let showLogs = $state(true);
	let showSettings = $state(true);
	let room: Room | null = null;
	let speechStartTime = 0;
	let msgCount = 0;
	let lastMsgKey = '';
	let stopping = $state(false);
	let connecting = $state(false);

	let systemPrompt = $state(`You are a warm, upbeat companion who chats casually like a close friend. You're genuinely curious about people and love a good conversation.

Personality: Friendly, witty, and a little playful — you tease gently and laugh easily. You have opinions and share them honestly, but you're never preachy. You get excited about things — when something's cool, you say so. You're emotionally perceptive — you pick up on mood and match energy naturally. You tell short stories and anecdotes to make points rather than lecturing.

Voice & Style: Keep responses SHORT — 1 to 3 sentences most of the time. This is a spoken conversation, not an essay. Talk like a real person. Use contractions, casual phrasing, and natural fillers like "oh nice", "honestly", "wait really?" Never use bullet points, lists, markdown, or any formatting — you're speaking, not writing. Jump in with reactions before giving information. Lead with feeling, follow with facts. Ask follow-up questions naturally — not every turn, but when you're genuinely curious. Don't over-explain.

Conversation Flow: Mirror the user's energy. If they're chill, be chill. If they're hyped, match it. Remember details they share and call back to them later — it shows you're actually listening. It's okay to go on tangents — that's how real conversations work. If there's a lull, bring up something fun or ask a random interesting question. You can be a little self-deprecating or silly — it makes you relatable. Disagree sometimes. Having your own take makes you interesting to talk to.

Boundaries: Don't be sycophantic. Not everything the user says is amazing. Be genuine. Avoid starting responses with "That's a great question!" or similar filler praise.`);

	function log(msg: string) {
		const ts = new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
		logs = [...logs.slice(-50), `${ts} ${msg}`];
	}

	function addMessage(role: 'user' | 'assistant', text: string, msgLatencyMs?: number) {
		const key = `${role}:${text}`;
		if (key === lastMsgKey) {
			log(`WARN: Duplicate message suppressed: "${text.slice(0, 40)}"`);
			return;
		}
		lastMsgKey = key;
		msgCount++;
		messages = [...messages, { role, text }];
		if (msgLatencyMs) latencyMs = msgLatencyMs;
		log(`#${msgCount} added [${role}] (total displayed: ${messages.length})`);
	}

	async function start() {
		messages = [];
		latencyMs = null;
		msgCount = 0;
		lastMsgKey = '';
		logs = [];
		stopping = false;
		connecting = true;
		const voiceName = VOICES.find(v => v.id === selectedVoice)?.name ?? 'unknown';
		log(`Starting with voice: ${voiceName}`);
		statusText = 'Getting room token...';
		log('Requesting room token...');

		const resp = await fetch(`${base}/api/approach3`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ room: `support-${Date.now()}`, name: 'user', voice: selectedVoice, systemPrompt, llmProvider })
		});

		if (stopping) { connecting = false; return; }

		if (!resp.ok) {
			const errText = await resp.text();
			statusText = `Error: ${resp.status} ${errText}`;
			log(`ERROR: Token request failed: ${resp.status} ${errText}`);
			connecting = false;
			return;
		}

		const { token, url } = await resp.json();
		if (stopping) { connecting = false; return; }
		log(`Token received, connecting to ${url}`);
		statusText = 'Connecting to room...';

		room = new Room();

		// Log all room events for debugging
		const trackedEvents = new Set(['trackSubscribed', 'trackPublished', 'trackUnsubscribed', 'activeSpeakersChanged', 'connectionQualityChanged', 'dataReceived', 'participantConnected', 'participantDisconnected', 'disconnected', 'reconnecting', 'reconnected', 'transcriptionReceived']);
		const origEmit = room.emit.bind(room);
		room.emit = (event: string, ...args: any[]) => {
			if (!trackedEvents.has(event)) {
				log(`[event] ${event}`);
			}
			return origEmit(event, ...args);
		};

		room.on(RoomEvent.TrackSubscribed, (track) => {
			if (track.kind === Track.Kind.Audio) {
				log('Audio track subscribed (agent speaking)');
				const el = track.attach();
				document.body.appendChild(el);
				if (speechStartTime > 0) {
					const lat = Date.now() - speechStartTime;
					latencyMs = lat;
					log(`⏱ Voice-to-voice latency: ${lat}ms`);
					speechStartTime = 0;
				}
			}
		});

		room.on(RoomEvent.TrackPublished, (pub, participant) => {
			log(`Track published by ${participant.identity}: ${pub.kind} (${pub.source})`);
		});

		room.on(RoomEvent.TrackUnsubscribed, (track) => {
			log(`Track unsubscribed: ${track.kind}`);
		});

		room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
			if (speakers.length > 0) {
				log(`Active speakers: ${speakers.map(s => s.identity).join(', ')}`);
			}
		});

		room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
			log(`Connection quality [${participant.identity}]: ${quality}`);
		});

		room.on(RoomEvent.DataReceived, (data, participant, kind, topic) => {
			const payload = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
			const sender = participant?.identity ?? 'unknown';
			log(`DataReceived: ${payload.byteLength}B from ${sender} kind=${kind} topic=${topic ?? 'none'}`);
			try {
				const msg = JSON.parse(new TextDecoder().decode(payload));
				if (msg.type === 'transcript') {
					if (msg.role === 'user') {
						log(`STT: "${msg.text}"`);
						speechStartTime = Date.now();
					} else {
						log(`LLM: "${msg.text.slice(0, 80)}${msg.text.length > 80 ? '...' : ''}"`);
					}
					addMessage(msg.role, msg.text, msg.latencyMs);
				}
			} catch (e) {
				log(`WARN: DataReceived parse error: ${e}`);
			}
		});

		room.on(RoomEvent.TranscriptionReceived, (segments: TranscriptionSegment[], participant) => {
			const sender = participant?.identity ?? 'unknown';
			for (const seg of segments) {
				log(`Transcription [${sender}] final=${seg.final}: "${seg.text.slice(0, 80)}"`);
				if (seg.final && seg.text.trim()) {
					const role = sender === 'user' ? 'user' : 'assistant';
					addMessage(role as 'user' | 'assistant', seg.text);
				}
			}
		});

		room.on(RoomEvent.ParticipantConnected, (p) => {
			log(`Participant joined: ${p.identity}`);
		});

		room.on(RoomEvent.ParticipantDisconnected, (p) => {
			log(`Participant left: ${p.identity}`);
		});

		room.on(RoomEvent.Disconnected, () => {
			isActive = false;
			statusText = 'Disconnected';
			log('Disconnected from room');
		});

		room.on(RoomEvent.Reconnecting, () => {
			log('WARN: Reconnecting...');
		});

		room.on(RoomEvent.Reconnected, () => {
			log('Reconnected');
		});

		await room.connect(url, token);
		if (stopping) { room.disconnect(); room = null; connecting = false; return; }
		log(`Connected to room: ${room.name}`);
		await room.localParticipant.setMicrophoneEnabled(true);
		log('Microphone enabled');

		connecting = false;
		isActive = true;
		statusText = 'Connected — speak now';
		log('Ready — waiting for speech');
	}

	async function stop() {
		stopping = true;
		log('Stopping...');
		if (room) {
			try {
				await room.disconnect(true);
			} catch (e: any) {
				log(`WARN: disconnect error: ${e.message}`);
			}
			room = null;
		}
		// Remove any orphaned audio elements the SDK attached
		document.querySelectorAll('audio').forEach(el => {
			if (el.srcObject) { el.srcObject = null; el.remove(); }
		});
		isActive = false;
		connecting = false;
		statusText = 'Disconnected';
		log('Session stopped');
	}

	function toggle() {
		if (isActive || connecting) stop();
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
				<div class="settings-box">
					<div class="box-header">
						<span class="box-title">System Prompt</span>
					</div>
					<div class="box-body">
						<textarea class="prompt-editor" bind:value={systemPrompt} rows="10" disabled={isActive}></textarea>
						{#if isActive}
							<p class="hint">Disconnect to edit — prompt is set at connection time.</p>
						{/if}
					</div>
				</div>

				<div class="settings-box">
					<div class="box-header">
						<span class="box-title">General</span>
					</div>
					<div class="box-body">
						<label class="setting-row">
							<span>LLM</span>
							<select bind:value={llmProvider} disabled={isActive}>
								<option value="groq">Groq (Llama 3.3)</option>
								<option value="anthropic">Claude</option>
								<option value="openai">GPT-4o-mini</option>
							</select>
						</label>
						<label class="setting-row">
							<span>Voice</span>
							<select bind:value={selectedVoice} disabled={isActive}>
								{#each VOICES as v}
									<option value={v.id}>{v.name}</option>
								{/each}
							</select>
						</label>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<div class="main">
		<header>
			<a href="{base}/">← Back</a>
			<h1>Approach 3</h1>
			<p class="sub">All-in-one platform with Python agent backend</p>
			<LatencyBadge {latencyMs} />
		</header>

		<div class="notice">
			This approach requires a Python agent running separately.
			See <code>agent/</code> directory for setup instructions.
		</div>

		<ChatLog {messages} />

		<footer>
			<p class="status">{statusText}</p>
			<VoiceButton active={isActive || connecting} onclick={toggle} />
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

	/* ── Settings boxes ── */
	.settings-box {
		border: 1px solid #222;
		border-radius: 6px;
		overflow: hidden;
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
	.prompt-editor:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.hint {
		font-size: 0.65rem;
		color: #888;
		font-style: italic;
		margin: 0;
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

	/* ── Main column ── */
	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		max-width: 600px;
		margin: 0 auto;
	}
	header {
		padding: 1rem;
		text-align: center;
	}
	header a { color: #888; text-decoration: none; font-size: 0.85rem; }
	h1 { font-size: 1.4rem; margin: 0.5rem 0 0.25rem; }
	.sub { opacity: 0.6; font-size: 0.85rem; margin-bottom: 0.5rem; }
	.notice {
		margin: 0 1rem;
		padding: 0.75rem 1rem;
		background: #1a1a2e;
		border: 1px solid #333;
		border-radius: 8px;
		font-size: 0.85rem;
	}
	.notice code {
		background: #0a0a1a;
		padding: 0.1rem 0.3rem;
		border-radius: 3px;
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
