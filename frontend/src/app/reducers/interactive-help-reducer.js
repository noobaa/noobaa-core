/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    COMPLETE_ENSURE_HELP_METADATA,
    SELECT_HELP_TOPIC,
    CLOSE_HELP_VIEWER,
    RESIZE_HELP_VIEWER,
    SELECT_HELP_SLIDE
} from 'action-types';
// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    metadataLoaded: false,
    selected: null
};

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteEnsureHelpMetadata(state) {
    return {
        ...state,
        metadataLoaded: true
    };
}

function onSelectHelpTopic(state, { payload }) {
    return {
        ...state,
        selected: {
            name: payload.name,
            slide: 0,
            minimized: false
        }
    };
}

function onCloseHelpViewer(state) {
    return {
        ...state,
        selected: null
    };
}

function onResizeHelpViewer(state) {
    const selected  = state.selected;
    return {
        ...state,
        selected: {
            ...selected,
            minimized: !selected.minimized
        }
    };
}

function onSelectHelpSlide(state, { payload } ) {
    const selected  = state.selected;
    return {
        ...state,
        selected: {
            ...selected,
            slide: payload.slide
        }
    };
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_ENSURE_HELP_METADATA]: onCompleteEnsureHelpMetadata,
    [SELECT_HELP_TOPIC]: onSelectHelpTopic,
    [CLOSE_HELP_VIEWER]: onCloseHelpViewer,
    [RESIZE_HELP_VIEWER]: onResizeHelpViewer,
    [SELECT_HELP_SLIDE]: onSelectHelpSlide
});
