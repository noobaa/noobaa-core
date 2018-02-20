/* Copyright (C) 2016 NooBaa */

import { Subject }  from 'rx';
import reducer from 'reducers';
import stateSchema from './schema';
import { deepFreeze, isObject, noop } from 'utils/core-utils';
import { createSchemaValidator } from 'utils/schema-utils';
import { mapErrorObject } from 'utils/state-utils';

const maxLogSize = 450;
const schemaValidator = createSchemaValidator(stateSchema);

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

function _reduceState(prevState, action) {
    try {
        const state = reducer(prevState, action);
        const violations = schemaValidator(state);

        if (violations) {
            const error = {
                type: 'STATE_SCHEMA_VAIOLATIONS',
                violations
            };

            console.error('Invalid state', error);
            return deepFreeze({
                ...prevState,
                lastError: error
            });

        } else {
            return deepFreeze({
                ...state,
                lastError: prevState.lastError
            });
        }

    } catch (exp) {
        console.error(exp);
        const error = {
            type: 'STATE_REDUCER_ERROR',
            ...mapErrorObject(exp)
        };

        return deepFreeze({
            ...prevState,
            lastError: error
        });
    }
}

function _reduceRecords(prev, action) {
    const state = _reduceState(prev.state || {}, action);
    const timestamp = Date.now();
    return { timestamp, action, state };
}

function _reduceLog(log, record) {
    return log
        .concat(record)
        .slice(-maxLogSize);
}

// Actions stream.
export const action$ = new Subject();
action$.ofType = function(...types) {
    return this.filter(action => types.includes(action.type));
};

const record$ = action$
    .filter(_filterMishapedActions)
    .scan(_reduceRecords, {})
    .share();

export const state$ = record$
    .pluck('state')
    .distinctUntilChanged(undefined, Object.is)
    .switchMap(value => Promise.resolve(value))
    .shareReplay(1);

export const appLog$ = record$
    .scan(_reduceLog, [])
    .shareReplay(1);

// Subcribe so we will not loose action that are dispatched
// before any other subscription.
state$.subscribe(noop);
