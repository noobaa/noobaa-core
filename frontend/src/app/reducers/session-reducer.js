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

function onSessionRestored(_, { account, system, role }) {
    return _getSessionObject(account, system, role);
}

function onSignedIn(_, { account, system, role }) {
    return _getSessionObject(account, system, role);
}

function onSignOut() {
    return initialState;
}

// ------------------------------
// Local util functions
// ------------------------------
function _getSessionObject(account, system, role) {
    return {
        user: account.email,
        system: system.name,
        role: role,
        passwordExpired: Boolean(account.must_change_password)
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer({
    INIT_APPLICATION: onInitApplication,
    SESSION_RESTORED: onSessionRestored,
    SIGNED_IN: onSignedIn,
    SIGN_OUT: onSignOut
});
