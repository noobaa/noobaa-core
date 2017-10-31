/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { mapApiStorage } from 'utils/state-utils';
import { aggregateStorage } from 'utils/storage-utils';
import { COMPLETE_FETCH_SYSTEM_STORAGE_HISTORY } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onFetchSystemStorageHistory(_, { payload }) {
    return payload.history
        .map(({ timestamp, pool_list }) => {
            let {
                HOSTS: hosts = {},
                CLOUD: cloud = {},
                INTERAL: internal = {}
            } = _summarizeResourceList(pool_list);

            return { timestamp, hosts, cloud, internal };
        })
        .sort((r1, r2) => r1.timestamp - r2.timestamp);
}

// ------------------------------
// Local util functions
// ------------------------------
function _summarizeResourceList(resourceList) {
    return resourceList.reduce(
        (summary, record) => {
            const { resource_type: key, storage } = record;
            summary[key] = aggregateStorage(summary[key] || {}, mapApiStorage(storage));
            return summary;
        },
        {}
    );
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_STORAGE_HISTORY]: onFetchSystemStorageHistory
});
