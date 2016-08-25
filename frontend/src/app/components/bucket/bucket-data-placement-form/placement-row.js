import ko from 'knockout';
import { formatSize } from 'utils';

export default class PlacementRowViewModel {
    constructor(pool) {
        this.state = ko.pureComputed(
            () => {
                if (!pool()) {
                    return;
                }

                let isHealthy = pool().nodes.online >= 3;
                let tooltip = {
                    text: isHealthy ? 'Healthy' : 'Not enough healthy nodes',
                    align: 'left'
                };

                return {
                    css: isHealthy ? 'success' : 'error',
                    name: isHealthy ? 'healthy' : 'problem',
                    tooltip: tooltip
                };
            }
        );

        this.poolName = ko.pureComputed(
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
                    href: href
                };
            }
        );

        this.onlineNodeCount = ko.pureComputed(
            () => pool() ? pool().nodes.online : 'N/A'
        );

        this.freeSpace = ko.pureComputed(
            () => pool() ? formatSize(pool().storage.free) : 'N/A'
        );
    }
}
