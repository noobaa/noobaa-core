/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { flatMap, keyByProperty } from 'utils/core-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload }) {
    return keyByProperty(
        flatMap(payload.buckets, bucket =>
            bucket.triggers.map(trigger =>
                _mapTrigger(bucket, trigger)
            )
        ),
        'id'
    );
}

// ------------------------------
// Local util functions
// ------------------------------
function _calcTriggerMode(trigger) {
    if (!trigger.enabled) {
        return 'DISABLED';
    }

    if (trigger.permission_problem) {
        return 'MISSING_PERMISSIONS';
    }

    return 'OPTIMAL';
}

function _mapTrigger(bucket, trigger) {
    return {
        id: trigger.id,
        mode: _calcTriggerMode(trigger),
        event: trigger.event_name,
        bucket: {
            kind: bucket.bucket_type === 'REGULAR' ?
                'DATA_BUCKET' :
                'NAMESPACE_BUCKET',
            name: bucket.name
        },
        func: {
            name: trigger.func_name,
            version: trigger.func_version
        },
        prefix: trigger.object_prefix || '',
        suffix: trigger.object_suffix || '',
        lastRun: trigger.last_run
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
