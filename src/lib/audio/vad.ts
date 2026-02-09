/**
 * Simple energy-based Voice Activity Detection.
 * For production, consider @ricky0123/vad-web (Silero VAD in WASM).
 */

export interface VADOptions {
	/** RMS threshold to consider speech (0-1). Default 0.01 */
	threshold?: number;
	/** Frames of silence before speech-end fires. Default 30 (~0.5s at 60fps) */
	silenceFrames?: number;
	/** Consecutive loud frames required before triggering speech-start. Default 3 */
	activationFrames?: number;
	onSpeechStart?: () => void;
	onSpeechEnd?: () => void;
}

export function createVAD(opts: VADOptions = {}) {
	const threshold = opts.threshold ?? 0.01;
	const maxSilence = opts.silenceFrames ?? 30;
	const activationNeeded = opts.activationFrames ?? 3;
	let speaking = false;
	let silenceCount = 0;
	let activationCount = 0;

	return {
		/** Feed a PCM frame (Float32Array). Returns true if speech detected. */
		process(pcm: Float32Array): boolean {
			let sum = 0;
			for (let i = 0; i < pcm.length; i++) {
				sum += pcm[i] * pcm[i];
			}
			const rms = Math.sqrt(sum / pcm.length);

			if (rms > threshold) {
				silenceCount = 0;
				if (!speaking) {
					activationCount++;
					if (activationCount >= activationNeeded) {
						speaking = true;
						activationCount = 0;
						opts.onSpeechStart?.();
					}
				}
				return speaking;
			}

			// Below threshold
			activationCount = 0;

			if (speaking) {
				silenceCount++;
				if (silenceCount >= maxSilence) {
					speaking = false;
					silenceCount = 0;
					opts.onSpeechEnd?.();
					return false;
				}
				return true; // still in speech grace period
			}

			return false;
		},
		isSpeaking() {
			return speaking;
		},
		reset() {
			speaking = false;
			silenceCount = 0;
			activationCount = 0;
		}
	};
}
