/* Copyright (C) 2016 NooBaa */

import { CHANGE_LOCATION } from 'action-types';

export function changeLocation(location) {
    return {
        type: CHANGE_LOCATION,
        payload: location
    };
}

