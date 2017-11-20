/* Copyright (C) 2016 NooBaa */

import { action$ } from 'state';
import { fetchUnreadAlertsCount, showNotification } from 'action-creators';

export function alert() {
    action$.onNext(fetchUnreadAlertsCount());
}

export function add_memeber_to_cluster(req) {
    const { result } = req.rpc_params;

    //TODO: This is a W/A until we move attach server to the new arch
    const action = result ?
        showNotification('Server was successfully added to the cluster', 'success') :
        showNotification('Adding server to the cluster failed', 'error');

    action$.onNext(action);
}

export function remove_host(/*req*/) {
    // console.warn('Host', req.rpc_params.name, 'is deleted');
}
