<script lang="ts">
	import VoiceButton from '$lib/components/VoiceButton.svelte';
	import ChatLog from '$lib/components/ChatLog.svelte';
	import LatencyBadge from '$lib/components/LatencyBadge.svelte';
	import type { ChatMessage } from '$lib/stores/chat';
	import { Room, RoomEvent, Track } from 'livekit-client';

	const VOICES = [
		{ id: 'f8f5f1b2-f02d-4d8e-a40d-fd850a487b3d', name: 'Kiara - Joyful Woman', desc: 'Upbeat Indian female' },
		{ id: '791d5162-d5eb-40f0-8189-f19db44611d8', name: 'Ayush - Friendly Neighbor', desc: 'Confident young Indian male' },
		{ id: '1259b7e3-cb8a-43df-9446-30971a46b8b0', name: 'Devansh - Warm Support Agent', desc: 'Warm conversational Indian male' },
		{ id: 'c63361f8-d142-4c62-8da7-8f8149d973d6', name: 'Krishna - Friendly Pal', desc: 'Easygoing Indian male' },
		{ id: '9cebb910-d4b7-4a4a-85a4-12c79137724c', name: 'Aarti - Conversationalist', desc: 'Indian accented female' },
		{ id: '56e35e2d-6eb6-4226-ab8b-9776515a7094', name: 'Kavita - Customer Care Agent', desc: 'Mature Indian female' },
		{ id: '39d518b7-fd0b-4676-9b8b-29d64ff31e12', name: 'Aarav - Old Time Storyteller', desc: 'Vintage Indian male' },
	] as const;

	let selectedVoice = $state(VOICES[0].id);
	let messages: ChatMessage[] = $state([]);
	let isActive = $state(false);
	let latencyMs: number | null = $state(null);
	let statusText = $state('Click mic to connect');
	let logs: string[] = $state([]);
	let showLogs = $state(true);
	let room: Room | null = null;
	let speechStartTime = 0;
	let msgCount = 0;
	let lastMsgKey = '';

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
		const voiceName = VOICES.find(v => v.id === selectedVoice)?.name ?? 'unknown';
		log(`Starting with voice: ${voiceName}`);
		statusText = 'Getting room token...';
		log('Requesting room token...');

		const resp = await fetch('/api/approach3', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ room: `support-${Date.now()}`, name: 'user', voice: selectedVoice })
		});

		if (!resp.ok) {
			const errText = await resp.text();
			statusText = `Error: ${resp.status} ${errText}`;
			log(`ERROR: Token request failed: ${resp.status} ${errText}`);
			return;
		}

		const { token, url } = await resp.json();
		log(`Token received, connecting to ${url}`);
		statusText = 'Connecting to room...';

		room = new Room();

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

		room.on(RoomEvent.DataReceived, (data, participant) => {
			const payload = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
			const sender = participant?.identity ?? 'unknown';
			log(`DataReceived: ${payload.byteLength}B from ${sender}`);
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
		log(`Connected to room: ${room.name}`);
		await room.localParticipant.setMicrophoneEnabled(true);
		log('Microphone enabled');

		isActive = true;
		statusText = 'Connected — speak now';
		log('Ready — waiting for speech');
	}

	function stop() {
		if (room) {
			room.disconnect();
			room = null;
		}
		isActive = false;
		statusText = 'Disconnected';
		log('Session stopped');
	}

	function toggle() {
		if (isActive) stop();
		else start();
	}
</script>

<div class="layout">
	<div class="page">
		<header>
			<a href="/">← Back</a>
			<h1>Approach 3</h1>
			<p class="sub">All-in-one platform with Python agent backend</p>
			<LatencyBadge {latencyMs} />
		</header>

		<div class="notice">
			This approach requires a Python agent running separately.
			See <code>agent/</code> directory for setup instructions.
		</div>

		<div class="settings">
			<label>
				<span>Voice</span>
				<select bind:value={selectedVoice} disabled={isActive}>
					{#each VOICES as v}
						<option value={v.id}>{v.name} — {v.desc}</option>
					{/each}
				</select>
			</label>
		</div>

		<ChatLog {messages} />

		<footer>
			<p class="status">{statusText}</p>
			<VoiceButton active={isActive} onclick={toggle} />
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
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		flex: 1;
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
	.settings {
		margin: 0.75rem 1rem;
		padding: 0.75rem 1rem;
		background: #1a1a2e;
		border: 1px solid #333;
		border-radius: 8px;
	}
	.settings label {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.85rem;
	}
	.settings span { opacity: 0.7; white-space: nowrap; }
	.settings select {
		flex: 1;
		background: #0a0a1a;
		color: #eee;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.4rem;
		font-size: 0.85rem;
	}

	/* ── Debug Log Panel (right sidebar) ── */
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
