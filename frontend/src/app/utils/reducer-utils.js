import { echo } from 'utils/js-utils';

// Join action handlers into a single reducer.
export function createReducer(handlers) {
    return function(state, action, root) {
        return (handlers[action.type] || echo)(state, action, root);
    };
}

// Combine a map of slice reducers into a master reducer.
export function combineReducers(reducers) {
    const pairs = Object.entries(reducers);
    return function(state, action, root = state) {
        return pairs.reduce(
            (newState, [key, reducer]) => {
                newState[key] = reducer(state[key], action, root);
                return newState;
            },
            {}
        );
    };
}
