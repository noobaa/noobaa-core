import template from './cluster-overview.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getClusterStatus } from 'utils/cluster-utils';
import { systemInfo } from 'model';

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
            name: 'notif-warning',
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

class ClusterOverviewViewModel extends BaseViewModel {
    constructor() {
        super();

        const status = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return 'UNHEALTHY';
                }

                const { version, cluster } = systemInfo();
                return getClusterStatus(cluster, version);
            }
        );

        const serverCount = ko.pureComputed(
            () => systemInfo() ? systemInfo().cluster.shards[0].servers.length : 0
        );

        this.serverCountText = ko.pureComputed(
            () => stringifyAmount('Server', serverCount())
        );

        this.statusText = ko.pureComputed(
            () => statusMapping[status()].text
        );

        this.statusIcon = ko.pureComputed(
            () => statusMapping[status()].icon
        );

        const isHighlyAvailable = ko.pureComputed(
            () =>  systemInfo() ?
                systemInfo().cluster.shards[0].high_availabilty :
                false
        );

        const ha = ko.pureComputed(
            () => serverCount() >= 3 ?
                (isHighlyAvailable() ? 'ENABLED' : 'DISABLED') :
                'NO_ENOUGH_SERVERS'
        );

        this.highAvailabilityText = ko.pureComputed(
            () => highAvailabiltyMapping[ha()].text
        );

        this.highAvailabilityIcon = ko.pureComputed(
            () => highAvailabiltyMapping[ha()].icon
        );
    }
}

export default {
    viewModel: ClusterOverviewViewModel,
    template: template
};
