import ko from 'knockout';
import { deepFreeze } from 'utils';

const iconMapping = deepFreeze([
    {
        pattern: 's3.amazonaws.com',
        icon: 'amazon-resource',
        description: 'AWS S3 Bucket'
    },
    {
        pattern: 'storage.googleapis.com',
        icon: 'google-resource',
        description: 'GCloud Bucket'
    },
    {
        pattern: '',
        icon: 'cloud-resource',
        description: 'AWS Compatible Cloud Bukcet'
    }
]);

export default class BackupRowViewModel {
    constructor(resource) {
        this.resourceType = ko.pureComputed(
            () => {
                if (!resource()) {
                    '';
                }

                let endpoint = resource().cloud_info.endpoint;
                let { icon, description } = iconMapping.find(
                    ({ pattern }) => endpoint.indexOf(pattern) !== -1
                );

                return {
                    name: icon,
                    tooltip: description
                };
            }
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
