/**
 * Migration 039: Fix AI Summary Hallucinations
 *
 * Migration 038 introduced example data in the chunk_extraction prompt
 * (e.g. ["Sarah", "John"], ["Budget review", "Q2 planning"]) which small
 * quantized GGUF models (7B-13B) parrot as actual extracted data.  It also
 * accidentally reverted migration 034's system prompt fix by re-adding the
 * "When outputting JSON..." line, causing the refinement step to emit JSON
 * instead of prose narrative.
 *
 * This migration:
 * 1. Restores the clean system prompt (no JSON instruction leak).
 * 2. Removes example data from chunk_extraction and strengthens the
 *    anti-hallucination wording.
 * 3. Updates the refinement prompt to make sections conditional on data
 *    and prohibits HTML output.
 */

import type { Migration } from './MigrationRunner';

export const migration039: Migration = {
  version: 39,
  description:
    'Fix hallucination-prone prompts: remove examples, strengthen grounding, conditional sections',
  up: (db) => {
    // Restored system prompt — matches migration 034's fix (no "When outputting JSON..." line)
    const systemPrompt =
      'You are a meeting analysis assistant. Your job is to transform meeting ' +
      'transcripts into factual, structured outputs. Stay grounded in the ' +
      'provided content - never speculate or fill gaps. Preserve speaker names ' +
      'exactly as they appear.';

    const outputStructure = JSON.stringify(
      {
        chunk_extraction:
          '{base_prompt}\n\n' +
          'Extract structured meeting data from the transcript chunk below.\n' +
          'Return ONLY valid JSON (no markdown) with keys: action_items, ' +
          'decisions, key_points, participants, topics.\n' +
          '- Each action item: text, owner (string or null), due_date (string or null)\n' +
          '- Each decision: text, context (string or null)\n' +
          '- Each key point: topic, summary (1-2 sentences), participants (array)\n' +
          '- participants: array of plain strings (names mentioned in transcript only).\n' +
          '  Return empty array [] if no names are explicitly stated.\n' +
          '- topics: array of plain strings.\n' +
          '  Return empty array [] if no clear topics are identified.\n' +
          '- IMPORTANT: Return empty arrays when information is not explicitly present\n' +
          '  in the transcript. Do not infer, guess, or fabricate any data.\n\n' +
          'Transcript chunk:\n{text}\n',
        refinement:
          '{base_prompt}\n\n' +
          'Prepare a final meeting summary from the structured findings below.\n' +
          'Write in plain narrative text \u2014 do NOT output JSON, code blocks, or\n' +
          'markdown fences. Do not use HTML tags.\n' +
          'Use a professional tone. Include ONLY sections that have corresponding\n' +
          'data in the findings below. Skip sections entirely if their data is empty.\n' +
          '- Title (derive from actual topics discussed)\n' +
          '- Executive Summary (2-3 sentences of what was actually discussed)\n' +
          '- Key Decisions (bullet list, only if decisions exist in findings)\n' +
          "- Action Items (bullet list with 'Owner - Action (Due Date)',\n" +
          '  only if action items exist in findings)\n' +
          '- Discussion Highlights (by topic, cite participants if known)\n' +
          '- Open Questions (only if unresolved questions exist in findings)\n\n' +
          'IMPORTANT: Do not create content for empty sections.\n' +
          'If the findings show empty arrays, skip those sections entirely.\n\n' +
          'Structured findings:\n{text}\n',
      },
      null,
      2
    );

    db.prepare(
      `UPDATE prompt_templates
       SET system_prompt = ?, output_structure = ?, updated_at = unixepoch()
       WHERE id = 'default' AND is_default = 1`
    ).run(systemPrompt, outputStructure);
  },
};
