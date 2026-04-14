/**
 * Migration 033: Fix Default Prompt Template Keys
 *
 * The original seed data (migrations 031/032) used prompt keys from the
 * filesystem files ("refine") instead of the keys the Python pipeline
 * actually uses ("refinement"). This migration updates the default
 * template's output_structure to match chunking_pipeline.py's defaults
 * and also aligns the system_prompt text.
 */

import type { Migration } from './MigrationRunner';

export const migration033: Migration = {
  version: 33,
  description: 'Fix default prompt template keys to match pipeline defaults',
  up: (db) => {
    // System prompt that matches chunking_pipeline.py _get_default_base_prompt()
    const defaultSystemPrompt =
      'You are a meeting analysis assistant. Your job is to transform meeting ' +
      'transcripts into factual, structured outputs. Stay grounded in the ' +
      'provided content - never speculate or fill gaps. Preserve speaker names ' +
      'exactly as they appear. When outputting JSON, provide valid JSON only ' +
      'with no markdown fences or commentary.';

    // Output structure that matches chunking_pipeline.py _get_default_templates().
    // Only the two templates the pipeline uses, with the correct key names.
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

    db.prepare(
      `UPDATE prompt_templates
       SET system_prompt = ?, output_structure = ?, updated_at = unixepoch()
       WHERE id = 'default' AND is_default = 1`
    ).run(defaultSystemPrompt, defaultOutputStructure);
  },
};
