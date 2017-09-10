/* Copyright (C) 2016 NooBaa */

import {
    ENSURE_HELP_META,
    COMPLETE_ENSURE_HELP_META,
    FAIL_ENSURE_HELP_META
} from 'action-types';

export function ensureHelpMeta() {
    return { type: ENSURE_HELP_META };
}

export function completeEnsureHelpMeta() {
    return { type: COMPLETE_ENSURE_HELP_META };
}

export function failEnsureHelpMeta() {
    return { type: FAIL_ENSURE_HELP_META };
}
