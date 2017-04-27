import { createReducer } from 'utils/reducer-utils';
import { INIT_APPLICAITON } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------
function onInitApplication(_, { payload }) {
    return payload.flags;
}


// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [INIT_APPLICAITON]: onInitApplication
});
