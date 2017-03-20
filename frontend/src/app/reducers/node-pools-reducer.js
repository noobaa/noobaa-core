import { keyByProperty } from    'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------
function onApplicationInit() {
    return initialState;
}

function onSystemInfoFetched(state, { info }) {
    const nodePools = info.pools.filter(pool => Boolean(pool.nodes));
    return keyByProperty(nodePools, 'name', pool => {
        const { name, mode, storage } = pool;
        return { name, mode, storage };
    });
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer({
    APPLICATION_INIT: onApplicationInit,
    SYSTEM_INFO_FETCHED: onSystemInfoFetched
});
