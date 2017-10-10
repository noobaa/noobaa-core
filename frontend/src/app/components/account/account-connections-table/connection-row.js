import ko from 'knockout';
import UsageRowViewModel from './usage-row';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import { stringifyAmount } from 'utils/string-utils';
import { deepFreeze } from 'utils/core-utils';

const emptyMessage = 'Connection is not used by any resource';
const titleMapping = deepFreeze({
    AZURE: 'Azure Containers Under Connection',
    AWS: 'AWS S3 Buckets Under Connection',
    S3_COMPATIBLE: 'S3 Buckets Under Connection'
});

function _getCloudResourceBucketUsage(usage, buckets) {
    return [].concat(...usage
        .filter(item => item.usageType === 'CLOUD_RESOURCE')
        .map(item => buckets.map(bucket => {
            const isBucketUseCloudResource = bucket.placement.resources
                .filter(resource => resource.type ===  'CLOUD')
                .some(resource => resource.name === item.entity);

            if (isBucketUseCloudResource) {
                return {
                    ...item,
                    entity: bucket.name
                };
            }
        }).filter(Boolean))
    );
}

function _getGatewayResourceBucketUsage(usage, buckets) {
    return [].concat(...usage
        .filter(item => item.usageType === 'NAMESPACE_RESOURCE')
        .map(item => buckets.map(bucket => {
            const isBucketReadFromUseResource = bucket.placement.readFrom
                .some(entity => entity === item.entity);
            const isBucketWriteToUseResource = bucket.placement.readFrom === item.entity;

            if (isBucketReadFromUseResource || isBucketWriteToUseResource) {
                return {
                    ...item,
                    entity: bucket.name
                };
            }
        }).filter(Boolean))
    );
}

export default class ConnectionRowViewModel {
    constructor({ deleteGroup, onDelete }) {
        this.emptyMessage = emptyMessage;
        this.usageColumns = [
            {
                name: 'externalEntity',
                label: ko.observable(),
            },
            {
                name: 'usageType',
                label: 'usage',
            },
            {
                name: 'entity',
                label: 'NooBaa Bucket',
                type: 'newLink'
            }
        ];
        this.service = ko.observable();
        this.name = ko.observable();
        this.endpoint = ko.observable();
        this.identity = ko.observable();
        this.externalTargets = ko.observable();
        this.rows = ko.observableArray();

        this.deleteButton = {
            subject: 'connection',
            id: ko.observable(),
            group: deleteGroup,
            onDelete: onDelete,
            disabled: ko.observable(),
            tooltip: ko.observable()
        };
    }

    onConnection(connection, buckets, gatewayBuckets, system) {
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

        const cloudResourceUsage = _getCloudResourceBucketUsage(usage, bucketsList);
        const gatewayUsage = _getGatewayResourceBucketUsage(usage, gatewayBucketsList);
        const connectionUsage = [
            ...usage.filter(item => item.usageType === 'CLOUD_SYNC'),
            ...cloudResourceUsage,
            ...gatewayUsage
        ];
        const rows = connectionUsage.map((item, i) => {
            const row = this.rows.get(i) || new UsageRowViewModel();
            row.onUsage(item, system);
            return row;
        });

        this.usageColumns[0].label(titleMapping[service]);
        this.rows(rows);
        this.name(name);
        this.service(serviceInfo);
        this.endpoint(endpoint);
        this.identity(identity);
        this.externalTargets(externalTargetsInfo);
        this.deleteButton.id(name);
        this.deleteButton.disabled(hasExternalConnections);
        this.deleteButton.tooltip(deleteToolTip);
    }
}
