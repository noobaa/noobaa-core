import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';

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

export default class PlacementRowViewModel {
    constructor(pool) {
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

                let tooltip = {
                    text: state ? 'Healthy' : 'Not enough healthy nodes',
                    align: 'start'
                };

                return {
                    css: state ? 'success' : 'error',
                    name: state ? 'healthy' : 'problem',
                    tooltip: tooltip
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

        this.resourceName = ko.pureComputed(
            () => {
                if (!pool()) {
                    return {};
                }

                const text = pool().name;
                if (pool().nodes) {
                    const href = {
                        route: 'pool',
                        params: { pool: text, tab: null }
                    };

                    return { text, href };

                } else {
                    return { text };
                }
            }
        );

        this.onlineNodeCount = ko.pureComputed(
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
