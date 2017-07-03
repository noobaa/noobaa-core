/* Copyright (C) 2016 NooBaa */

import { Subject } from 'rx';
import { deepFreeze, isObject, noop } from 'utils/core-utils';
import reducer from 'reducers';

// Actions stream.
export const action$ = global.action$ = new Subject();
action$.ofType = function(...types) {
    return this.filter(action => types.includes(action.type));
};

function _filterMishapedActions(action) {
    if (!isObject(action)) {
        console.warn('Invalid action:', action, 'is not an object');
        return false;
    }

    if (!action.type) {
        console.warn('Invalid action:', action, 'is missing a type property');
        return false;
    }

    return true;
}

// Project action stream into a state stream.
export const state$ = action$
    .filter(_filterMishapedActions)
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
    noop,
    error => console.error('STATE STREAM ERROR:', error),
    () => console.error('STATE STREAM TERMINATED')
);
