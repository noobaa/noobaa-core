import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze } from 'utils/all';
import { deleteCloudResource } from 'actions';

const undeletableReasons = Object.freeze({
    IN_USE: 'Cannot delete a resource which is used in a bucket cloud storage policy'
});

const serviceIconMapping = deepFreeze({
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

export default class CloudResourceRowViewModel extends Disposable {
    constructor(resource, resourcesToBuckets, deleteGroup) {
        super();

        this.state = {
            name: 'healthy',
            css: 'success',
            tooltip: 'Healthy'
        };

        this.type = ko.pureComputed(
            () => resource() ? serviceIconMapping[resource().cloud_info.endpoint_type] : ''
        );

        this.name = ko.pureComputed(
            () => resource() ? resource().name : ''
        );

        this.buckets = ko.pureComputed(
            () => {
                let buckets = resourcesToBuckets()[this.name()] || [];
                let count = buckets.length;

                return {
                    text: `${count} bucket${count != 1 ? 's' : ''}`,
                    tooltip: count ? buckets : null
                };
            }
        );

        this.usage = ko.pureComputed(
            () => resource() && resource().storage.used
        ).extend({
            formatSize: true
        });

        this.cloudBucket = ko.pureComputed(
            () => resource() ? resource().cloud_info.target_bucket : ''
        );

        let undeletable = ko.pureComputed(
            () => resource() ? resource().undeletable : ''
        );

        this.deleteBtn = {
            subject: 'resrouces',
            group: deleteGroup,
            undeletable: undeletable,
            tooltip: ko.pureComputed(
                () => undeletable() ? undeletableReasons[undeletable()] : 'delete resources'
            ),
            onDelete: () => deleteCloudResource(this.name())
        };
    }
}
