/* Copyright (C) 2016 NooBaa */

import Rx from 'rx';
import { deepFreeze, isObject } from 'utils/core-utils';
import reducer from 'reducers';

// Actions stream.
export const action$ = new Rx.Subject();

// Dispatch helper.
export function dispatch(action) {
    if (!isObject(action)) {
        throw TypeError('Invalid action, not an object');
    }

    if (!action.type) {
        throw TypeError('Invalid action, missing a type property');
    }

    action$.onNext(deepFreeze(action));
}

// Project action stream into a state stream.
export const state$ = action$
    .tap(action => console.log(
        `DISPATCHING %c${action.type}`,
        'color: #08955b',
        'with',
        action.payload
    ))
    .scan((state, action) => deepFreeze(reducer(state, action)), {})
    .switchMap(state => Promise.resolve(state))
    .tap(state => console.log('UPDATING VIEW with', state))
    .shareReplay(1);

state$.subscribe(
    state => global.state = state,
    error => console.error('STATE STREAM ERROR:', error),
    () => console.error('STATE STREAM TERMINATED')
);
