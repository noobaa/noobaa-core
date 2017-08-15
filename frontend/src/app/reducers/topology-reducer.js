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
function onCompleteFetchSystemInfo(state, { payload }) {
    const { cluster } = payload;

    const serverList = flatMap(
        cluster.shards,
        shard => shard.servers.map(server =>
            _mapServer(cluster.master_secret, server)
        )
    );

    const servers = keyByProperty(serverList, 'secret');
    return { servers };
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapServer(masterSecret, server) {
    const { hostname, timezone, secret} = server;
    const isMaster = secret === masterSecret;
    return { hostname, secret, timezone, isMaster };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
