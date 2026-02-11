<script lang="ts">
	import { base } from '$app/paths';
	import VoiceButton from '$lib/components/VoiceButton.svelte';
	import ChatLog from '$lib/components/ChatLog.svelte';
	import LatencyBadge from '$lib/components/LatencyBadge.svelte';
	import { chatStore, type ChatMessage } from '$lib/stores/chat';

	let messages: ChatMessage[] = $state([]);
	let isActive = $state(false);
	let latencyMs: number | null = $state(null);
	let pc: RTCPeerConnection | null = null;
	let dc: RTCDataChannel | null = null;
	let statusText = $state('Click mic to connect');
	let speechStartTime = 0;

	let showSettings = $state(true);

	let systemPrompt = $state(`You are a warm, upbeat companion who chats casually like a close friend. You're genuinely curious about people and love a good conversation.

Personality: Friendly, witty, and a little playful — you tease gently and laugh easily. You have opinions and share them honestly, but you're never preachy. You get excited about things — when something's cool, you say so. You're emotionally perceptive — you pick up on mood and match energy naturally. You tell short stories and anecdotes to make points rather than lecturing.

Voice & Style: Keep responses SHORT — 1 to 3 sentences most of the time. This is a spoken conversation, not an essay. Talk like a real person. Use contractions, casual phrasing, and natural fillers like "oh nice", "honestly", "wait really?" Never use bullet points, lists, markdown, or any formatting — you're speaking, not writing. Jump in with reactions before giving information. Lead with feeling, follow with facts. Ask follow-up questions naturally — not every turn, but when you're genuinely curious. Don't over-explain.

Conversation Flow: Mirror the user's energy. If they're chill, be chill. If they're hyped, match it. Remember details they share and call back to them later — it shows you're actually listening. It's okay to go on tangents — that's how real conversations work. If there's a lull, bring up something fun or ask a random interesting question. You can be a little self-deprecating or silly — it makes you relatable. Disagree sometimes. Having your own take makes you interesting to talk to.

Boundaries: Don't be sycophantic. Not everything the user says is amazing. Be genuine. Avoid starting responses with "That's a great question!" or similar filler praise.`);

	chatStore.subscribe((s) => {
		messages = s.messages;
		latencyMs = s.latencyMs;
	});

	async function start() {
		chatStore.reset();
		statusText = 'Connecting to OpenAI Realtime...';

		pc = new RTCPeerConnection();

		// Set up audio playback from remote
		const audioEl = document.createElement('audio');
		audioEl.autoplay = true;
		pc.ontrack = (e) => {
			audioEl.srcObject = e.streams[0];
		};

		// Add mic track
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		stream.getTracks().forEach((t) => pc!.addTrack(t, stream));

		// Data channel for events
		dc = pc.createDataChannel('oai-events');
		dc.onmessage = (e) => {
			try {
				const event = JSON.parse(e.data);
				handleRealtimeEvent(event);
			} catch {}
		};

		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);

		// Send SDP to our server which relays to OpenAI
		const resp = await fetch(`${base}/api/approach1`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sdp: offer.sdp, systemPrompt })
		});

		if (!resp.ok) {
			statusText = `Error: ${resp.status} ${await resp.text()}`;
			return;
		}

		const answerSdp = await resp.text();
		await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

		isActive = true;
		statusText = 'Connected — speak now';
	}

	function handleRealtimeEvent(event: any) {
		switch (event.type) {
			case 'input_audio_buffer.speech_started':
				speechStartTime = Date.now();
				chatStore.setListening(true);
				break;
			case 'input_audio_buffer.speech_stopped':
				chatStore.setListening(false);
				break;
			case 'conversation.item.input_audio_transcription.completed':
				if (event.transcript) {
					chatStore.addMessage('user', event.transcript);
				}
				break;
			case 'response.audio.delta':
				// First audio chunk — measure latency
				if (speechStartTime > 0) {
					const lat = Date.now() - speechStartTime;
					chatStore.setLatency(lat);
					speechStartTime = 0;
				}
				break;
			case 'response.audio_transcript.done':
				if (event.transcript) {
					chatStore.addMessage('assistant', event.transcript, latencyMs ?? undefined);
				}
				break;
		}
	}

	function stop() {
		if (dc) dc.close();
		if (pc) pc.close();
		pc = null;
		dc = null;
		isActive = false;
		statusText = 'Disconnected';
	}

	function toggle() {
		if (isActive) stop();
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
			</div>
		{/if}
	</div>

	<div class="main">
		<header>
			<a href="{base}/">← Back</a>
			<h1>Approach 1: Speech-to-Speech</h1>
			<p class="sub">OpenAI Realtime API via WebRTC</p>
			<LatencyBadge {latencyMs} />
		</header>

		<ChatLog {messages} />

		<footer>
			<p class="status">{statusText}</p>
			<VoiceButton active={isActive} onclick={toggle} />
		</footer>
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
	header a {
		color: #888;
		text-decoration: none;
		font-size: 0.85rem;
	}
	h1 { font-size: 1.4rem; margin: 0.5rem 0 0.25rem; }
	.sub { opacity: 0.6; font-size: 0.85rem; margin-bottom: 0.5rem; }
	footer {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}
	.status { font-size: 0.8rem; opacity: 0.5; }
</style>
