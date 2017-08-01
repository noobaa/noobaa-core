/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(_, { payload }) {
    const { cluster } = payload;

    const { timezone } = cluster.shards[0].servers.find(
        ({ secret }) => secret === cluster.master_secret
    );

    return { masterTimezone: timezone };
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
