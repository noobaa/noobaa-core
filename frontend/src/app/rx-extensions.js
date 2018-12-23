/* Copyright (C) 2016 NooBaa */

import { get as _get, equalItems, ensureArray, isString } from 'utils/core-utils';
import { filter, map, distinctUntilChanged } from 'rxjs/operators';

export function ofType(...types) {
    if (!types.every(isString)) {
        throw new TypeError('Invalid type constant');
    }

    return source => source.pipe(
        filter(obj => types.includes(obj.type))
    );
}

export function get(...path) {
    return source => source.pipe(
        map(obj => _get(obj, path)),
        distinctUntilChanged(Object.is)
    );
}

export function getMany(...paths) {
    return source => source.pipe(
        map(state => paths.map(path => _get(state, ensureArray(path)))),
        distinctUntilChanged(equalItems)
    );
}

export function toPromise(source) {
    return new Promise((resolve, reject) => {
        source.subscribe(
            resolve,
            reject,
            () => reject(new Error('No more values on stream')),
        );
    });
}
