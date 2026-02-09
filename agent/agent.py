"""
LiveKit Voice Agent for Approach 3.
Run with: python agent.py dev

Requires:
  pip install livekit-agents livekit-plugins-deepgram livekit-plugins-groq \
              livekit-plugins-cartesia livekit-plugins-silero
"""

import asyncio
import json
import logging
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    WorkerOptions,
    cli,
)
from livekit.plugins import silero, deepgram, groq, cartesia

logger = logging.getLogger("voice-agent")
logger.setLevel(logging.DEBUG)


DEFAULT_VOICE = "f8f5f1b2-f02d-4d8e-a40d-fd850a487b3d"  # Kiara


async def entrypoint(ctx: JobContext):
    await ctx.connect()
    logger.info("Connected to room %s", ctx.room.name)

    # Read voice preference from participant metadata
    voice_id = DEFAULT_VOICE
    for p in ctx.room.remote_participants.values():
        meta = p.metadata
        if meta:
            try:
                data = json.loads(meta)
                voice_id = data.get("voice", DEFAULT_VOICE)
                logger.info("Using voice from participant metadata: %s", voice_id)
            except json.JSONDecodeError:
                pass
            break

    agent = Agent(
        instructions=(
            "You are a helpful, concise, and friendly voice assistant. "
            "Keep responses under 2-3 sentences unless asked for detail."
        ),
    )

    session = AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(model="nova-3", language="en"),
        llm=groq.LLM(model="llama-3.3-70b-versatile"),
        tts=cartesia.TTS(voice=voice_id),
    )

    logger.info("AgentSession created with Deepgram STT + Groq LLM + Cartesia TTS")

    # Send transcripts to the frontend via data channel
    data_seq = {"n": 0}

    async def _publish_transcript(role: str, text: str):
        data_seq["n"] += 1
        seq = data_seq["n"]
        payload = json.dumps({"type": "transcript", "role": role, "text": text, "seq": seq}).encode()
        logger.info("publish_data seq=%d role=%s len=%d text=%.60s", seq, role, len(payload), text)
        await ctx.room.local_participant.publish_data(payload)

    @session.on("user_input_transcribed")
    def on_user_speech(ev):
        logger.debug("User speech (final=%s): %s", ev.is_final, ev.transcript)
        if ev.is_final:
            asyncio.ensure_future(_publish_transcript("user", ev.transcript))

    @session.on("agent_speech_committed")
    def on_agent_speech(ev):
        logger.debug("Agent speech: %s", ev.content)
        asyncio.ensure_future(_publish_transcript("assistant", ev.content))

    await session.start(agent=agent, room=ctx.room)
    logger.info("Session started, generating initial greeting...")
    await session.generate_reply(instructions="greet the user warmly and ask how you can help")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
