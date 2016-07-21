import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze } from 'utils';

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
            () => pool() && icons.find(
                ({ pattern }) => pool().cloud_info.endpoint.indexOf(pattern) > -1
            )
        );

        this.name = ko.pureComputed(
            () => pool() && pool().name
        );
    }
}
