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
        text: 'Not Highly Available',
        icon:  {
            name: 'problem',
            css: 'disabled'
        },
        tooltip: 'Not enough servers connected to the cluster for high availability'
    },
    ENABLED: {
        text: 'Highly Available',
        icon: {
            name: 'healthy',
            css: 'success'
        },
        tooltip: ''
    },
    DISABLED: {
        text: 'Not Highly Available',
        icon:  {
            name: 'problem',
            css: 'error'
        },
        tooltip: 'Too many servers disconnected from the cluster'
    }
});

const alertStatusMapping = deepFreeze({
    HAS_CRIT_ALERTS: {
        name: 'problem',
        css: 'error'
    },
    NO_CRIT_ALERTS: {
        name: 'healthy',
        css: 'success'
    }
});

const storageTooltip = `An estimated aggregation of all nodes' and cloud resources' raw
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

        this.clusterHATooltip = ko.pureComputed(
            () => highAvailabiltyMapping[clusterHAMode()].tooltip
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
        const { crit: count } = alerts.unreadCounts;
        this.unreadAlertsMessage(stringifyAmount('unread critical alert', count, 'No'));
        this.alertStatusIcon(alertStatusMapping[count ? 'HAS_CRIT_ALERTS' : 'NO_CRIT_ALERTS']);
    }
}

export default {
    viewModel: SystemHealthViewModel,
    template: template
};
