import ko from 'knockout';
import { deepFreeze, formatSize } from 'utils';
import { deletePool } from 'actions';

const cannotDeleteReasons = Object.freeze({
    IN_USE: 'Cannot delete a resource which is used in a bucket backup policy'
});

const icons = deepFreeze([
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

export default class CloudResourceRowViewModel {
    constructor(resource) {
        this.isVisible = ko.pureComputed(
            () => !!resource()
        );

        this.typeIcon = ko.pureComputed(
            () => {
                if (!resource()) {
                    return;
                }

                let endpoint = resource().cloud_info.endpoint.toLowerCase();
                let { icon } = icons.find(
                    ({ pattern }) => endpoint.indexOf(pattern) > -1
                );

                return icon;
            }
        );

        this.name = ko.pureComputed(
            () => resource() && resource().name
        );

        this.usage = ko.pureComputed(
            () => resource() && formatSize(resource().storage.used)
        );

        this.cloudBucket = ko.pureComputed(
            () => resource() && resource().cloud_info.target_bucket
        );

        this.canBeDeleted = ko.pureComputed(
            () => resource() && !resource().undeletable
        );

        this.deleteToolTip = ko.pureComputed(
            () => resource() && (
                this.canBeDeleted() ?
                    'delete resource' :
                    cannotDeleteReasons[resource().undeletable]
            )
        );
    }

    del() {
        deletePool(this.name());
    }
}
