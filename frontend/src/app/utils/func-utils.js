/* Copyright (C) 2016 NooBaa */

import { deepFreeze } from './core-utils';
import { unitsInBytes } from 'utils/size-utils';

const funcNameRegExp = /^[a-zA-Z0-9-_]+$/;
const handlerFuncNameRegExp = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

export const funcSizeLimit = unitsInBytes.MEGABYTE * 100;
export const handlerFileSuffix = '.js';
export const memorySizeOptions = deepFreeze([
    {
        value: 128,
        label: '128 MB'
    },
    {
        value: 256,
        label: '256 MB'
    },
    {
        value: 512,
        label: '512 MB'
    }
]);

export function getFunctionOption(func, accounts, bucket) {
    const { name, version } = func;
    const value = `${name}:${version}`;
    const icon = { name: 'healthy', css: 'success' };
    const label = name;
    const executor = accounts[func.executor];
    const disabled = !executor.hasAccessToAllBuckets &&
        !executor.allowedBuckets.includes(bucket);

    let tooltip = '';
    if (disabled) {
        tooltip = `This function was created by ${executor.name},
            This account doesn’t have permissions for this bucket and the function
            cannot be selected until access is granted.`;
    }

    return { value, icon, label, disabled, tooltip };
}
export function isValidFuncName(name){
    return funcNameRegExp.test(name);
}

export function isValidHandlerFuncName(name) {
    return handlerFuncNameRegExp.test(name);
}

export function getFullHandlerName(handlerFile, handlerFunc) {
    return `${
        handlerFile.slice(0, -handlerFileSuffix.length)
    }.${
        handlerFunc
    }`;
}
