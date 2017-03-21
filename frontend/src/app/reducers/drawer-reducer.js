import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = null;

// ------------------------------
// Action Handlers
// ------------------------------
function onInitApplication() {
    return initialState;
}

function onOpenDrawer(_, { component }) {
    return component;
}

function onCloseDrawer() {
    return initialState;
}

// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer({
    INIT_APPLICATION: onInitApplication,
    OPEN_DRAWER: onOpenDrawer,
    CLOSE_DRAWER: onCloseDrawer
});
