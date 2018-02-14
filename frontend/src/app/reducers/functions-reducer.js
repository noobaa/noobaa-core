/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { keyBy } from 'utils/core-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload }) {
    return keyBy(
        payload.functions || [],
        func => _getFuncId(func.config.name, func.config.version),
        _mapFunc
    );
}

// ------------------------------
// Local util functions
// ------------------------------
function _getFuncId(name, version) {
    return `${name}:${version}`;
}

function _mapFunc(func) {
    const { name, version, exec_account } = func.config;

    return {
        name,
        version,
        executor: exec_account
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
