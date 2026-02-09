/**
 * Audio playback queue — buffers incoming audio chunks and plays them sequentially.
 * Supports interruption (flush queue when user starts speaking).
 */

export interface PlaybackHandle {
	/** Enqueue a chunk of audio (PCM Float32 or ArrayBuffer of WAV/MP3) */
	enqueue(audio: ArrayBuffer, format?: 'wav' | 'mp3' | 'pcm'): void;
	/** Stop playback and clear queue */
	interrupt(): void;
	/** Returns true if currently playing */
	isPlaying(): boolean;
	/** Set volume 0-1 */
	setVolume(v: number): void;
	destroy(): void;
}

export function createPlayback(sampleRate = 24000): PlaybackHandle {
	const context = new AudioContext({ sampleRate });
	const gainNode = context.createGain();
	gainNode.connect(context.destination);

	let queue: AudioBuffer[] = [];
	let currentSource: AudioBufferSourceNode | null = null;
	let playing = false;
	let destroyed = false;

	async function decodeChunk(data: ArrayBuffer, format?: string): Promise<AudioBuffer> {
		if (format === 'pcm') {
			const int16 = new Int16Array(data);
			const float32 = new Float32Array(int16.length);
			for (let i = 0; i < int16.length; i++) {
				float32[i] = int16[i] / 32768;
			}
			const buf = context.createBuffer(1, float32.length, sampleRate);
			buf.copyToChannel(float32, 0);
			return buf;
		}
		return context.decodeAudioData(data.slice(0));
	}

	function playNext() {
		if (destroyed || queue.length === 0) {
			playing = false;
			return;
		}
		playing = true;
		const buf = queue.shift()!;
		const source = context.createBufferSource();
		source.buffer = buf;
		source.connect(gainNode);
		source.onended = () => {
			currentSource = null;
			playNext();
		};
		currentSource = source;
		source.start();
	}

	return {
		async enqueue(audio: ArrayBuffer, format?: 'wav' | 'mp3' | 'pcm') {
			if (destroyed) return;
			try {
				const buf = await decodeChunk(audio, format);
				queue.push(buf);
				if (!playing) playNext();
			} catch (e) {
				console.warn('Failed to decode audio chunk:', e);
			}
		},
		interrupt() {
			queue = [];
			if (currentSource) {
				try { currentSource.stop(); } catch {}
				currentSource = null;
			}
			playing = false;
		},
		isPlaying() {
			return playing;
		},
		setVolume(v: number) {
			gainNode.gain.value = v;
		},
		destroy() {
			destroyed = true;
			this.interrupt();
			context.close();
		}
	};
}
