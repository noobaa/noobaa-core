/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state-actions';

export function locationChanged(path, route, params, query) {
    dispatch({ type: 'LOCATION_CHANGED', path, route, params, query });
}

