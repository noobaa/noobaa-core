import { echo, mapValues } from 'utils/core-utils';

// Join action handlers into a single reducer.
export function createReducer(handlers) {
    return function(state, action, root) {
        return (handlers[action.type] || echo)(state, action, root);
    };
}

// Combine a map of slice reducers into a master reducer.
export function combineReducers(reducers) {
    return function(state = {}, action, root = state) {
        return mapValues(
            reducers,
            (reducer, key) => reducer(state[key], action, root)
        );
    };
}
