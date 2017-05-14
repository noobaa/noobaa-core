/* Copyright (C) 2016 NooBaa */

import Rx from 'rx';
import { deepFreeze, noop } from 'utils/core-utils';
import appReducer from 'reducers/app-reducer';

// Actions stream.
export const action$ = new Rx.Subject();

// Dispatch helper.
export function dispatch(action) {
    if (!action.type) {
        throw TypeError('Invalid action, missing a type property');
    }

    action$.onNext(deepFreeze(action));
}

// State stream.
export const state$ = action$
    .tap(action => console.info('DISPATCHING:', action))
    .scan((state, action) => appReducer(state, action), {})
    .map(deepFreeze)
    .tap(state => console.info('NEW STATE:', state))
    .shareReplay(1);

state$.subscribe(
    noop,
    error => console.error('STATE STREAM ERROR:', error),
    () => console.error('STATE STREAM TERMINATED')
);
