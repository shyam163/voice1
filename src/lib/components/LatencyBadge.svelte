<script lang="ts">
	interface Props {
		latencyMs: number | null;
	}

	let { latencyMs }: Props = $props();

	const color = $derived(
		latencyMs === null ? '#555' : latencyMs < 500 ? '#2ecc71' : latencyMs < 1500 ? '#f39c12' : '#e74c3c'
	);
	const label = $derived(
		latencyMs === null ? '—' : latencyMs < 500 ? 'Fast' : latencyMs < 1500 ? 'OK' : 'Slow'
	);
</script>

<div class="badge" style:background={color}>
	{#if latencyMs !== null}
		{latencyMs}ms · {label}
	{:else}
		Latency: —
	{/if}
</div>

<style>
	.badge {
		display: inline-block;
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 600;
		color: white;
	}
</style>
