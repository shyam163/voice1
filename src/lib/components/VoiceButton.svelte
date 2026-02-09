<script lang="ts">
	interface Props {
		active?: boolean;
		disabled?: boolean;
		onclick?: () => void;
	}

	let { active = false, disabled = false, onclick }: Props = $props();
</script>

<button
	class="voice-btn"
	class:active
	{disabled}
	{onclick}
	aria-label={active ? 'Stop recording' : 'Start recording'}
>
	<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		{#if active}
			<rect x="6" y="6" width="12" height="12" rx="2" />
		{:else}
			<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
			<path d="M19 10v2a7 7 0 0 1-14 0v-2" />
			<line x1="12" y1="19" x2="12" y2="23" />
			<line x1="8" y1="23" x2="16" y2="23" />
		{/if}
	</svg>
	{#if active}
		<span class="pulse"></span>
	{/if}
</button>

<style>
	.voice-btn {
		position: relative;
		width: 72px;
		height: 72px;
		border-radius: 50%;
		border: 2px solid #333;
		background: #1a1a2e;
		color: #e0e0e0;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}
	.voice-btn:hover:not(:disabled) {
		background: #16213e;
		border-color: #0f3460;
	}
	.voice-btn.active {
		background: #e94560;
		border-color: #e94560;
		color: white;
	}
	.voice-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.pulse {
		position: absolute;
		inset: -4px;
		border-radius: 50%;
		border: 2px solid #e94560;
		animation: pulse 1.5s ease-out infinite;
	}
	@keyframes pulse {
		0% { transform: scale(1); opacity: 1; }
		100% { transform: scale(1.4); opacity: 0; }
	}
</style>
