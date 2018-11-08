/* Copyright (C) 2016 NooBaa */

export function errorIcon(tooltip) {
    return {
        name: 'problem',
        css: 'error',
        tooltip
    };
}

export function warningIcon(tooltip) {
    return {
        name: 'problem',
        css: 'warning',
        tooltip
    };
}

export function processIcon(tooltip) {
    return {
        name: 'working',
        css: 'warning',
        tooltip
    };
}

export function healthyIcon(tooltip) {
    return {
        name: 'healthy',
        css: 'success',
        tooltip
    };
}
