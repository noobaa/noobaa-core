/* Copyright (C) 2016 NooBaa */

import { getUnreadAlertsCount } from 'dispatchers';

export function alert() {
    getUnreadAlertsCount();
}
