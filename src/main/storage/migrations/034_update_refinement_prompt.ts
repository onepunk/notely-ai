/**
 * Migration 034: Update Refinement Prompt
 *
 * Removes the JSON-formatting sentence from the base system prompt and adds
 * an explicit prose instruction to the refinement template.  The old base
 * prompt told the model "When outputting JSON, provide valid JSON only …"
 * which leaked into the refinement step and caused the qwen model to emit
 * JSON instead of narrative prose.
 *
 * - chunk_extraction already has its own "Return ONLY valid JSON" instruction
 *   so removing the sentence from the base prompt is safe.
 * - The refinement template now explicitly says "Write in plain narrative
 *   text — do NOT output JSON, code blocks, or markdown fences."
 */

import type { Migration } from './MigrationRunner';

export const migration034: Migration = {
  version: 34,
  description:
    'Remove JSON instruction from base prompt, add prose instruction to refinement template',
  up: (db) => {
    // Updated system prompt — no longer mentions JSON formatting
    const defaultSystemPrompt =
      'You are a meeting analysis assistant. Your job is to transform meeting ' +
      'transcripts into factual, structured outputs. Stay grounded in the ' +
      'provided content - never speculate or fill gaps. Preserve speaker names ' +
      'exactly as they appear.';

    // Updated output structure — refinement template now has explicit prose instruction
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
          'Write in plain narrative text \u2014 do NOT output JSON, code blocks, or markdown fences. ' +
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
