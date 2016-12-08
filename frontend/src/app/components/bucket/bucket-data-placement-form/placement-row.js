import ko from 'knockout';
import { formatSize, deepFreeze } from 'utils/all';

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

    NODE: {
        name: 'logo',
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

                return pool().cloud_info ? iconMapping[pool().cloud_info.endpoint_type] : iconMapping['NODE'];
            }
        );

        this.resourceName = ko.pureComputed(
            () => {
                if (!pool()) {
                    return {};
                }

                let { name } = pool();
                let href = {
                    route: 'pool',
                    params: { pool: name, tab: null }
                };

                return {
                    text: name,
                    href: pool().nodes ? href : null
                };
            }
        );

        this.onlineNodeCount = ko.pureComputed(
            () => pool() && pool().nodes ?
                `${pool().nodes.online} of ${pool().nodes.count}` :
                '—'
        );

        this.usedCapacity = ko.pureComputed(
            () => pool() && pool().nodes ?
                pool().storage :
                `${formatSize(pool().storage.used)}`
        );
    }
}
