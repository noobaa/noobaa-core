import ko from 'knockout';
import { getPoolStateIcon, getResourceTypeIcon } from 'utils/ui-utils';

export default class PlacementRowViewModel {
    constructor(pool) {
        this.state = ko.pureComputed(
            () => pool() ? getPoolStateIcon(pool()) : ''
        );

        this.type = ko.pureComputed(
            () => pool() ? getResourceTypeIcon(pool()) : ''
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
