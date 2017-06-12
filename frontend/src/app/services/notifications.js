/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state';
import { FETCH_UNREAD_ALERTS_COUNT } from 'action-types';

export function alert() {
    dispatch({ type: FETCH_UNREAD_ALERTS_COUNT });
}
