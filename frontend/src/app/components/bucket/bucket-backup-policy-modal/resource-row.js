import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze } from 'utils';

const icons = deepFreeze([
    {
        pattern: 's3.amazonaws.com',
        name: 'amazon-resource',
        tooltip: 'Amazon Bucket'
    },
    {
        pattern: 'storage.googleapis.com',
        name: 'google-resource',
        tooltip: 'GCloud Bucket'
    },
    {
        pattern: '',
        name: 'cloud-resource',
        tooltip: 'Cloud Bucket'
    }
]);

export default class ResourceRowViewModel extends Disposable {
    constructor(pool, selectedResrouces) {
        super();

        this.select = ko.pureComputed({
            read: () => selectedResrouces().includes(this.name()),
            write: val => val ?
                selectedResrouces.push(this.name()) :
                selectedResrouces.remove(this.name())
        });

        this.type = ko.pureComputed(
            () => pool() && icons
                .find(
                    ({ pattern }) => pool().cloud_info.endpoint.includes(pattern)
                )
        );

        this.name = ko.pureComputed(
            () => pool() && pool().name
        );
    }
}
