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
        const accessKeys = account.access_keys[0];
        return {
            name: account.name,
            email: account.email,
            hasS3Access: account.has_s3_access,
            allowedBuckets: account.allowed_buckets,
            defaultResource: account.default_pool,
            accessKeys: {
                accessKey: accessKeys.access_key,
                secretKey: accessKeys.secret_key
            }
        };
    });
}

function onCreateAccount(accounts, { name, email }) {
    return {
        ...accounts,
        [email]: { name, email, mode: 'IN_CREATION' }
    };
}

function onAccountCreationFailed(accounts, { email }) {
    return {
        ...accounts,
        [email]: {
            ...accounts.email,
            mode: 'CREATION_FAILURE'
        }
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
    CREATE_ACCOUNT: onCreateAccount,
    ACCOUNT_CREATION_FAILED: onAccountCreationFailed
});
