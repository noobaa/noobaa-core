import template from './cluster-overview.html';
import Disposable from 'disposable';
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
    true: {
        text: 'High Availability: On',
        icon: {
            name: 'healthy',
            css: 'success'
        }
    },

    false: {
        text: 'High Availability: Off',
        icon:  {
            name: 'problem',
            css: 'error'
        }
    }
});

class ClusterOverviewViewModel extends Disposable{
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

        this.serverCountText = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return 0;
                }

                const count = systemInfo().cluster.shards[0].servers.length;
                return stringifyAmount('Server', count);
            }
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

        this.highAvailabilityText = ko.pureComputed(
            () => highAvailabiltyMapping[isHighlyAvailable()].text
        );

        this.highAvailabilityIcon = ko.pureComputed(
            () => highAvailabiltyMapping[isHighlyAvailable()].icon
        );
    }
}

export default {
    viewModel: ClusterOverviewViewModel,
    template: template
};
