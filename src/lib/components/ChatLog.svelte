<script lang="ts">
	import type { ChatMessage } from '$lib/stores/chat';

	interface Props {
		messages: ChatMessage[];
	}

	let { messages }: Props = $props();
	let container: HTMLElement | undefined = $state();

	$effect(() => {
		if (messages.length && container) {
			container.scrollTop = container.scrollHeight;
		}
	});
</script>

<div class="chat-log" bind:this={container}>
	{#each messages as msg (msg.id)}
		<div class="msg" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
			<span class="role">{msg.role === 'user' ? 'You' : 'AI'}</span>
			<p>{msg.text}</p>
			{#if msg.latencyMs}
				<span class="latency">{msg.latencyMs}ms</span>
			{/if}
		</div>
	{/each}
	{#if messages.length === 0}
		<p class="empty">Press the mic button and speak...</p>
	{/if}
</div>

<style>
	.chat-log {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.msg {
		max-width: 80%;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		position: relative;
	}
	.msg.user {
		align-self: flex-end;
		background: #16213e;
		color: #e0e0e0;
	}
	.msg.assistant {
		align-self: flex-start;
		background: #0f3460;
		color: #e0e0e0;
	}
	.role {
		font-size: 0.7rem;
		text-transform: uppercase;
		opacity: 0.6;
		letter-spacing: 0.05em;
	}
	.msg p {
		margin: 0.25rem 0 0;
	}
	.latency {
		font-size: 0.65rem;
		opacity: 0.5;
		position: absolute;
		bottom: 4px;
		right: 8px;
	}
	.empty {
		text-align: center;
		opacity: 0.4;
		margin-top: 2rem;
	}
</style>
