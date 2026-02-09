/**
 * Approach 3: LiveKit Agents — Room token generation.
 * The actual agent runs as a separate Python process.
 */

import { SignJWT } from 'jose';

export interface LiveKitConfig {
	apiKey: string;
	apiSecret: string;
	url: string;
}

/** Generate an access token for a LiveKit room */
export async function createRoomToken(
	config: LiveKitConfig,
	roomName: string,
	participantName: string,
	metadata?: string
): Promise<string> {
	const secret = new TextEncoder().encode(config.apiSecret);

	const token = await new SignJWT({
		iss: config.apiKey,
		sub: participantName,
		video: {
			room: roomName,
			roomJoin: true,
			canPublish: true,
			canSubscribe: true,
			canPublishData: true
		},
		metadata
	})
		.setProtectedHeader({ alg: 'HS256' })
		.setExpirationTime('1h')
		.setIssuedAt()
		.sign(secret);

	return token;
}
