/* Copyright (C) 2016 NooBaa */

import template from './system-health.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import style from 'style';
import { openAlertsDrawer } from 'action-creators';
import { aggregateStorage } from 'utils/storage-utils';
import { toBytes, formatSize, fromBigInteger, toBigInteger, unitsInBytes } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getClusterStateIcon, getClsuterHAState } from 'utils/cluster-utils';
import numeral from 'numeral';
import * as routes from 'routes';

function _isInternalSotrageUsed(internalStorage, buckets) {
    if (internalStorage.used > 0) {
        return true;
    }

    if (Object.values(buckets).some(bucket =>
        bucket.placement.tiers[0].policyType === 'INTERNAL_STORAGE'
    )) {
        return true;
    }

    return false;
}

function _getSystemStorageIcon(total = 0, free = 0) {
    const totalBytes = toBytes(total);
    const freeBytes = toBytes(free);
    const ratio = freeBytes / totalBytes;

    if (totalBytes === 0) {
        return {
            name: 'problem',
            css: 'disabled',
            tooltip: 'No system storage - add nodes or cloud resources'
        };

    } else if (freeBytes < unitsInBytes.MB) {
        return {
            name: 'problem',
            css: 'error',
            tooltip: 'No free storage left'
        };

    } else {
        const percentage = ratio < .01 ?
            'Lower than 1%' :
            numeral(ratio).format('%');

        return {
            name: ratio <= .2 ? 'problem' : 'healthy',
            css: ratio <= .2 ? 'warning' : 'success',
            tooltip: `${percentage} free storage left`
        };
    }
}

function _getAlertsIcon(unreadCounters) {
    if (unreadCounters.crit) {
        return {
            name: 'problem',
            css: 'error'
        };
    } else {
        return {
            name: 'healthy',
            css: 'success'
        };
    }

}

function _getAlertsTooltip(unreadCounters) {
    const { crit, major, info } = unreadCounters;
    return {
        template: 'listWithCaption',
        text: {
            title: 'Uread alerts',
            list: [
                `${crit} Critical`,
                `${major} Important`,
                `${info} Minor`
            ]
        }
    };

}

function _getServerCount(servers) {
    return servers ?
        `Contains ${stringifyAmount('server', Object.keys(servers).length)}` :
        '';
}

class SystemHealthViewModel extends ConnectableViewModel {
    dataReady = ko.observable();

    // Storage observables.
    storageIcon = ko.observable();
    isIntenralStorageVisible = ko.observable()
    storageTotal = ko.observable();
    storagePools = ko.observable();
    storageCloud = ko.observable();
    storageInternal = ko.observable();
    storageBarValues = [
        {
            label: 'Used',
            value: ko.observable(),
            color: style['color8'],
            tooltip: 'The raw storage used in the system'
        },
        {
            label: 'Reserved & Unavailable',
            value: ko.observable(),
            color: style['color17'],
            tooltip: 'All offline resources or unusable storage such as OS usage and reserved capacity'
        },
        {
            label: 'Available',
            value: ko.observable(),
            color: style['color15'],
            tooltip: 'The total free space for upload prior to data resiliency considerations'
        }
    ];

    // Cluster observables.
    clusterServerCount = ko.observable();
    clusterIcon = ko.observable();
    clusterHref = ko.observable();
    clusterState = ko.observable();
    clusterHA = ko.observable();

    // Alerts observables.
    alertsIcon = ko.observable();
    alertsTooltip = ko.observable();
    alertsSummary = ko.observable();

    selectState(state) {
        const { location, buckets, hostPools, cloudResources, topology, alerts, system = {} } = state;
        const { internalStorage, version } = system;

        return [
            location,
            buckets,
            hostPools,
            cloudResources,
            internalStorage,
            topology,
            version,
            alerts.unreadCounts
        ];
    }

    mapStateToProps(
        location,
        buckets,
        hostPools,
        cloudResources,
        internalStorage,
        topology,
        systemVersion,
        unreadAlertsCounters
    ) {
        if (!buckets || !hostPools || !cloudResources || !internalStorage || !systemVersion) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const poolsStorage = aggregateStorage(
                ...Object.values(hostPools).map(pool => pool.storage)
            );
            const cloudStorage = aggregateStorage(
                ...Object.values(cloudResources).map(resource => resource.storage)
            );
            const systemStorage = aggregateStorage(poolsStorage, cloudStorage, internalStorage);
            const systemUnavailable = fromBigInteger(
                toBigInteger(systemStorage.unavailableFree || 0).add(systemStorage.reserved || 0)
            );
            const { tooltip: clusterState, ...clusterIcon } = getClusterStateIcon(topology, systemVersion);
            const clusterHA = getClsuterHAState(topology);
            const clusterHref = realizeUri(routes.cluster, { system: location.params.system });
            const alertsSummary = stringifyAmount(
                'unread critical alert',
                unreadAlertsCounters.crit,
                'No'
            );

            ko.assignToProps(this, {
                dataReady: true,
                storageIcon: _getSystemStorageIcon(systemStorage.total, systemStorage.free),
                isIntenralStorageVisible: _isInternalSotrageUsed(internalStorage, buckets),
                storageTotal: formatSize(systemStorage.total || 0),
                storagePools: formatSize(poolsStorage.total || 0),
                storageCloud: formatSize(cloudStorage.total || 0),
                storageInternal: formatSize(internalStorage.total || 0),
                storageBarValues: [
                    { value: toBytes(systemStorage.used) },
                    { value: toBytes(systemUnavailable) },
                    { value: toBytes(systemStorage.free) }
                ],
                clusterServerCount: _getServerCount(topology.servers),
                clusterIcon,
                clusterState,
                clusterHA,
                clusterHref,
                alertsIcon: _getAlertsIcon(unreadAlertsCounters),
                alertsTooltip: _getAlertsTooltip(unreadAlertsCounters),
                alertsSummary
            });
        }
    }

    onViewAlerts() {
        this.dispatch(openAlertsDrawer('CRIT', true));
    }
}

export default {
    viewModel: SystemHealthViewModel,
    template: template
};
