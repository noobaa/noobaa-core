/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getHostStateIcon, getHostCapacityBarValues } from 'utils/host-utils';


const activityNameMapping = deepFreeze({
    RESTORING: 'Restoring',
    MIGRATING: 'Migrating',
    DECOMMISSIONING: 'Deactivating',
    DELETING: 'Deleting'
});

const activityStageMapping = deepFreeze({
    OFFLINE_GRACE: 'Waiting',
    REBUILDING: 'Rebuilding',
    WIPING: 'Wiping Data'
});

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
        const { name, hostname, ip, storageService, gatewayService } = host;
        const uri = realizeUri(this.baseRoute, { node: name });

        this.state(getHostStateIcon(host));
        this.hostname({ text: hostname, href: uri });
        this.ip(ip);
        this.services({
            storage: storageService.enabled || Boolean(Math.round(Math.random())),
            gateway: gatewayService.enabled || Boolean(Math.round(Math.random()))
        });
        this.capacity(getHostCapacityBarValues(host));
        this.dataActivity('No Activity');
    }
}

// export default class NodeRowViewModel extends BaseViewModel {
//     constructor(node) {
//         super();

//         this.state = ko.pureComputed(
//             () => node() ? getNodeStateIcon(node()) : ''
//         );

//         this.name = ko.pureComputed(
//             () => {
//                 if (!node()) {
//                     return '';
//                 }

//                 const { name } = node();
//                 return {
//                     text: name,
//                     href: { route: 'node', params: { node: name, tab: null } }
//                 };
//             }
//         );

//         this.ip = ko.pureComputed(
//             () => node() ? node().ip : ''
//         );

//         this.capacity = ko.pureComputed(
//             () => getNodeCapacityBarValues(node() || {})
//         );

//         this.dataActivity = ko.pureComputed(
//             () => {
//                 if (!node() || !node().data_activity) {
//                     return 'No activity';
//                 }

//                 const { reason, stage, progress } = node().data_activity;
//                 return `${
//                     activityNameMapping[reason]
//                 } ${
//                     numeral(progress).format('0%')
//                 } | ${
//                     activityStageMapping[stage.name]
//                 }`;
//             }
//         );
//     }
// }
