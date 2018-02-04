/* Copyright (C) 2016 NooBaa */

import { omitUndefined } from 'utils/core-utils';

export function mapErrorObject(exp) {
    return omitUndefined({
        message: exp.message,
        stack: exp.stack,
        rpc_code: exp.rpc_code
    });
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
