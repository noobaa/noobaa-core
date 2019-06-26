import {
    fetchUnreadAlertsCount,
    showNotification,
    removeHost,
    fetchSystemInfo
} from 'action-creators';

export default class NotificationApiImpl {
    constructor(action$) {
        this.dispatch = action => action$.next(action);
    }

    alert() {
        this.dispatch(fetchUnreadAlertsCount());
    }

    add_memeber_to_cluster(req) {
        const { result } = req.rpc_params;

        //TODO: This is a W/A until we move attach server to the new arch
        const action = result ?
            showNotification('Server was successfully added to the cluster', 'success') :
            showNotification('Adding server to the cluster failed', 'error');

        this.dispatch(action);
    }

    remove_host(req) {
        const { name: host } = req.rpc_params;
        this.dispatch(removeHost(host));
    }

    change_upgrade_status() {
        this.dispatch(fetchSystemInfo());
    }
}
