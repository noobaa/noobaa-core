/* Copyright (C) 2016 NooBaa */

import { omitUndefined, pick } from 'utils/core-utils';

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
