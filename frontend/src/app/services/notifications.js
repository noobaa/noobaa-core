/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state';
import { fetchUnreadAlertsCount } from 'action-creators';

export function alert() {
    dispatch(fetchUnreadAlertsCount());
}
