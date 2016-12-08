import Disposable from 'disposable';
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

export default class PoolRowViewModel extends Disposable {
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

                return pool().cloud_info ? iconMapping[pool().cloud_info.endpoint_type] : iconMapping['NODE'];
            }
        );

        this.name = ko.pureComputed(
            () => pool() ? pool().name : ''
        );

        this.onlineNodes = ko.pureComputed(
            () => pool() && pool().nodes ?
                `${pool().nodes.online} of ${pool().nodes.count}` :
                '—'
        );

        this.capacityUsage = ko.pureComputed(
            () => pool() && pool().nodes ?
                pool().storage :
                `${formatSize(pool().storage.used)}`
        );
    }
}
