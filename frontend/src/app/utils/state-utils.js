/* Copyright (C) 2016 NooBaa */

import { omitUndefined, pick, equalItems } from 'utils/core-utils';

const expFieldsToCopy = [
    'message',
    'stack',
    'code',
    'rpc_code'
];

export function mapErrorObject(exp) {
    return omitUndefined(pick(exp, expFieldsToCopy));
}

export function mapApiStorage(storage, lastUpdate) {
    return omitUndefined({
        lastUpdate: lastUpdate,
        total: storage.total,
        free: storage.free,
        spilloverFree: storage.spillover_free,
        unavailableFree: storage.unavailable_free,
        used: storage.used,
        usedOther: storage.used_other,
        reserved: storage.reserved
    });
}

export function createSelector(argsSelectors, resultSelector, options = {}) {
    const {
        areResultArgsEqual = equalItems
    } = options;

    let lastResult, lastResultArgs = [];
    return (...args) => {
        const resultArgs = [];
        for (let i = 0; i < argsSelectors.length; ++i) {
            resultArgs.push(argsSelectors[i](...args));
        }

        if (!areResultArgsEqual(resultArgs, lastResultArgs)) {
            lastResultArgs = resultArgs;
            lastResult = resultSelector(...resultArgs);
        }
        return lastResult;
    };
}
