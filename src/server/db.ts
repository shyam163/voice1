import Database from 'better-sqlite3';
import { resolve } from 'path';

const dbPath = resolve('data/voice.db');

// Ensure data directory exists
import { mkdirSync } from 'fs';
mkdirSync(resolve('data'), { recursive: true });

const db = new Database(dbPath);

db.exec(`
	CREATE TABLE IF NOT EXISTS conversations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp TEXT NOT NULL DEFAULT (datetime('now')),
		user_text TEXT NOT NULL,
		assistant_text TEXT NOT NULL,
		stt_provider TEXT NOT NULL,
		llm_provider TEXT NOT NULL,
		tts_provider TEXT NOT NULL,
		llm_first_ms INTEGER,
		llm_total_ms INTEGER,
		tts_ms INTEGER,
		total_ms INTEGER
	)
`);

const insertStmt = db.prepare(`
	INSERT INTO conversations (user_text, assistant_text, stt_provider, llm_provider, tts_provider, llm_first_ms, llm_total_ms, tts_ms, total_ms)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function logConversation(data: {
	userText: string;
	assistantText: string;
	sttProvider: string;
	llmProvider: string;
	ttsProvider: string;
	llmFirstMs?: number;
	llmTotalMs?: number;
	ttsMs?: number;
	totalMs?: number;
}) {
	insertStmt.run(
		data.userText,
		data.assistantText,
		data.sttProvider,
		data.llmProvider,
		data.ttsProvider,
		data.llmFirstMs ?? null,
		data.llmTotalMs ?? null,
		data.ttsMs ?? null,
		data.totalMs ?? null
	);
}

export default db;
