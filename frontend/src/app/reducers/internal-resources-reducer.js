/* Copyright (C) 2016 NooBaa */

import { keyByProperty } from 'utils/core-utils';
import { COMPLETE_FETCH_SYSTEM_INFO, COMPLETE_FETCH_RESOURCE_STORAGE_HISTORY } from 'action-types';
import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    resources: {},
    storageHistory: []
};

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(internalResources, { payload }) {
    const { pools } = payload;

    const resources = keyByProperty(
        pools.filter(pool => pool.resource_type === 'INTERNAL'),
        'name',
        ({ name, storage, resource_type, mode }) => ({
            name,
            resource_type,
            mode,
            storage: storage
        })
    );

    return { ...internalResources, resources };
}

function onCompleteFetchSystemUsageHistory(internalResources, { payload }) {
    const history = payload;

    const storageHistory = history.map(
        ({timestamp, pool_list }) => {
            const storages = pool_list
                .filter(pool => pool.resource_type === 'INTERNAL')
                .map(pool => pool.storage);

            return { timestamp, storages };
        }
    );

    return { ...internalResources, storageHistory };
}

// ------------------------------
// Local util functions
// ------------------------------


// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo,
    [COMPLETE_FETCH_RESOURCE_STORAGE_HISTORY]: onCompleteFetchSystemUsageHistory
});
