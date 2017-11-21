/* Copyright (C) 2016 NooBaa */

import template from './system-health.html';
import Observer from 'observer';
import ko from 'knockout';
import style from 'style';
import { state$, action$ } from 'state';
import { openAlertsDrawer } from 'action-creators';
import { aggregateStorage } from 'utils/storage-utils';
import { toBytes, formatSize, fromBigInteger, toBigInteger, unitsInBytes } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getClusterStateIcon, getClsuterHAState } from 'utils/cluster-utils';
import numeral from 'numeral';
import * as routes from 'routes';

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
        return {
            name: ratio <= .2 ? 'problem' : 'healthy',
            css: ratio <= .2 ? 'warning' : 'success',
            tooltip: {
                text: `${numeral(ratio).format('%')} free storage left`,
                align: 'start'
            }
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

class SystemHealthViewModel extends Observer {
    constructor() {
        super();

        this.dataLoaded = ko.observable();

        // Storage observables.
        this.storageIcon = ko.observable();
        this.storageTotal = ko.observable();
        this.storagePools = ko.observable();
        this.storageCloud = ko.observable();
        this.storageInternal = ko.observable();
        this.storageBarValues = [
            {
                label: 'Used',
                value: ko.observable(),
                color: style['color8']
            },
            {
                label: 'Unavailable',
                value: ko.observable(),
                color: style['color17']
            },
            {
                label: 'Available',
                value: ko.observable(),
                color: style['color15']
            }
        ];

        // Cluster observables.
        this.clusterServerCount = ko.observable();
        this.clusterIcon = ko.observable();
        this.clusterHref = ko.observable();
        this.clusterState = ko.observable();
        this.clusterHA = ko.observable();


        // Alerts observables.
        this.alertsIcon = ko.observable();
        this.alertsTooltip = ko.observable();
        this.alertsSummary = ko.observable();


        this.observe(
            state$.getMany(
                'location',
                'hostPools',
                'cloudResources',
                'internalResources',
                ['topology'],
                ['system', 'version'],
                ['alerts', 'unreadCounts'],
            ),
            this.onState
        );
    }

    onState([
        location,
        hostPools,
        cloudResources,
        internalResources,
        topology,
        systemVersion,
        unreadAlertsCounters
    ]) {
        if (!hostPools || !cloudResources || !internalResources || !systemVersion) {
            this.dataLoaded(false);
            return;
        }

        const poolsStorage = aggregateStorage(
            ...Object.values(hostPools).map(pool => pool.storage)
        );
        const cloudStorage = aggregateStorage(
            ...Object.values(cloudResources).map(resource => resource.storage)
        );
        const internalStorage = aggregateStorage(
            ...Object.values(internalResources).map(resource => resource.storage)
        );
        const systemStorage = aggregateStorage(poolsStorage, cloudStorage, internalStorage);
        const systemUnavailable = fromBigInteger(
            toBigInteger(systemStorage.unavailableFree || 0).add(systemStorage.reserved || 0)
        );
        this.storageIcon(_getSystemStorageIcon(systemStorage.total, systemStorage.free));
        this.storageTotal(formatSize(systemStorage.total || 0));
        this.storagePools(formatSize(poolsStorage.total || 0));
        this.storageCloud(formatSize(cloudStorage.total || 0));
        this.storageInternal(formatSize(internalStorage.total || 0));
        this.storageBarValues[0].value(toBytes(systemStorage.used));
        this.storageBarValues[1].value(toBytes(systemUnavailable));
        this.storageBarValues[2].value(toBytes(systemStorage.free));

        const { servers } = topology;
        const { tooltip: clusterState, ...clsuterIcon } = getClusterStateIcon(topology, systemVersion);
        const clusterHA = getClsuterHAState(topology);
        const serverCount = servers ? `Contains ${stringifyAmount('server', Object.keys(servers).length)}` : '';
        const clusterHref = realizeUri(routes.cluster, { system: location.params.system });
        this.clusterServerCount(serverCount);
        this.clusterIcon(clsuterIcon);
        this.clusterState(clusterState);
        this.clusterHA(clusterHA);
        this.clusterHref(clusterHref);

        const alertSummary = stringifyAmount('unread critical alert', unreadAlertsCounters.crit, 'No');
        this.alertsIcon(_getAlertsIcon(unreadAlertsCounters));
        this.alertsTooltip(_getAlertsTooltip(unreadAlertsCounters));
        this.alertsSummary(alertSummary);

        this.dataLoaded(true);
    }

    onViewAlerts() {
        action$.onNext(openAlertsDrawer('CRIT', true));
    }
}

export default {
    viewModel: SystemHealthViewModel,
    template: template
};
