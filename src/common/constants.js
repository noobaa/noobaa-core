/* Copyright (C) 2026 NooBaa */
'use strict';

const COMMON_CONSTANTS = {
  S3: {
    VERSIONING: {
      ENABLED: 'ENABLED',
      SUSPENDED: 'SUSPENDED',
      DISABLED: "DISABLED"
    },
    VERSION_NULL: 'null'
  },
  ARCHIVE: {
    STORAGE_CLASS: {
      DEEP_ARCHIVE: 'DEEP_ARCHIVE',
      GLACIER: 'GLACIER',
    },
    TRANSITION_STATUS: {
      IN_PROGRESS: 'IN_PROGRESS',
      DONE: 'DONE',
    },
    RESTORE_UPDATE_INTENT: {
      START: 'START_RESTORE',
      UPDATE_EXPIRY: 'UPDATE_RESTORE_EXPIRY',
      COMPLETE: 'COMPLETE_RESTORE', // worker finished restore copy
      CLEAR_CLAIM: 'CLEAR_RESTORE_CLAIM', // roll back failed object restore; clear ongoing for retry
    },
  },
  STORE_TYPE: {
    S3: 'BLOCK_STORE_S3',
  },
};

module.exports = COMMON_CONSTANTS;
