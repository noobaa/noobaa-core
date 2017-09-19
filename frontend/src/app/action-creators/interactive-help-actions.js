/* Copyright (C) 2016 NooBaa */

import {
    SELECT_HELP_TOPIC,
    CLOSE_HELP_VIEWER,
    RESIZE_HELP_VIEWER,
    SELECT_HELP_SLIDE
} from 'action-types';

export function selectHelpTopic(name) {
    return {
        type: SELECT_HELP_TOPIC,
        payload: { name }
    };
}

export function closeHelpViewer() {
    return { type: CLOSE_HELP_VIEWER };
}

export function resizeHelpViewer() {
    return { type: RESIZE_HELP_VIEWER };
}

export function selectHelpSlide(slide) {
    return {
        type: SELECT_HELP_SLIDE,
        payload: { slide }
    };
}
