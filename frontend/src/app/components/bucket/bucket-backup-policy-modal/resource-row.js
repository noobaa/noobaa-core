import Disposable from 'disposable';
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

export default class ResourceRowViewModel extends Disposable {
    constructor(resource, selectedResrouces) {
        super();

        this.select = ko.pureComputed({
            read: () => selectedResrouces().includes(this.name()),
            write: val => val ?
                selectedResrouces.push(this.name()) :
                selectedResrouces.remove(this.name())
        });

        this.type = ko.pureComputed(
            () => resource() ? iconMapping[resource().cloud_info.endpoint_type] : ''
        );

        this.name = ko.pureComputed(
            () => resource() ? resource().name : ''
        );

        this.usage = ko.pureComputed(
            () => resource() ? resource().storage.used : ''
        ).extend({
            formatSize: true
        });
    }
}
