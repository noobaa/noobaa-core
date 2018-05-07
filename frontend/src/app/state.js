/* Copyright (C) 2016 NooBaa */

import reducer from 'reducers';
import stateSchema from './schema';
import { deepFreeze, isObject, noop } from 'utils/core-utils';
import { createSchemaValidator } from 'utils/schema-utils';
import { mapErrorObject } from 'utils/state-utils';
import { Subject }  from 'rxjs';
import { filter, scan, share, pluck, distinctUntilChanged,
    switchMap, shareReplay } from 'rxjs/operators';

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

// Actions stream.
export const action$ = new Subject();


export const record$ = action$.pipe(
    filter(_filterMishapedActions),
    scan(_reduceRecords, {}),
    share()
);

export const state$ = record$.pipe(
    pluck('state'),
    distinctUntilChanged(Object.is),
    switchMap(value => Promise.resolve(value)),
    shareReplay(1)
);

// Subcribe so we will not loose action that are dispatched
// before any other subscription.
state$.subscribe(noop);
