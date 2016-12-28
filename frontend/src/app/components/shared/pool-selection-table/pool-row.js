import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { deepFreeze } from 'utils/all';

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
    },

    NODES_POOL: {
        name: 'nodes-pool',
        tooltip: 'Node Pool'
    }
});

export default class PoolRowViewModel extends BaseViewModel {
    constructor(pool, selectedPools) {
        super();

        this.select = ko.pureComputed({
            read: () => selectedPools().includes(this.name()),
            write: val => val ?
                selectedPools.push(this.name()) :
                selectedPools.remove(this.name())
        });

        this.state = ko.pureComputed(
            () => {
                if (!pool()) {
                    return;
                }

                let state;
                if (pool().nodes) {
                    let { count, has_issues } = pool().nodes;
                    state = count - has_issues >= 3;
                } else {
                    state = true;
                }

                return {
                    css: state ? 'success' : 'error',
                    name: state ? 'healthy' : 'problem',
                    tooltip: state ? 'healthy' : 'not enough healthy nodes'
                };
            }
        );

        this.type = ko.pureComputed(
            () => {
                if (!pool()) {
                    return;
                }

                const resourceType = pool().cloud_info ?
                    pool().cloud_info.endpoint_type :
                    'NODES_POOL';

                return iconMapping[resourceType];
            }
        );

        this.name = ko.pureComputed(
            () => pool() ? pool().name : ''
        );

        this.onlineNodes = ko.pureComputed(
            () => {
                if (!pool()) {
                    return '';
                }

                return pool().nodes ?
                    `${pool().nodes.online} of ${pool().nodes.count}` :
                    '—';
            }
        );

        this.freeSpace = ko.pureComputed(
            () => pool() && pool().storage.free
        ).extend({
            formatSize: true
        });
    }
}
