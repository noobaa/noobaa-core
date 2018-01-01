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
        this.services(servicesState);
        this.capacity(getNodeOrHostCapacityBarValues(host));
        this.dataActivity(dataActivity);
    }
}
