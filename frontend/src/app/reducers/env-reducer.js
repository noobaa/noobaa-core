import { createReducer } from 'utils/reducer-utils';
import {
    TOGGLE_PREVIEW_CONTENT,
    SETUP_ENV,
    DISSMISS_BROWSER_STICKY
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onSetupEnv(env, { payload } ) {
    return {
        previewContent: false,
        browser: payload.browser,
        isBrowserStickyDismissed: false
    };
}

function onTogglePreviewContent(env) {
    return {
        ...env,
        previewContent: !env.previewContent
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
    [SETUP_ENV]: onSetupEnv,
    [TOGGLE_PREVIEW_CONTENT]: onTogglePreviewContent,
    [DISSMISS_BROWSER_STICKY]: onDismissBrowserSticky
});
