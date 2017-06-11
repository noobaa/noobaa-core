/* Copyright (C) 2016 NooBaa */

import template from './system-health.html';
import Observer from 'observer';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getClusterStatus } from 'utils/cluster-utils';
import { getSystemStorageIcon } from 'utils/ui-utils';
import { systemInfo } from 'model';
import { state$ } from 'state';

const statusMapping = deepFreeze({
    HEALTHY: {
        text: 'Healthy',
        icon: {
            name: 'healthy',
            css: 'success'
        }
    },
    WITH_ISSUES: {
        text: 'Cluster has a high number of issues',
        icon: {
            name: 'problem',
            css: 'warning'
        }
    },
    UNHEALTHY: {
        text: 'Not enough connected servers',
        icon:  {
            name: 'problem',
            css: 'error'
        }
    }
});

const highAvailabiltyMapping = deepFreeze({
    NO_ENOUGH_SERVERS: {
        text: 'High Availability: Not enough servers',
        icon:  {
            name: 'problem',
            css: 'disabled'
        }
    },
    ENABLED: {
        text: 'High Availability: Yes',
        icon: {
            name: 'healthy',
            css: 'success'
        }
    },
    DISABLED: {
        text: 'High Availability: Not enough servers',
        icon:  {
            name: 'problem',
            css: 'error'
        }
    }
});

const alertStatusMapping = deepFreeze({
    HAS_ALERTS: {
        name: 'problem',
        css: 'warning'
    },
    NO_ALERTS: {
        name: 'healthy',
        css: 'success'
    }
});

const storageTooltip = `An estimated aggregation of all nodes, internal storage or cloud resources raw
                        storage that can be used via buckets (Any cloud resource is defined as 1PB of raw storage)`;

class SystemHealthViewModel extends Observer {
    constructor() {
        super();

        const serverCount = ko.pureComputed(
            () => systemInfo() ? systemInfo().cluster.shards[0].servers.length : 0
        );

        this.serverCountText = ko.pureComputed(
            () => stringifyAmount('Server', serverCount())
        );

        const clusterStatus = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return 'UNHEALTHY';
                }

                const { version, cluster } = systemInfo();
                return getClusterStatus(cluster, version);
            }
        );

        this.clusterStatusText = ko.pureComputed(
            () => statusMapping[clusterStatus()].text
        );

        this.clusterStatusIcon = ko.pureComputed(
            () => statusMapping[clusterStatus()].icon
        );

        const clusterHAMode = ko.pureComputed(
            () => {
                const isHighlyAvailable = systemInfo() ?
                    systemInfo().cluster.shards[0].high_availabilty :
                    false;

                return serverCount() >= 3 ?
                    (isHighlyAvailable ? 'ENABLED' : 'DISABLED') :
                    'NO_ENOUGH_SERVERS';
            }
        );

        this.clusterHAText = ko.pureComputed(
            () => highAvailabiltyMapping[clusterHAMode()].text
        );

        this.clusterHAIcon = ko.pureComputed(
            () => highAvailabiltyMapping[clusterHAMode()].icon
        );

        this.storageStatus = ko.pureComputed(
            () => getSystemStorageIcon(
                systemInfo() ? systemInfo().storage : { total: 0, free: 0 }
            )
        );

        this.storageToolTip = storageTooltip;
        this.unreadAlertsMessage = ko.observable('');
        this.alertStatusIcon = ko.observable({});
        this.observe(state$.get('alerts'), this.onAlerts);
    }

    onAlerts(alerts) {
        this.unreadAlertsMessage(stringifyAmount('unread alert', alerts.unreadCount));
        this.alertStatusIcon(alertStatusMapping[alerts.unreadCount ? 'HAS_ALERTS' : 'NO_ALERTS']);
    }
}

export default {
    viewModel: SystemHealthViewModel,
    template: template
};
