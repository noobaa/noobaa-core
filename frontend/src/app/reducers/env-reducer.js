import { createReducer } from 'utils/reducer-utils';
import {
    TOGGLE_PREVIEW_CONTENT,
    SETUP_ENV,
    DISSMISS_BROWSER_STICKY
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    previewContent: false
};

// ------------------------------
// Action Handlers
// ------------------------------
function onTogglePreviewContent(env) {
    return {
        ...env,
        previewContent: !env.previewContent
    };
}

function onSetupEnv(env, { payload } ) {
    return {
        ...env,
        browser: payload.browser
    };
}

function onDismissBrowserSticky(env) {
    return {
        ...env,
        isBrowserStickyDismissed: true
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [TOGGLE_PREVIEW_CONTENT]: onTogglePreviewContent,
    [SETUP_ENV]: onSetupEnv,
    [DISSMISS_BROWSER_STICKY]: onDismissBrowserSticky
});
