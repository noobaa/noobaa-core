/* Copyright (C) 2016 NooBaa */

import {
    CREATE_LAMBDA_FUNC,
    COMPLETE_CREATE_LAMBDA_FUNC,
    FAIL_CREATE_LAMBDA_FUNC,
    DELETE_LAMBDA_FUNC,
    COMPLETE_DELETE_LAMBDA_FUNC,
    FAIL_DELETE_LAMBDA_FUNC,
    UPDATE_LAMBDA_FUNC_CONFIG,
    COMPLETE_UPDATE_LAMBDA_FUNC_CONFIG,
    FAIL_UPDATE_LAMBDA_FUNC_CONFIG
} from 'action-types';


export function createLambdaFunc(
    name,
    version,
    description,
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
            description,
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

export function completeCreateLambdaFunc(name, version) {
    return {
        type: COMPLETE_CREATE_LAMBDA_FUNC,
        payload: { name, version }
    };
}

export function failCreateLambdaFunc(name, version, error) {
    return {
        type: FAIL_CREATE_LAMBDA_FUNC,
        payload: { name, version, error }
    };
}

export function deleteLambdaFunc(name, version) {
    return {
        type: DELETE_LAMBDA_FUNC,
        payload: { name, version }
    };
}

export function completeDeleteLambdaFunc(name, version) {
    return {
        type: COMPLETE_DELETE_LAMBDA_FUNC,
        payload: { name, version }
    };
}

export function failDeleteLambdaFunc(name, version, error) {
    return {
        type: FAIL_DELETE_LAMBDA_FUNC,
        payload: { name, version, error }
    };
}

export function updateLambdaFuncConfig(
    name,
    version,
    description,
    runtime,
    memorySize,
    timeout
) {
    return {
        type: UPDATE_LAMBDA_FUNC_CONFIG,
        payload: {
            name,
            version,
            description,
            runtime,
            memorySize,
            timeout
        }
    };
}

export function completeUpdateLambdaFuncConfig(name, version) {
    return {
        type: COMPLETE_UPDATE_LAMBDA_FUNC_CONFIG,
        payload: { name, version }
    };
}

export function failUpdateLambdaFuncConfig(name, version, error) {
    return {
        type: FAIL_UPDATE_LAMBDA_FUNC_CONFIG,
        payload: { name, version, error }
    };
}

