/* Copyright (C) 2016 NooBaa */

import {
    CREATE_LAMBDA_FUNC,
    COMPLETE_CREATE_LAMBDA_FUNC,
    FAIL_CREATE_LAMBDA_FUNC
} from 'action-types';


export function createLambdaFunc(
    name,
    version,
    desc,
    runtime,
    handlerFile,
    handlerFunc,
    memorySize,
    timeout,
    codeBufferKey,
    codeBufferSize
) {
    return {
        type: CREATE_LAMBDA_FUNC,
        payload: {
            name,
            version,
            desc,
            runtime,
            handlerFile,
            handlerFunc,
            memorySize,
            timeout,
            codeBufferKey,
            codeBufferSize
        }
    };
}

export function completeCreateLambdaFunc(name) {
    return {
        type: COMPLETE_CREATE_LAMBDA_FUNC,
        payload: { name }
    };
}

export function failCreateLambdaFunc(name, error) {
    return {
        type: FAIL_CREATE_LAMBDA_FUNC,
        payload: { name, error }
    };
}

