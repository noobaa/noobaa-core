/* Copyright (C) 2016 NooBaa */

import { echo, mapValues } from 'utils/core-utils';

// Join action handlers into a single reducer.
export function createReducer(initialState, handlers) {
    return function(state = initialState, action) {
        return (handlers[action.type] || echo)(state, action);
    };
}

// Combine a map of slice reducers into a master reducer.
export function combineReducers(reducers) {
    return function(state = {}, action) {
        return mapValues(
            reducers,
            (reducer, key) => reducer(state[key], action)
        );
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

// Select a reducer based on a selector. The selector should return a boolean
// for left/right selection.
export function selectReducer(selector, leftReducer = echo, rightReducer = echo) {
    return function(state, action) {
        return (selector(state, action) ? leftReducer : rightReducer)(state, action);
    };
}

export function filterActions(filter, reducer) {
    return function(state, action) {
        return filter(action) ? reducer(state, action) : state;
    };
}
