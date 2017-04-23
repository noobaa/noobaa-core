/* Copyright (C) 2016 NooBaa */

import { mapValues, keyBy, echo } from './core-utils';
import { bigInteger, toBigInteger, fromBigInteger,
    interpolateSizes } from './size-utils';

export function aggregateStorage(...list) {
    const aggregate = list.reduce(
        (aggregate, storage) => {
            for (const [key, value] of Object.entries(storage)) {
                aggregate[key] = (aggregate[key] || bigInteger.zero).add(
                    toBigInteger(value)
                );
            }
            return aggregate;
        },
        {}
    );

    return mapValues(aggregate, fromBigInteger);
}

export function interpolateStorage(storage1, storage2, t) {
    const keySet = new Set([
        ...Object.keys(storage1),
        ...Object.keys(storage2)
    ]);

    return keyBy(
        keySet.keys(),
        echo,
        key => interpolateSizes(storage1[key], storage2[key], t)
    );
}

