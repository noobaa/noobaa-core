import ko from 'knockout';
import { formatSize } from 'utils';
import { deletePool } from 'actions';

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
                return endpoint.indexOf('s3.amazonaws.com') > 0 ?
                    'amazon-bucket' :
                    'cloud-bucket';
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
    }

    del() {
        deletePool(this.name());
    }
}
