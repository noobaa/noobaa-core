/* Copyright (C) 2016 NooBaa */

import Rx from 'rx';
import { deepFreeze } from 'utils/core-utils';

export const action$ = new Rx.Subject();

export function dispatch(action) {
    if (!action.type) {
        throw TypeError('Invalid actions, missing a type property');
    }

    action$.onNext(deepFreeze(action));
}
