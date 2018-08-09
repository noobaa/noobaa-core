/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    required: [
        'previewContent',
        'browser'
    ],
    properties: {
        browser: {
            type: 'string'
        },
        previewContent: {
            type: 'boolean'
        },
        isBrowserStickyDismissed: {
            type: 'boolean'
        }
    }
};
