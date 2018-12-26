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
    const {
        name,
        version,
        handler,
        description,
        runtime,
        timeout,
        memory_size: memorySize,
        code_size: codeSize,
        last_modified: lastModified,
        exec_account: executor
    } = func.config;

    return {
        name,
        version,
        handler,
        description,
        runtime,
        timeout,
        memorySize,
        codeSize,
        lastModified,
        executor
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
