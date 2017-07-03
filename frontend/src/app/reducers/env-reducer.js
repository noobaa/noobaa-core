import { createReducer } from 'utils/reducer-utils';
import { TOGGLE_PREVIEW_CONTENT } from 'action-types';

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

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [TOGGLE_PREVIEW_CONTENT]: onTogglePreviewContent
});
