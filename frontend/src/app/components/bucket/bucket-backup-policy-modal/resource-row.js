import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze } from 'utils';

const icons = deepFreeze([
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
            () => {
                if (!pool()) {
                    return '';
                }

                let { icon, description } = icons.find(
                    ({ pattern }) => pool().cloud_info.endpoint.includes(pattern)
                );

                return {
                    name: icon,
                    tooltip: description
                };
            }
        );

        this.name = ko.pureComputed(
            () => pool() && pool().name
        );

        this.usage = ko.pureComputed(
            () => pool() && pool().storage.used
        ).extend({
            formatSize: true
        });
    }
}
