/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { mapValues } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import {
    getHostDisplayName,
    getHostStateIcon,
    getNodeOrHostCapacityBarValues,
    getActivityName,
    getActivityListTooltip
} from 'utils/host-utils';

function _getStorageNodesSummary(storageService) {
    const { enabled, nodes } = storageService;
    const activatedNodesCount = nodes
        .filter(node => node.mode !== 'DECOMMISSIONED')
        .length;
    if (!enabled) {
        return {
            text: 'None',
            tooltip: `Total drives on host: ${nodes.length}`
        };
    } else {
        const healtyNodesCount = nodes
            .filter(node => node.mode === 'OPTIMAL')
            .length;

        return {
            text: `${healtyNodesCount} of ${activatedNodesCount}`,
            tooltip: `Total drives on host: ${nodes.length}`
        };
    }
}

export default class HostRowViewModel {
    constructor({ baseRoute }) {
        this.baseRoute = baseRoute;
        this.state = ko.observable();
        this.hostname = ko.observable();
        this.drives = ko.observable();
        this.ip = ko.observable();
        this.services = ko.observable();
        this.capacity = ko.observable();
        this.dataActivity = ko.observable();
    }

    onHost(host) {
        const { name, ip, services, activities } = host;
        const uri = realizeUri(this.baseRoute, { host: name });
        const servicesState = mapValues(services, service => service.enabled);
        const hostname = {
            text: getHostDisplayName(name),
            href: uri
        };

        const [ firstActivity = { } ] = activities;
        const dataActivity = {
            text: getActivityName(firstActivity.kind) || 'No Activity',
            tooltip: getActivityListTooltip(activities)
        };

        this.state(getHostStateIcon(host));
        this.hostname(hostname);
        this.ip(ip);
        this.drives(_getStorageNodesSummary(services.storage));
        this.services(servicesState);
        this.capacity(getNodeOrHostCapacityBarValues(host));
        this.dataActivity(dataActivity);
    }
}
