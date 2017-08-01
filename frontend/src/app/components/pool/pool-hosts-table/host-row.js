/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { mapValues } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getHostStateIcon, getHostCapacityBarValues } from 'utils/host-utils';

// const activityNameMapping = deepFreeze({
//     RESTORING: 'Restoring',
//     MIGRATING: 'Migrating',
//     DECOMMISSIONING: 'Deactivating',
//     DELETING: 'Deleting'
// });

// const activityStageMapping = deepFreeze({
//     OFFLINE_GRACE: 'Waiting',
//     REBUILDING: 'Rebuilding',
//     WIPING: 'Wiping Data'
// });

export default class HostRowViewModel {
    constructor({ baseRoute }) {
        this.baseRoute = baseRoute;
        this.state = ko.observable();
        this.hostname = ko.observable();
        this.ip = ko.observable();
        this.services = ko.observable();
        this.capacity = ko.observable();
        this.dataActivity = ko.observable();
    }

    onHost(host) {
        const { name, hostname, ip, services } = host;
        const uri = realizeUri(this.baseRoute, { host: name });
        const servicesState = mapValues(services, service => service.mode !== 'DECOMMISSIONED');

        this.state(getHostStateIcon(host));
        this.hostname({ text: hostname, href: uri });
        this.ip(ip);
        this.services(servicesState);
        this.capacity(getHostCapacityBarValues(host));
        this.dataActivity('No Activity');
    }
}
