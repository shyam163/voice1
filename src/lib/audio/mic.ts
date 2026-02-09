/**
 * Microphone capture using getUserMedia + AudioWorklet.
 * Returns raw PCM Float32 frames via a callback.
 */

const WORKLET_CODE = `
class MicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      this.port.postMessage(input[0]);
    }
    return true;
  }
}
registerProcessor('mic-processor', MicProcessor);
`;

export interface MicHandle {
	stop(): void;
	stream: MediaStream;
	context: AudioContext;
}

export async function startMic(
	onFrame: (pcm: Float32Array) => void,
	sampleRate = 16000
): Promise<MicHandle> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: { sampleRate, echoCancellation: true, noiseSuppression: true }
	});

	const context = new AudioContext({ sampleRate });
	const source = context.createMediaStreamSource(stream);

	// Create worklet from inline code
	const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
	const url = URL.createObjectURL(blob);
	await context.audioWorklet.addModule(url);
	URL.revokeObjectURL(url);

	const worklet = new AudioWorkletNode(context, 'mic-processor');
	worklet.port.onmessage = (e) => {
		onFrame(e.data as Float32Array);
	};
	source.connect(worklet);
	worklet.connect(context.destination); // needed to keep processing alive

	return {
		stop() {
			worklet.disconnect();
			source.disconnect();
			stream.getTracks().forEach((t) => t.stop());
			context.close();
		},
		stream,
		context
	};
}

/** Convert Float32 PCM to 16-bit PCM (for APIs that need it) */
export function float32ToInt16(float32: Float32Array): Int16Array {
	const int16 = new Int16Array(float32.length);
	for (let i = 0; i < float32.length; i++) {
		const s = Math.max(-1, Math.min(1, float32[i]));
		int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return int16;
}
