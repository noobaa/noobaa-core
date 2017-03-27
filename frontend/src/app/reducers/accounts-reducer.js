import { createReducer } from 'utils/reducer-utils';
import { keyByProperty } from 'utils/core-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------
function onInitApplication() {
    return initialState;
}

function onSystemInfoFetched(_, { info }) {
    return keyByProperty(info.accounts, 'email', account => {
        const { name, email } = account;
        return { name, email };
    });
}

function onCreateAccount(accounts, { name, email }) {
    return {
        ...accounts,
        [email]: { name, email, mode: 'IN_CREATION' }
    };
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer({
    INIT_APPLICATION: onInitApplication,
    SYSTEM_INFO_FETCHED: onSystemInfoFetched,
    CREATE_ACCOUNT: onCreateAccount
});
