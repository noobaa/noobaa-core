/* Copyright (C) 2016 NooBaa */

import { echo, mapValues } from 'utils/core-utils';

// Join action handlers into a single reducer.
export function createReducer(handlers) {
    return function(state, action) {
        return (handlers[action.type] || echo)(state, action);
    };
}

// Combine a map of slice reducers into a master reducer.
export function combineReducers(reducers) {
    return function(state = {}, action) {
        return {
            ...state,
            ...mapValues(
                reducers,
                (reducer, key) => reducer(state[key], action)
            )
        };
    };
}

// Reduce the state using each reducer in the list in order.
export function reduceReducers(...reducers) {
    return function(state, action) {
        return reducers.reduce(
            (state, reducer) => {
                return reducer(state, action);
            },
            state
        );
    };
}

export function filterActions(filter, reducer) {
    return function(state, action) {
        return filter(action) ? reducer(state, action) : state;
    };
}
