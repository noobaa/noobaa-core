import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Action Handlers
// ------------------------------
function onApplicationInit() {
    return;
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
