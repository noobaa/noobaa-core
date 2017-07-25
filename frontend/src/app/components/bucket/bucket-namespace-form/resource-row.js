import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';

const iconMapping = deepFreeze({
    AWS: {
        name: 'aws-s3-resource',
        tooltip: 'AWS S3 resource'
    },

    AZURE: {
        name: 'azure-resource',
        tooltip: 'Azure blob resource'
    },

    S3_COMPATIBLE: {
        name: 'cloud-resource',
        tooltip: 'Generic S3 compatible resource'
    },

    NOOBAA: {
        name: 'cloud-resource',
        tooltip: 'Generic S3 compatible resource'
    }
});

export default class ResourceRowViewModel {
    constructor(resource) {
        this.service = ko.pureComputed(
            () => iconMapping[resource().endpoint_type]
        );

        this.target = ko.pureComputed(
            () => resource().target_bucket || ''
        );

        this.endpoint = ko.pureComputed(
            () => resource().endpoint || ''
        );

        this.identity = ko.pureComputed(
            () => resource().access_key || ''
        );
    }
}
