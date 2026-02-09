<script lang="ts">
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
		const resp = await fetch('/api/approach1', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sdp: offer.sdp })
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

<div class="page">
	<header>
		<a href="/">← Back</a>
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

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
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
