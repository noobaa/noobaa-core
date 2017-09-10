/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_ENSURE_HELP_META } from 'action-types';
// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    metadataLoaded: false
};

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteEnsureHelpMetadata(/*_ , { payload }*/) {
    return {
        metadataLoaded: true
    };
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_ENSURE_HELP_META]: onCompleteEnsureHelpMetadata
});
