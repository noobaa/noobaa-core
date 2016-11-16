import ko from 'knockout';

export default class PlacementRowViewModel {
    constructor(pool) {
        this.state = ko.pureComputed(
            () => {
                if (!pool()) {
                    return;
                }

                let { count, has_issues } = pool().nodes;
                let isHealthy = count - has_issues >= 3;
                let tooltip = {
                    text: isHealthy ? 'Healthy' : 'Not enough healthy nodes',
                    align: 'start'
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
            () => pool() && pool().nodes.online
        ).extend({
            formatNumber: true
        });

        this.freeSpace = ko.pureComputed(
            () => pool() && pool().storage.free
        ).extend({
            formatSize: true
        });
    }
}
