/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze } from 'utils/core-utils';
import { getNodeStateIcon, getNodeCapacityBarValues } from 'utils/ui-utils';

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

        this.capacity = ko.pureComputed(
            () => getNodeCapacityBarValues(node() || {})
        );

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
