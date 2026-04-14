/**
 * Migration 040: Require Title in refinement prompt
 *
 * Migration 039 made all summary sections conditional ("Include ONLY sections
 * that have corresponding data"). This caused the Title to be inconsistently
 * generated — the LLM sometimes skips it because it isn't "data" in the
 * structured findings. This migration makes the Title always required since
 * a title can always be derived from the topics discussed.
 */

import type { Migration } from './MigrationRunner';

export const migration040: Migration = {
  version: 40,
  description: 'Make Title always required in refinement prompt',
  up: (db) => {
    const row = db
      .prepare(
        `SELECT system_prompt, output_structure FROM prompt_templates
         WHERE id = 'default' AND is_default = 1`
      )
      .get() as { system_prompt: string; output_structure: string } | undefined;

    if (!row) return;

    const structure = JSON.parse(row.output_structure);

    structure.refinement =
      '{base_prompt}\n\n' +
      'Prepare a final meeting summary from the structured findings below.\n' +
      'Write in plain narrative text \u2014 do NOT output JSON, code blocks, or\n' +
      'markdown fences. Do not use HTML tags.\n' +
      'Use a professional tone. Put each section on its own line.\n\n' +
      'ALWAYS begin your response with exactly these two lines:\n' +
      'Title: <short descriptive title derived from the actual topics discussed>\n' +
      'Executive Summary: <2-3 sentences of what was actually discussed>\n\n' +
      'Then include ONLY the sections below that have corresponding data in the\n' +
      'findings. Skip a section entirely if its data is empty.\n' +
      '- Key Decisions (bullet list, only if decisions exist in findings)\n' +
      "- Action Items (bullet list with 'Owner - Action (Due Date)',\n" +
      '  only if action items exist in findings)\n' +
      '- Discussion Highlights (by topic, cite participants if known)\n' +
      '- Open Questions (only if unresolved questions exist in findings)\n\n' +
      'IMPORTANT: Do not create content for empty optional sections.\n' +
      'If the findings show empty arrays, skip those sections entirely.\n\n' +
      'Structured findings:\n{text}\n';

    db.prepare(
      `UPDATE prompt_templates
       SET output_structure = ?, updated_at = unixepoch()
       WHERE id = 'default' AND is_default = 1`
    ).run(JSON.stringify(structure, null, 2));
  },
};
