/**
 * Migration 031: Prompt Templates
 *
 * Creates the prompt_templates table for storing customizable AI prompt templates.
 * Inserts a built-in default template row and migrates any existing custom prompts.
 */

import type { Migration } from './MigrationRunner';

export const migration031: Migration = {
  version: 31,
  description: 'Add prompt_templates table',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        system_prompt TEXT NOT NULL DEFAULT '',
        output_structure TEXT NOT NULL DEFAULT '{}',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);

    // Built-in default system prompt (matches chunking_pipeline.py _get_default_base_prompt)
    const defaultSystemPrompt =
      'You are a meeting analysis assistant. Your job is to transform meeting ' +
      'transcripts into factual, structured outputs. Stay grounded in the ' +
      'provided content - never speculate or fill gaps. Preserve speaker names ' +
      'exactly as they appear. When outputting JSON, provide valid JSON only ' +
      'with no markdown fences or commentary.';

    // Built-in default output structure (matches chunking_pipeline.py _get_default_templates).
    // Only the two templates the pipeline actually uses, with the correct key names.
    const defaultOutputStructure = JSON.stringify(
      {
        chunk_extraction:
          '{base_prompt}\n\nExtract structured meeting data from the transcript chunk below. ' +
          'Return ONLY valid JSON (no markdown) with keys: action_items, decisions, key_points, participants, topics.\n' +
          '- Each action item: text, owner (string or null), due_date (string or null)\n' +
          '- Each decision: text, context (string or null)\n' +
          '- Each key point: topic, summary (1-2 sentences), participants (array)\n' +
          '- Keep arrays empty when no data. Do not guess.\n\nTranscript chunk:\n{text}\n',
        refinement:
          '{base_prompt}\n\nPrepare a final meeting summary from the structured findings below. ' +
          'Use a professional tone. Produce sections in order (omit empty ones):\n' +
          '1. Title\n' +
          '2. Executive Summary (2-3 sentences)\n' +
          '3. Key Decisions (bullet list)\n' +
          "4. Action Items (bullet list: 'Owner - Action (Due Date)')\n" +
          '5. Discussion Highlights (by topic, cite participants)\n' +
          '6. Open Questions (if any)\n\nStructured findings:\n{text}\n',
      },
      null,
      2
    );

    // Insert built-in default template with actual prompt content
    db.prepare(
      `INSERT OR IGNORE INTO prompt_templates (id, name, system_prompt, output_structure, is_default, created_at, updated_at)
       VALUES ('default', 'Default', ?, ?, 1, unixepoch(), unixepoch())`
    ).run(defaultSystemPrompt, defaultOutputStructure);

    // Seed the active prompt template setting (empty string = use default)
    const existingActive = db
      .prepare(`SELECT value FROM settings WHERE key = 'llm.activePromptTemplateId'`)
      .get() as { value: string } | undefined;

    if (!existingActive) {
      db.prepare(
        `INSERT INTO settings (key, value) VALUES ('llm.activePromptTemplateId', '')`
      ).run();
    }

    // Migrate existing custom prompts if they exist
    const existingPrompt = db
      .prepare(`SELECT value FROM settings WHERE key = 'llm.systemPrompt'`)
      .get() as { value: string } | undefined;

    const existingStructure = db
      .prepare(`SELECT value FROM settings WHERE key = 'llm.promptStructure'`)
      .get() as { value: string } | undefined;

    const hasCustomPrompt = existingPrompt?.value && existingPrompt.value.trim().length > 0;
    const hasCustomStructure =
      existingStructure?.value &&
      existingStructure.value.trim().length > 0 &&
      existingStructure.value.trim() !== '{}';

    if (hasCustomPrompt || hasCustomStructure) {
      // Create a "Custom (Migrated)" template from existing prompts
      const customId = 'migrated-custom-' + Date.now();
      db.prepare(
        `INSERT INTO prompt_templates (id, name, system_prompt, output_structure, is_default, created_at, updated_at)
         VALUES (?, 'Custom (Migrated)', ?, ?, 0, unixepoch(), unixepoch())`
      ).run(customId, existingPrompt?.value ?? '', existingStructure?.value ?? '{}');

      // Set it as the active template
      db.prepare(`UPDATE settings SET value = ? WHERE key = 'llm.activePromptTemplateId'`).run(
        customId
      );
    }
  },
};
