<script lang="ts">
	const approaches = [
		{
			href: '/approach-1',
			title: 'Speech-to-Speech',
			subtitle: 'OpenAI Realtime API',
			latency: '200–500ms',
			color: '#e94560',
			desc: 'WebRTC connection to GPT-4o-realtime. Lowest latency, built-in VAD. LLM not swappable.'
		},
		{
			href: '/approach-2',
			title: 'STT → LLM → TTS Pipeline',
			subtitle: 'Deepgram + LLM + Cartesia',
			latency: '800ms–2s',
			color: '#0f3460',
			desc: 'Maximum flexibility. Swap any component. Deepgram STT → Claude/GPT/Groq → Cartesia TTS.'
		},
		{
			href: '/approach-3',
			title: 'All-in-One Platform',
			subtitle: 'Voice Agents',
			latency: '400–800ms',
			color: '#533483',
			desc: 'Handles interruptions, turn-taking, noise. Requires Python agent backend.'
		}
	];
</script>

<div class="landing">
	<h1>Voice Chatbot — 3 Approaches</h1>
	<p class="subtitle">Compare architectures for real-time voice AI</p>

	<div class="grid">
		{#each approaches as a}
			<a href={a.href} class="card" style:border-color={a.color}>
				<h2>{a.title}</h2>
				<p class="sub">{a.subtitle}</p>
				<p class="desc">{a.desc}</p>
				<span class="latency" style:background={a.color}>{a.latency}</span>
			</a>
		{/each}
	</div>
</div>

<style>
	.landing {
		max-width: 900px;
		margin: 0 auto;
		padding: 3rem 1.5rem;
		text-align: center;
	}
	h1 { font-size: 2rem; margin-bottom: 0.25rem; }
	.subtitle { opacity: 0.6; margin-bottom: 2.5rem; }
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1.5rem;
	}
	.card {
		text-decoration: none;
		color: inherit;
		border: 2px solid;
		border-radius: 12px;
		padding: 1.5rem;
		text-align: left;
		transition: transform 0.15s, box-shadow 0.15s;
		background: #111;
	}
	.card:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}
	.card h2 { margin: 0 0 0.25rem; font-size: 1.2rem; }
	.sub { font-size: 0.85rem; opacity: 0.6; margin: 0 0 0.75rem; }
	.desc { font-size: 0.85rem; line-height: 1.5; opacity: 0.8; margin-bottom: 1rem; }
	.latency {
		display: inline-block;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
		color: white;
	}
</style>
