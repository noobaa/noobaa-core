import { omitUndefined } from './core-utils';

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
