import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze } from 'utils/core-utils';
import { getNodeStateIcon } from 'utils/ui-utils';

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
            () => node() ? getNodeStateIcon(node()) : ''
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
                () => storage().total || 0
            ),
            used: [
                {
                    label: 'Used (Noobaa)',
                    value: ko.pureComputed(
                        () => storage().used || 0
                    )
                },
                {
                    label: 'Used (other)',
                    value: ko.pureComputed(
                        () => storage().used_other || 0
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
