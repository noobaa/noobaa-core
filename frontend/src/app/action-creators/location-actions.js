/* Copyright (C) 2016 NooBaa */

import {
    REQUEST_LOCATION,
    REFRESH_LOCATION,
    CHANGE_LOCATION
} from 'action-types';

export function requestLocation(url, redirect = false) {
    return {
        type: REQUEST_LOCATION,
        payload: { url, redirect }
    };
}

export function refreshLocation() {
    return { type: REFRESH_LOCATION };
}

export function changeLocation(location) {
    return {
        type: CHANGE_LOCATION,
        payload: location
    };
}

