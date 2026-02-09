<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<div class="app">
	{@render children()}
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		background: #0a0a1a;
		color: #e0e0e0;
	}
	:global(*) {
		box-sizing: border-box;
	}
	.app {
		min-height: 100vh;
	}
</style>
