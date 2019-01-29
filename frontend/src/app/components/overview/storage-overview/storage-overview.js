/* Copyright (C) 2016 NooBaa */

import template from './storage-overview.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { toBytes, formatSize, unitsInBytes, fromBigInteger, toBigInteger } from 'utils/size-utils';
import { aggregateStorage } from 'utils/storage-utils';
import numeral from 'numeral';

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

class StorageOverviewViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
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
            color: 'rgb(var(--color6))',
            tooltip: 'The raw storage used in the system'
        },
        {
            label: 'Reserved & Unavailable',
            value: ko.observable(),
            color: 'rgb(var(--color30))',
            tooltip: 'All offline resources or unusable storage such as OS usage and reserved capacity'
        },
        {
            label: 'Available',
            value: ko.observable(),
            color: 'rgb(var(--color18))',
            tooltip: 'The total free space for upload prior to data resiliency considerations'
        }
    ];

    selectState(state) {
        const { buckets, hostPools, cloudResources, system = {} } = state;
        const { internalStorage } = system;

        return [
            buckets,
            hostPools,
            cloudResources,
            internalStorage
        ];
    }

    mapStateToProps(
        buckets,
        hostPools,
        cloudResources,
        internalStorage
    ) {
        if (!buckets || !hostPools || !cloudResources || !internalStorage) {
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
                ]
            });
        }
    }
}

export default {
    viewModel: StorageOverviewViewModel,
    template: template
};
