/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import UsageRowViewModel from './usage-row';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import { stringifyAmount } from 'utils/string-utils';
import { deepFreeze, ensureArray } from 'utils/core-utils';

const emptyMessage = 'Connection is not used by any resource';

const columns = deepFreeze([
    {
        name: 'externalEntity',
        label: 'Azure Containers Under Connection',
        visibleFor: 'AZURE'
    },
    {
        name: 'externalEntity',
        label: 'AWS S3 Buckets Under Connection',
        visibleFor: 'AWS'
    },
    {
        name: 'externalEntity',
        label: 'Google Buckets Under Connection',
        visibleFor: 'GOOGLE'
    },
    {
        name: 'externalEntity',
        label: 'S3 Buckets Under Connection',
        visibleFor: [
            'S3_V2_COMPATIBLE',
            'S3_V4_COMPATIBLE'
        ]
    },
    {
        name: 'externalEntity',
        label: 'S3 Buckets Under Connection',
        visibleFor: 'FLASHBLADE'
    },
    {
        name: 'externalEntity',
        label: 'NetStorage Folders Under Connection',
        visibleFor: 'NET_STORAGE'
    },
    {
        name: 'usage',
        label: 'usage'
    },
    {
        name: 'noobaaBuckets',
        label: 'NooBaa Buckets',
        type: 'newLink'
    }
]);

export function _isBucketUsingResource(bucket, resource) {
    return bucket.placement.mirrorSets.some(
        mirrorSet => mirrorSet.resources.some(
            another => another.name === resource
        )
    );
}

export function _isNamespaceBucketUsingResource(bucket, resource) {
    const { writeTo, readFrom } = bucket.placement;
    return (writeTo === resource) || readFrom.includes(resource);
}

function _getBucketsRelatedToUsage(usage, buckets, namespaceBuckets) {
    const { usageType, entity } = usage;
    switch (usageType) {
        case 'CLOUD_RESOURCE': {
            return buckets
                .filter(bucket => _isBucketUsingResource(bucket, entity))
                .map(bucket => bucket.name);
        }

        case 'NAMESPACE_RESOURCE': {
            return namespaceBuckets
                .filter(bucket => _isNamespaceBucketUsingResource(bucket, entity))
                .map(bucket => bucket.name);
        }
    }
}

function _getEndpointTooltip(service, endpoint) {
    if (service === 'NET_STORAGE') {
        const [ hostname, cpCode ] = endpoint.split(' at ');
        return `Connection hostname:<br>${hostname}<br><br>CP Code:<br>${cpCode}`;

    } else {
        return endpoint;
    }
}

export default class ConnectionRowViewModel {
    constructor({ onSelectForDelete, onDelete, onExpand }) {
        this.usageColumns = ko.observableArray();
        this.id = '';
        this.expand = onExpand;
        this.emptyMessage = emptyMessage;
        this.service = ko.observable();
        this.name = ko.observable();
        this.endpoint = ko.observable();
        this.identity = ko.observable();
        this.externalTargets = ko.observable();
        this.rows = ko.observableArray();
        this._isExpanded = ko.observable();
        this.isExpanded = ko.pc(this._isExpanded, this.onToggleExpand, this);
        this.deleteButton = {
            text: 'Delete connection',
            id: ko.observable(),
            active: ko.observable(),
            onToggle: onSelectForDelete,
            onDelete: onDelete,
            disabled: ko.observable(),
            tooltip: ko.observable()
        };
    }

    onConnection(
        connection,
        buckets,
        namespaceBuckets,
        system,
        expandedRow,
        selectedForDelete
    ) {
        const { name, service, endpoint, identity, usage } = connection;
        const bucketsList = Object.values(buckets);
        const id = `${name}:${service}`;
        const namespaceBucketsList = Object.values(namespaceBuckets);
        const hasExternalConnections = Boolean(usage.length);
        const { icon, displayName, subject } = getCloudServiceMeta(service);
        const serviceInfo = {
            name: icon,
            tooltip: displayName
        };
        const endpointInfo = {
            text: endpoint,
            tooltip: _getEndpointTooltip(service, endpoint)
        };
        const externalTargets = usage.map(entity => entity.externalEntity);
        const externalTargetsInfo = {
            text: stringifyAmount(subject, usage.length, 'No'),
            tooltip: {
                template: 'list',
                text: externalTargets.length ? externalTargets : null,
                breakWords: true
            }
        };
        const deleteToolTip = hasExternalConnections ?
            'Cannot delete currently used connection' :
            'Delete Connection';

        const connectionUsage = usage.map(item => {
            const buckets = _getBucketsRelatedToUsage(item, bucketsList, namespaceBucketsList);
            return { ...item, buckets };
        });

        const rows = connectionUsage.map((item, i) => {
            const row = this.rows.get(i) || new UsageRowViewModel();
            row.onUsage(item, system);
            return row;
        });
        const usageColumns = columns
            .filter(col => !col.visibleFor || ensureArray(col.visibleFor).includes(service));

        this.usageColumns(usageColumns);
        this.rows(rows);
        this.id = id;
        this.name(name);
        this.service(serviceInfo);
        this.endpoint(endpointInfo);
        this.identity(identity);
        this.externalTargets(externalTargetsInfo);
        this.deleteButton.id(id);
        this.deleteButton.active(selectedForDelete === id);
        this.deleteButton.disabled(hasExternalConnections);
        this.deleteButton.tooltip(deleteToolTip);
        this._isExpanded(expandedRow === id);
    }

    onToggleExpand(val) {
        this.expand(val ? this.id : null);
    }
}
