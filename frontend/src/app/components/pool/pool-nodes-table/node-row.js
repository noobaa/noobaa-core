import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze } from 'utils/core-utils';

const nodeStateMapping = deepFreeze({
    offline: {
        css: 'error',
        name: 'problem',
        tooltip: 'Offline'
    },
    migrating: {
        css: 'warning',
        name: 'working',
        tooltip: 'Migrating'
    },
    deactivating: {
        css: 'warning',
        name: 'working',
        tooltip: 'Deactivating'
    },
    deactivated: {
        css: 'warning',
        name: 'problem',
        tooltip: 'Deactivated'
    },
    online: {
        css: 'success',
        name: 'healthy',
        tooltip: 'Online'
    }
});

const activityNameMapping = deepFreeze({
    RESTORING: 'Restoring',
    MIGRATING: 'Migrating',
    DECOMMISSIONING: 'Deactivating',
    DELETING: 'Deleting'
});

const activityStageMapping = deepFreeze({
    OFFLINE_GRACE: 'Waiting',
    REBUILDING: 'Rebuilding',
    WIPING: 'Wiping Data'
});

export default class NodeRowViewModel extends BaseViewModel {
    constructor(node) {
        super();

        this.state = ko.pureComputed(
            () => {
                const naked = node();
                if (!naked) {
                    return '';
                }

                if (!naked.online) {
                    return nodeStateMapping.offline;

                } else if (naked.migrating_to_pool) {
                    return nodeStateMapping.migrating;

                } else if (naked.decommissioning) {
                    return nodeStateMapping.deactivating;

                } else if (naked.decommissioned) {
                    return nodeStateMapping.deactivated;

                } else {
                    return nodeStateMapping.online;
                }
            }
        );

        this.name = ko.pureComputed(
            () => {
                if (!node()) {
                    return '';
                }

                const { name } = node();
                return {
                    text: name,
                    href: { route: 'node', params: { node: name, tab: null } }
                };
            }
        );

        this.ip = ko.pureComputed(
            () => node() ? node().ip : ''
        );

        const storage = ko.pureComputed(
            () => node() ? node().storage : {}
        );

        this.capacity = {
            total: ko.pureComputed(
                () => storage().total
            ),
            used: [
                {
                    label: 'Used (Noobaa)',
                    value: ko.pureComputed(
                        () => storage().used
                    )
                },
                {
                    label: 'Used (other)',
                    value: ko.pureComputed(
                        () => storage().used_other
                    )
                }
            ]
        };

        this.trustLevel = ko.pureComputed(
            () => node() ?
                (node().trusted ? 'Trusted' : 'Untrusted') :
                ''
        );

        this.dataActivity = ko.pureComputed(
            () => {
                if (!node() || !node().data_activity) {
                    return 'No activity';
                }

                const { reason, stage, progress } = node().data_activity;
                return `${
                    activityNameMapping[reason]
                } ${
                    numeral(progress).format('0%')
                } | ${
                    activityStageMapping[stage.name]
                }`;
            }
        );
    }
}
