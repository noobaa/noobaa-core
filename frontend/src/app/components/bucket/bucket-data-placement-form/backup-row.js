import ko from 'knockout';
import { deepFreeze } from 'utils';

const iconMapping = deepFreeze([
    {
        pattern: 's3.amazonaws.com',
        icon: 'amazon-resource'
    },
    {
        pattern: 'storage.googleapis.com',
        icon: 'google-resource'
    },
    {
        pattern: '',
        icon: 'cloud-resource'
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
                return iconMapping
                    .find(
                        ({ pattern }) => endpoint.indexOf(pattern) !== -1
                    )
                    .icon;
            }
        );

        this.resourceName = ko.pureComputed(
            () => resource() ? resource().name : ''
        );
    }
}
