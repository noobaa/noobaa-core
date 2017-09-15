/* Copyright (C) 2016 NooBaa */

import {
    ENSURE_HELP_METADATA,
    COMPLETE_ENSURE_HELP_METADATA,
    FAIL_ENSURE_HELP_METADATA
} from 'action-types';

export function ensureHelpMetadata() {
    return { type: ENSURE_HELP_METADATA };
}

export function completeEnsureHelpMetadata() {
    return { type: COMPLETE_ENSURE_HELP_METADATA };
}

export function failEnsureHelpMetadata() {
    return { type: FAIL_ENSURE_HELP_METADATA };
}
