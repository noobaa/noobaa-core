/* Copyright (C) 2016 NooBaa */

import { Subject } from 'rx';
import reducer from 'reducers';
import stateSchema from './schema/state';
import { deepFreeze, isObject, noop } from 'utils/core-utils';
import { createSchemaValidator } from 'utils/schema-utils';


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

// Check state against schema
const schemaValidator = createSchemaValidator(stateSchema);
function _validateState(state) {
    const errors = schemaValidator(state);
    if (errors) {
        console.error('INVALID STATE', { state, errors });
        throw new Error('Invalid state');
    }
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
    .tap(_validateState)
    .switchMap(state => Promise.resolve(state))
    .tap(state => console.log('UPDATING VIEW with', state))
    .shareReplay(1);

state$.subscribe(
    noop,
    error => console.error('STATE STREAM ERROR:', error),
    () => console.error('STATE STREAM TERMINATED')
);
