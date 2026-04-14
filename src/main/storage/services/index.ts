/**
 * Storage services exports
 */

// Service implementations
export { UserService } from './UserService';
export { SettingsService } from './SettingsService';
export { BinderService } from './BinderService';
export { NoteService } from './NoteService';
export { SearchService } from './SearchService';
export { TranscriptionService } from './TranscriptionService';
export { SummaryService } from './SummaryService';
export { CalendarEventService } from './CalendarEventService';
export { TagService } from './TagService';
export { SyncItemsService, type SyncEntityType, type SyncItem } from './SyncItemsService';
export { SyncService } from './SyncService';
export { AudioRecordingService } from './AudioRecordingService';

// Import all services for factory function
import { TransactionManager } from '../core/TransactionManager';
import { IDatabaseManager } from '../interfaces/IDatabaseManager';

import { AudioRecordingService } from './AudioRecordingService';
import { BinderService } from './BinderService';
import { CalendarEventService } from './CalendarEventService';
import { NoteService } from './NoteService';
import { SearchService } from './SearchService';
import { SettingsService } from './SettingsService';
import { SummaryService } from './SummaryService';
import { SyncItemsService } from './SyncItemsService';
import { SyncService } from './SyncService';
import { TagService } from './TagService';
import { TranscriptionService } from './TranscriptionService';
import { UserService } from './UserService';

// Import dependencies

/**
 * Create all services with proper dependency injection
 */
export function createServices(databaseManager: IDatabaseManager) {
  // Create shared utilities
  const transactionManager = new TransactionManager(databaseManager);

  // Create syncItemsService FIRST for Joplin-style sync queue
  // This needs to be injected into other services for write-on-edit hooks
  const syncItemsService = new SyncItemsService(databaseManager, transactionManager);

  // Create sync config service for cursor-based sync
  const syncService = new SyncService(databaseManager, transactionManager);

  // Create services in dependency order
  // UserService needs syncItemsService to mark default binders for sync
  const userService = new UserService(databaseManager, transactionManager, syncItemsService);
  const settingsService = new SettingsService(databaseManager, transactionManager);
  const binderService = new BinderService(
    databaseManager,
    transactionManager,
    userService,
    syncItemsService
  );
  const searchService = new SearchService(databaseManager, transactionManager, settingsService);
  const noteService = new NoteService(
    databaseManager,
    transactionManager,
    searchService,
    syncItemsService
  );
  const transcriptionService = new TranscriptionService(
    databaseManager,
    transactionManager,
    searchService,
    syncItemsService
  );
  const calendarEventService = new CalendarEventService(databaseManager, transactionManager);
  const summaryService = new SummaryService(databaseManager, transactionManager, syncItemsService);
  const tagService = new TagService(
    databaseManager,
    transactionManager,
    userService,
    syncItemsService
  );
  // Audio recording service - local-only, not synced
  const audioRecordingService = new AudioRecordingService(databaseManager, transactionManager);

  return {
    userService,
    settingsService,
    binderService,
    noteService,
    searchService,
    transcriptionService,
    syncService,
    syncItemsService,
    summaryService,
    calendarEventService,
    tagService,
    audioRecordingService,
  };
}
