/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state';
import { fetchUnreadAlertsCount, showNotification } from 'action-creators';

export function alert() {
    dispatch(fetchUnreadAlertsCount());
}

export function add_memeber_to_cluster(req) {
    //TODO: This is a W/A until we move attach server to the new arch
    if (req.rpc_params.result) {
        dispatch(showNotification('Server was successfully added to the cluster', 'success'));
    } else {
        dispatch(showNotification('Adding server to the cluster failed', 'error'));
    }
}
