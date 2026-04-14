/**
 * Migration registry - exports all database migrations
 */

export { migration001 } from '../001_initial_schema';
export { migration002 } from '../002_user_profile';
export { migration003 } from '../003_default_settings';
export { migration004 } from '../004_transcription';
export { migration005 } from '../005_sync_metadata';
export { migration006 } from '../006_encryption_version';
export { migration007 } from '../007_cleanup_global_binders';
export { migration008 } from '../008_binder_type_column';
export { migration009 } from '../009_remove_transcription_encryption';
export { migration010 } from '../010_cleanup_legacy_binders';
export { migration011 } from '../011_merkle_sync';
export { migration012 } from '../012_add_sync_operation_constraint';
export { migration013 } from '../013_add_transcription_deleted_column';
export { migration014 } from '../014_unify_unassigned_binder_id';
export { migration015 } from '../015_summaries_table';
export { migration016 } from '../016_add_summaries_to_sync';
export { migration017 } from '../017_add_transcription_sync_metadata';
export { migration018 } from '../018_calendar_events_cache';
export { migration019 } from '../019_add_starred_column';
export { migration020 } from '../020_add_archived_column';
export { migration021 } from '../021_remove_auth_from_sync_config';
export { migration022 } from '../022_split_sync_config_tables';
export { migration023 } from '../023_add_transcription_segments_table';
export { migration024 } from '../024_consolidate_device_id';
export { migration025 } from '../025_remove_obsolete_sync_config_columns';
export { migration026 } from '../026_tags';
export { migration027 } from '../027_tags_merkle_state';
export { migration028 } from '../028_user_profiles_refactor';
export { migration029 } from '../029_cursor_sync_schema';
export { migration030 } from '../030_drop_merkle_tables';
export { migration031 } from '../031_prompt_templates';
export { migration032 } from '../032_seed_default_prompt_content';
export { migration033 } from '../033_fix_default_prompt_template_keys';
export { migration034 } from '../034_update_refinement_prompt';
export { migration035 } from '../035_seed_llm_defaults';
export { migration036 } from '../036_seed_transcription_default_model';
export { migration037 } from '../037_remove_seeded_defaults';
export { migration038 } from '../038_fix_prompt_participant_format';
export { migration039 } from '../039_fix_hallucination_prompts';
export { migration040 } from '../040_require_summary_title';

import { migration001 } from '../001_initial_schema';
import { migration002 } from '../002_user_profile';
import { migration003 } from '../003_default_settings';
import { migration004 } from '../004_transcription';
import { migration005 } from '../005_sync_metadata';
import { migration006 } from '../006_encryption_version';
import { migration007 } from '../007_cleanup_global_binders';
import { migration008 } from '../008_binder_type_column';
import { migration009 } from '../009_remove_transcription_encryption';
import { migration010 } from '../010_cleanup_legacy_binders';
import { migration011 } from '../011_merkle_sync';
import { migration012 } from '../012_add_sync_operation_constraint';
import { migration013 } from '../013_add_transcription_deleted_column';
import { migration014 } from '../014_unify_unassigned_binder_id';
import { migration015 } from '../015_summaries_table';
import { migration016 } from '../016_add_summaries_to_sync';
import { migration017 } from '../017_add_transcription_sync_metadata';
import { migration018 } from '../018_calendar_events_cache';
import { migration019 } from '../019_add_starred_column';
import { migration020 } from '../020_add_archived_column';
import { migration021 } from '../021_remove_auth_from_sync_config';
import { migration022 } from '../022_split_sync_config_tables';
import { migration023 } from '../023_add_transcription_segments_table';
import { migration024 } from '../024_consolidate_device_id';
import { migration025 } from '../025_remove_obsolete_sync_config_columns';
import { migration026 } from '../026_tags';
import { migration027 } from '../027_tags_merkle_state';
import { migration028 } from '../028_user_profiles_refactor';
import { migration029 } from '../029_cursor_sync_schema';
import { migration030 } from '../030_drop_merkle_tables';
import { migration031 } from '../031_prompt_templates';
import { migration032 } from '../032_seed_default_prompt_content';
import { migration033 } from '../033_fix_default_prompt_template_keys';
import { migration034 } from '../034_update_refinement_prompt';
import { migration035 } from '../035_seed_llm_defaults';
import { migration036 } from '../036_seed_transcription_default_model';
import { migration037 } from '../037_remove_seeded_defaults';
import { migration038 } from '../038_fix_prompt_participant_format';
import { migration039 } from '../039_fix_hallucination_prompts';
import { migration040 } from '../040_require_summary_title';
import { Migration } from '../MigrationRunner';

/**
 * All migrations in order
 */
export const ALL_MIGRATIONS: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
  migration018,
  migration019,
  migration020,
  migration021,
  migration022,
  migration023,
  migration024,
  migration025,
  migration026,
  migration027,
  migration028,
  migration029,
  migration030,
  migration031,
  migration032,
  migration033,
  migration034,
  migration035,
  migration036,
  migration037,
  migration038,
  migration039,
  migration040,
];
