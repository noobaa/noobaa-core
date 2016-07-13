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
    constructor(pool, tier) {
        super();

        this.selected = ko.observable(
            tier.cloud_pools.indexOf(pool.name) > -1
        );

        let endpoint = pool.cloud_info.endpoint;
        this.icon = icons
            .find(
                ({ pattern }) => endpoint.indexOf(pattern) > -1
            )
            .icon;

        this.name = pool.name;
    }
}
