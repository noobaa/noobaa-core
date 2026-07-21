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
  },
};

module.exports = COMMON_CONSTANTS;
