/**
 * Migration 038: Fix Prompt Participant/Topic Format
 *
 * The chunk_extraction prompt template specifies explicit formats for
 * action_items, decisions, and key_points, but leaves participants and
 * topics unspecified. Smaller LLMs (e.g. Llama-3.2-1B-Instruct on Linux)
 * return participants as [{name, role}] dicts instead of plain strings,
 * which crashes deduplicate_strings().
 *
 * This migration adds explicit format specs for participants and topics
 * to the chunk_extraction template so the LLM returns plain string arrays.
 */

import type { Migration } from './MigrationRunner';

export const migration038: Migration = {
  version: 38,
  description: 'Add explicit participant/topic format to chunk_extraction prompt',
  up: (db) => {
    // System prompt unchanged — matches chunking_pipeline.py _get_default_base_prompt()
    const defaultSystemPrompt =
      'You are a meeting analysis assistant. Your job is to transform meeting ' +
      'transcripts into factual, structured outputs. Stay grounded in the ' +
      'provided content - never speculate or fill gaps. Preserve speaker names ' +
      'exactly as they appear. When outputting JSON, provide valid JSON only ' +
      'with no markdown fences or commentary.';

    // Output structure with explicit participants/topics format lines added
    // to chunk_extraction. Matches chunking_pipeline.py _get_default_templates().
    const defaultOutputStructure = JSON.stringify(
      {
        chunk_extraction:
          '{base_prompt}\n\nExtract structured meeting data from the transcript chunk below. ' +
          'Return ONLY valid JSON (no markdown) with keys: action_items, decisions, key_points, participants, topics.\n' +
          '- Each action item: text, owner (string or null), due_date (string or null)\n' +
          '- Each decision: text, context (string or null)\n' +
          '- Each key point: topic, summary (1-2 sentences), participants (array)\n' +
          '- participants: array of plain strings (names only, e.g. ["Sarah", "John"])\n' +
          '- topics: array of plain strings (e.g. ["Budget review", "Q2 planning"])\n' +
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
