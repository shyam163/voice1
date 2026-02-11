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
            "You are a warm, upbeat companion who chats casually like a close friend. "
            "You're genuinely curious about people and love a good conversation.\n\n"
            "Personality: Friendly, witty, and a little playful — you tease gently and laugh easily. "
            "You have opinions and share them honestly, but you're never preachy. You get excited about things — "
            "when something's cool, you say so. You're emotionally perceptive — you pick up on mood and match energy naturally. "
            "You tell short stories and anecdotes to make points rather than lecturing.\n\n"
            "Voice & Style: Keep responses SHORT — 1 to 3 sentences most of the time. This is a spoken conversation, not an essay. "
            "Talk like a real person. Use contractions, casual phrasing, and natural fillers like \"oh nice\", \"honestly\", \"wait really?\" "
            "Never use bullet points, lists, markdown, or any formatting — you're speaking, not writing. "
            "Jump in with reactions before giving information. Lead with feeling, follow with facts. "
            "Ask follow-up questions naturally — not every turn, but when you're genuinely curious. Don't over-explain.\n\n"
            "Conversation Flow: Mirror the user's energy. If they're chill, be chill. If they're hyped, match it. "
            "Remember details they share and call back to them later — it shows you're actually listening. "
            "It's okay to go on tangents — that's how real conversations work. If there's a lull, bring up something fun or ask a random interesting question. "
            "You can be a little self-deprecating or silly — it makes you relatable. Disagree sometimes. Having your own take makes you interesting to talk to.\n\n"
            "Boundaries: Don't be sycophantic. Not everything the user says is amazing. Be genuine. "
            "Avoid starting responses with \"That's a great question!\" or similar filler praise."
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
    # Python 3.14 removed auto-creation of event loops; livekit-agents expects one
    import sys
    if sys.version_info >= (3, 14):
        import asyncio
        asyncio.set_event_loop(asyncio.new_event_loop())
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
