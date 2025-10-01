// src/test-logger.ts
// Quick test script to verify logger is working correctly

import { logger } from './utils/logger';

// Test all log levels
logger.debug('This is a debug message');
logger.info('This is an info message');
logger.warn('This is a warning message');
logger.error('This is an error message');

// Test error with stack trace
try {
  throw new Error('Test error with stack trace');
} catch (error) {
  logger.error('Caught error during test', error as Error);
}

console.log('\nCheck logs directory for output files');
