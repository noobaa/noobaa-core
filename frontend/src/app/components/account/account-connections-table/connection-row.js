import ko from 'knockout';
import UsageRowViewModel from './usage-row';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import { stringifyAmount } from 'utils/string-utils';
import { deepFreeze } from 'utils/core-utils';

const emptyMessage = 'Connection is not used by any resource';

const columns = deepFreeze([
    {
        name: 'externalEntity',
        label: 'Azure Containers Under Connection',
        remark: 'AZURE'

    },
    {
        name: 'externalEntity',
        label: 'AWS S3 Buckets Under Connection',
        remark: 'AWS'
    },
    {
        name: 'externalEntity',
        label: 'S3 Buckets Under Connection',
        remark: 'S3_COMPATIBLE'
    },
    {
        name: 'usageType',
        label: 'usage'
    },
    {
        name: 'noobaaBuckets',
        label: 'NooBaa Bucket',
        type: 'noobaaBuckets'
    }
]);

const resourceToBuckets = deepFreeze({
    CLOUD_SYNC: (resource) => resource,
    CLOUD_RESOURCE: (resource, buckets) =>
        _filterBucketsList(resource, buckets, _filterBucketsUsedByCloudResource),
    NAMESPACE_RESOURCE: (resource, buckets) =>
        _filterBucketsList(resource, buckets, _getBucketsUsedByGatewayResource)
});

function _filterBucketsUsedByCloudResource(cloudResource, bucket) {
    return bucket.placement.resources
        .some(resource => resource.type === 'CLOUD' && resource.name === cloudResource);
}

function _getBucketsUsedByGatewayResource(gatewayResource, bucket) {
    const usedForWriting = bucket.placement.readFrom === gatewayResource;
    const usedForReading = bucket.placement.readFrom
        .some(entity => entity === gatewayResource);

    return usedForReading || usedForWriting;
}

function _filterBucketsList(resource, buckets, filterFunc) {
    return buckets
        .filter(bucket => filterFunc(resource, bucket))
        .map(bucket => bucket.name);
}

export default class ConnectionRowViewModel {
    constructor({ deleteGroup, onDelete, onExpand }) {
        this.usageColumns = ko.observableArray();
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
            subject: 'connection',
            id: ko.observable(),
            group: deleteGroup,
            onDelete: onDelete,
            disabled: ko.observable(),
            tooltip: ko.observable()
        };
    }

    onConnection(connection, buckets, gatewayBuckets, system, isExpanded) {
        const { name, service, endpoint, identity, usage } = connection;
        const bucketsList = Object.values(buckets);
        const gatewayBucketsList = Object.values(gatewayBuckets);
        const hasExternalConnections = Boolean(usage.length);
        const { icon, displayName, subject } = getCloudServiceMeta(service);
        const serviceInfo = {
            name: icon,
            tooltip: displayName
        };
        const externalTargetsInfo = {
            text: stringifyAmount(subject, usage.length, 'No'),
            tooltip: hasExternalConnections ? {
                text: usage.map(entity => entity.externalEntity),
                breakWords: true
            } : ''
        };
        const deleteToolTip = hasExternalConnections ?
            'Cannot delete currently used connection' :
            'Delete Connection';

        const connectionUsage = usage.map(item => ({
            ...item,
            buckets: resourceToBuckets[item.usageType](
                item.entity,
                item.usageType === 'CLOUD_RESOURCE'? bucketsList : gatewayBucketsList
            )
        }));

        const rows = connectionUsage.map((item, i) => {
            const row = this.rows.get(i) || new UsageRowViewModel();
            row.onUsage(item, system);
            return row;
        });
        const usageColumns = columns
            .filter(col => !col.marker || col.marker === service);

        this.usageColumns(usageColumns);
        this.rows(rows);
        this.name(name);
        this.service(serviceInfo);
        this.endpoint(endpoint);
        this.identity(identity);
        this.externalTargets(externalTargetsInfo);
        this.deleteButton.id(name);
        this.deleteButton.disabled(hasExternalConnections);
        this.deleteButton.tooltip(deleteToolTip);
        this._isExpanded(isExpanded);
    }

    onToggleExpand(val) {
        this.expand(val ? this.name() : null);
    }
}
