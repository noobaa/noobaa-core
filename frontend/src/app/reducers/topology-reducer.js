/* Copyright (C) 2016 NooBaa */

import { keyByProperty, flatMap } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    servers: {}
};

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(_, { payload }) {
    const { cluster } = payload;
    const servers = flatMap(
        cluster.shards,
        shard => shard.servers.map(
            ({ hostname, timezone, secret}) => ({
                hostname: hostname,
                secret: secret,
                timezone,
                isMaster: secret === cluster.master_secret
            })
        )
    );

    return { servers: keyByProperty(servers, 'name')};
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
