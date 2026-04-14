/**
 * Migration 032: Seed Default Prompt Template Content
 *
 * Updates the built-in default prompt template with the actual system prompt
 * and output structure content, so users can read the default prompts in the UI.
 */

import type { Migration } from './MigrationRunner';

export const migration032: Migration = {
  version: 32,
  description: 'Seed default prompt template with actual prompt content',
  up: (db) => {
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

    // Update the default template with actual content
    db.prepare(
      `UPDATE prompt_templates
       SET system_prompt = ?, output_structure = ?, updated_at = unixepoch()
       WHERE id = 'default' AND is_default = 1`
    ).run(defaultSystemPrompt, defaultOutputStructure);
  },
};
