import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = null;

// ------------------------------
// Action Handlers
// ------------------------------
function onApplicationInit() {
    return initialState;
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer({
    APPLICATION_INIT: onApplicationInit
});
