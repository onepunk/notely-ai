/**
 * Migration system exports
 */

// Core migration system
export { MigrationRunner, type Migration, type MigrationResult } from './MigrationRunner';

// Individual migrations
export * from './migrations';

// Seed data
export * from './seeds';

// Convenience imports
import { logger } from '../../logger';
import { IDatabaseManager } from '../interfaces/IDatabaseManager';

import { MigrationRunner } from './MigrationRunner';
import { ALL_MIGRATIONS } from './migrations';

/**
 * Create a fully configured migration runner with all migrations registered
 */
export function createMigrationRunner(databaseManager: IDatabaseManager): MigrationRunner {
  const runner = new MigrationRunner(databaseManager);

  // Register all migrations
  for (const migration of ALL_MIGRATIONS) {
    runner.registerMigration(migration);
  }

  return runner;
}

/**
 * Run migrations - complete database setup with smart baseline detection
 *
 * This function implements the baseline schema pattern:
 * - Fresh installations: Use baseline schema (skips migrations 001-009)
 * - Existing installations: Continue with normal migrations
 * - Partial states: Attempt recovery
 *
 * Note: Application defaults are handled by code constants in src/common/config.ts,
 * not by database seeding. The DB stores only explicit user overrides.
 */
export async function setupDatabase(databaseManager: IDatabaseManager): Promise<void> {
  const runner = createMigrationRunner(databaseManager);

  // Validate migration sequence
  const validation = runner.validateMigrationSequence();
  if (!validation.valid) {
    throw new Error(`Migration validation failed: ${validation.errors.join(', ')}`);
  }

  // Detect current database state
  const state = runner.detectDatabaseState();
  logger.info('Database state detected: %s', state);

  switch (state) {
    case 'fresh':
      // Try to use baseline schema for fresh installations
      if (runner.hasBaseline(30)) {
        logger.info('Applying baseline schema for fresh installation...');
        const baselineResult = await runner.applyBaseline(30);

        if (!baselineResult.success) {
          logger.error(
            'Baseline application failed, falling back to migrations: %s',
            baselineResult.error
          );
          // Fall back to normal migrations
          await runNormalMigrations(runner);
        } else {
          logger.info('Baseline schema v%d applied successfully', baselineResult.version);
          if (baselineResult.checksum) {
            logger.info('Baseline checksum: %s', baselineResult.checksum.substring(0, 16) + '...');
          }
          // After applying the baseline, run any subsequent migrations (e.g., 031+)
          logger.info('Running pending migrations after baseline application...');
          await runNormalMigrations(runner);
        }
      } else {
        logger.warn('No baseline schema available, using migrations');
        await runNormalMigrations(runner);
      }
      break;

    case 'partial':
      logger.warn('Partial migration state detected, attempting recovery...');
      try {
        await runner.recoverPartialMigration();
        logger.info('Partial migration recovery completed');
      } catch (error) {
        logger.error(
          'Migration recovery failed: %s',
          error instanceof Error ? error.message : String(error)
        );
        throw new Error(
          `Database setup failed due to partial migration recovery: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      break;

    case 'migrated': {
      // Run any pending migrations (e.g., 010+)
      const pendingResults = await runner.runMigrations();
      if (pendingResults.length > 0) {
        logger.info('Applied %d pending migrations', pendingResults.length);
        const failed = pendingResults.filter((r) => !r.success);
        if (failed.length > 0) {
          const errors = failed.map((r) => `Migration ${r.version}: ${r.error}`).join(', ');
          throw new Error(`Pending migrations failed: ${errors}`);
        }
      } else {
        logger.info('Database is up to date, no pending migrations');
      }
      break;
    }
  }

  logger.info('Database setup completed successfully');
}

/**
 * Helper function to run normal migrations
 */
async function runNormalMigrations(runner: MigrationRunner): Promise<void> {
  const results = await runner.runMigrations();
  const failed = results.filter((r) => !r.success);

  if (failed.length > 0) {
    const errors = failed.map((r) => `Migration ${r.version}: ${r.error}`).join(', ');
    throw new Error(`Migration failed: ${errors}`);
  }

  if (results.length > 0) {
    logger.info('Applied %d migrations successfully', results.length);
  }
}
