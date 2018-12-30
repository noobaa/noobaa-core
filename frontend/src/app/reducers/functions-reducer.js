/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { keyBy } from 'utils/core-utils';
import { handlerFileSuffix } from 'utils/func-utils';
import {
    COMPLETE_FETCH_SYSTEM_INFO,
    LOAD_LAMBDA_FUNC_CODE,
    COMPLETE_LOAD_LAMBDA_FUNC_CODE,
    FAIL_LOAD_LAMBDA_FUNC_CODE,
    DROP_LAMBDA_FUNC_CODE
} from 'action-types';

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
        (func, id) => _mapFunc(state && state[id], func)
    );
}

function onLoadLambdaFuncCode(state, { payload }) {
    const id = _getFuncId(payload.name, payload.version);
    if (!state || !state[id]) {
        return state;
    }

    return {
        ...state,
        [id]: {
            ...state[id],
            codeBuffer: {
                loading: true,
                error: false,
                handle: null
            }
        }
    };
}

function onCompleteLoadLambdaFuncCode(state, { payload }) {
    const { name, version, codeHash, bufferHandle } = payload;
    const id = _getFuncId(name, version);
    if (!state || !state[id]) {
        return state;
    }

    const mismatch = state[id].codeHash !== codeHash;
    const handle = mismatch ? null : bufferHandle;
    return {
        ...state,
        [id]: {
            ...state[id],
            codeBuffer: {
                loading: false,
                error: mismatch,
                handle
            }
        }
    };
}

function onFailLoadLambdaFuncCode(state, { payload }) {
    const id = _getFuncId(payload.name, payload.version);
    if (!state || !state[id]) {
        return state;
    }

    return {
        ...state,
        [id]: {
            ...state[id],
            codeBuffer: {
                loading: false,
                error: true,
                handle: null
            }
        }
    };
}

function onDropLambdaFuncCode(state, { payload }) {
    const id = _getFuncId(payload.name, payload.version);
    if (!state || !state[id]) {
        return state;
    }

    return {
        ...state,
        [id]: {
            ...state[id],
            codeBuffer: {
                loading: false,
                error: false,
                handle: null
            }
        }
    };
}

// ------------------------------
// Local util functions
// ------------------------------
function _getFuncId(name, version) {
    return `${name}:${version}`;
}

function _mapFunc(state = {}, func) {
    const { config } = func;
    const [execFile, execFunc] = config.handler.split(/[.]([^.]+$)/);
    const codeBuffer = state.codeHash === config.code_sha256 ?
        state.codeBuffer :
        {
            loading: false,
            error: false,
            handle: null
        };

    return {
        name: config.name,
        version: config.version,
        execFile: `${execFile}${handlerFileSuffix}`,
        execFunc,
        description: config.description,
        runtime: config.runtime,
        timeout: config.timeout,
        memorySize: config.memory_size,
        lastModified: config.last_modified,
        lastModifier: config.last_modifier,
        executor: config.exec_account,
        codeSize: config.code_size,
        codeHash: config.code_sha256,
        codeBuffer
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo,
    [LOAD_LAMBDA_FUNC_CODE]: onLoadLambdaFuncCode,
    [COMPLETE_LOAD_LAMBDA_FUNC_CODE]: onCompleteLoadLambdaFuncCode,
    [FAIL_LOAD_LAMBDA_FUNC_CODE]: onFailLoadLambdaFuncCode,
    [DROP_LAMBDA_FUNC_CODE]: onDropLambdaFuncCode
});
