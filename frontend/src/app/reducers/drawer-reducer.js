import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Action Handlers
// ------------------------------
function onInit() {
    return null;
}

function onDrawerOpen(_, { component }) {
    return component;
}

function onDrawerClose() {
    return null;
}

// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer({
    INIT: onInit,
    DRAWER_OPEN: onDrawerOpen,
    DRAWER_CLOSE: onDrawerClose
});
