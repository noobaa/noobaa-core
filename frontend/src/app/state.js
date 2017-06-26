/* Copyright (C) 2016 NooBaa */

import Rx from 'rx';
import { deepFreeze, isObject } from 'utils/core-utils';
import appReducer from 'reducers/app-reducer';
import rootEpic from 'epics';
import actionsModelBridge from 'actions-model-bridge';

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
        'color: #08955b', 'with',
        action.payload
    ))
    .scan((state, action) => deepFreeze(appReducer(state, action)), {})
    .debounce(1)
    .tap(state => console.log('UPDATING VIEW with', state))
    .shareReplay(1);

state$.subscribe(
    state => global.state = state,
    error => console.error('STATE STREAM ERROR:', error),
    () => console.error('STATE STREAM TERMINATED')
);

// Register epic.
action$.ofType = function(...types) {
    return this.filter(action => types.includes(action.type));
};
rootEpic(action$)
    .subscribe(dispatch);

// Register a bridge between the action stream and the old model.
actionsModelBridge(action$);
