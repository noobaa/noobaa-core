import { createReducer } from 'utils/reducer-utils';
import { TOGGLE_PREVIEW_CONTENT, COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

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

function onCompleteFetchSystemInfo(env, { payload }) {
    return {
        ...env,
        hasSslCert: payload.has_ssl_cert
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [TOGGLE_PREVIEW_CONTENT]: onTogglePreviewContent,
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
