import ko from 'knockout';
import { deepFreeze } from 'utils';

const iconMapping = deepFreeze({
    AWS: {
        name: 'aws-s3-resource',
        tooltip: 'AWS S3 Bucket'
    },

    AZURE: {
        name: 'azure-resource',
        tooltip: 'Azure Container'
    },

    S3_COMPATIBLE: {
        name: 'cloud-resource',
        tooltip: 'S3 Compatible Cloud Bukcet'
    }
});

export default class BackupRowViewModel {
    constructor(resource) {
        this.resourceType = ko.pureComputed(
            () => resource() ? iconMapping[resource().cloud_info.endpoint_type] : ''
        );

        this.resourceName = ko.pureComputed(
            () => resource() ? resource().name : ''
        );

        this.usage = ko.pureComputed(
            () => resource() && resource().storage.used
        ).extend({
            formatSize: true
        });
    }
}
