
import {
    TOGGLE_PREVIEW_CONTENT,
    SETUP_ENV,
    DISSMISS_BROWSER_STICKY
} from 'action-types';


export function togglePreviewContent() {
    return { type: TOGGLE_PREVIEW_CONTENT };
}

export function setupEnv(browser, previewContent) {
    return {
        type: SETUP_ENV,
        payload: { browser, previewContent }
    };
}

export function dismissBrowserSticky() {
    return { type: DISSMISS_BROWSER_STICKY };
}


