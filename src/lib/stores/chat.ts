import { writable } from 'svelte/store';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	text: string;
	timestamp: number;
	latencyMs?: number;
}

export interface ChatState {
	messages: ChatMessage[];
	isListening: boolean;
	isSpeaking: boolean;
	latencyMs: number | null;
}

function createChatStore() {
	const { subscribe, update, set } = writable<ChatState>({
		messages: [],
		isListening: false,
		isSpeaking: false,
		latencyMs: null
	});

	return {
		subscribe,
		addMessage(role: 'user' | 'assistant', text: string, latencyMs?: number) {
			update((s) => ({
				...s,
				messages: [
					...s.messages,
					{
						id: crypto.randomUUID(),
						role,
						text,
						timestamp: Date.now(),
						latencyMs
					}
				]
			}));
		},
		appendToLast(text: string) {
			update((s) => {
				const msgs = [...s.messages];
				if (msgs.length > 0) {
					msgs[msgs.length - 1] = {
						...msgs[msgs.length - 1],
						text: msgs[msgs.length - 1].text + text
					};
				}
				return { ...s, messages: msgs };
			});
		},
		setListening(v: boolean) {
			update((s) => ({ ...s, isListening: v }));
		},
		setSpeaking(v: boolean) {
			update((s) => ({ ...s, isSpeaking: v }));
		},
		setLatency(ms: number) {
			update((s) => ({ ...s, latencyMs: ms }));
		},
		reset() {
			set({ messages: [], isListening: false, isSpeaking: false, latencyMs: null });
		}
	};
}

export const chatStore = createChatStore();
