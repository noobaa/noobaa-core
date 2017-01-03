import template from './node-summary.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import moment from 'moment';
import { deepFreeze } from 'utils/core-utils';
import { formatSize, toBytes } from 'utils/size-utils';
import style from 'style';

const stateMapping = deepFreeze({
    online: {
        text: 'Online',
        css: 'success',
        icon: 'healthy'
    },
    migrating: {
        text: 'Migrating',
        css: 'warning',
        icon: 'working'
    },
    deactivating: {
        text: 'Deactivating',
        css: 'warning',
        icon: 'working'
    },
    deactivated: {
        text: 'Deactivated',
        css: 'warning',
        icon: 'problem'
    },
    offline: {
        text: 'Offline',
        css: 'error',
        icon: 'problem'
    }
});

const trustMapping = deepFreeze({
    trusted: {
        text: 'Trusted',
        css: 'success',
        icon: 'healthy'
    },
    untrested: {
        text: 'Untrusted',
        css: 'error',
        icon: 'problem'
    }
});

const accessibilityMapping = deepFreeze({
    online: {
        text: 'Readable & Writable',
        css: 'success',
        icon: 'healthy'
    },
    migrating: {
        text: 'Read Only - Migrating data',
        css: 'warning',
        icon: 'problem'
    },
    deactivating: {
        text: 'Read Only',
        css: 'error',
        icon: 'problem'
    },
    deactivated: {
        text: 'No Access',
        css: 'error',
        icon: 'problem'
    },
    untrested: {
        text: 'No Access',
        css: 'error',
        icon: 'problem'
    },
    offline: {
        text: 'No Access',
        css: 'error',
        icon: 'problem'
    }
});

const activityNameMapping = deepFreeze({
    RESTORING: 'Restoring Node',
    MIGRATING: 'Migrating Node',
    DECOMMISSIONING: 'Deactivating Node',
    DELETING: 'Deleting Node'
});

class NodeSummaryViewModel extends BaseViewModel {
    constructor({ node }) {

        super();

        this.dataReady = ko.pureComputed(
            () => Boolean(node())
        );

        this.name = ko.pureComputed(
            () => node().name
        );

        this.state = ko.pureComputed(
            () => {
                const naked = node();
                if (!naked.online) {
                    return stateMapping.offline;

                } else if (naked.migrating_to_pool) {
                    return stateMapping.migrating;

                } else if (naked.decommissioning) {
                    return stateMapping.deactivating;

                } else if (naked.decommissioned) {
                    return stateMapping.deactivated;

                } else {
                    return stateMapping.online;
                }
            }
        );

        this.trust = ko.pureComputed(
            () => node().trusted ? trustMapping.trusted : trustMapping.untrested
        );

        this.accessibility = ko.pureComputed(
            () => {
                const naked = node();
                if (!naked.online) {
                    return accessibilityMapping.offline;

                } else if (!naked.trusted) {
                    return accessibilityMapping.untrested;

                } else if(naked.migrating_to_pool) {
                    return accessibilityMapping.migrating;

                } else if (naked.decommissioning) {
                    return accessibilityMapping.deactivating;

                } else if (naked.decommissioned) {
                    return accessibilityMapping.deactivated;

                } else {
                    return accessibilityMapping.online;
                }
            }
        );

        const storage = ko.pureComputed(
            () => node().storage
        );

        this.formattedText = ko.pureComputed(
            () => storage().total
        ).extend({
            formatSize: true
        });

        this.pieValues = [
            {
                label: 'Potential free',
                color: style['color5'],
                value: ko.pureComputed(
                    () => toBytes(storage().free)
                )
            },
            {
                label: 'Used (NooBaa)',
                color: style['color13'],
                value: ko.pureComputed(
                    () => toBytes(storage().used)
                )
            },
            {
                label: 'Used (Other)',
                color: style['color14'],
                value: ko.pureComputed(
                    () => toBytes(storage().used_other)
                )

            },
            {
                label: 'Reserved',
                color: style['color7'],
                value: ko.pureComputed(
                    () => toBytes(storage().reserved)
                )
            }
        ];

        const dataActivity = ko.pureComputed(
            () => node().data_activity
        );

        this.hasActivity = ko.pureComputed(
            () => Boolean(dataActivity())
        );

        this.activityTitle = ko.pureComputed(
            () => {
                if (!dataActivity()) {
                    return 'No Activity';
                }

                return activityNameMapping[dataActivity().reason];
            }
        );

        this.activityStageMessage = ko.pureComputed(
            () => {
                if (!dataActivity()) {
                    return 'Node is in optimal condition';
                }

                const { stage } = dataActivity();
                switch (stage.name) {
                    case 'OFFLINE_GRACE':
                        return `Waiting for heartbeat, start restoring ${
                            moment(stage.time.end).fromNow(true)
                        }`;

                    case 'REBUILDING':
                        return `Rebuilding ${
                            formatSize(stage.size.completed)
                        } of ${
                            formatSize(stage.size.total)
                        }`;

                    case 'WIPING':
                        return `Wiping ${
                            formatSize(stage.size.completed)
                        } of ${
                            formatSize(stage.size.total)
                        }`;
                }
            }
        );

        this.activityProgressBarValues = [
            {
                value: ko.pureComputed(
                    () => dataActivity() ? dataActivity().progress : 0
                ),
                color: style['color8']
            },
            {
                value: ko.pureComputed(
                    () => dataActivity() ? 1 - dataActivity().progress : 1
                ),
                color: style['color15']
            }
        ];

        this.activityETA = ko.pureComputed(
            () => {
                if (!dataActivity() || !dataActivity().time.end) {
                    return 'calculating...';
                }

                return moment(dataActivity().time.end).fromNow();
            }
        );

        this.isTestModalVisible = ko.observable(false);
    }
}

export default {
    viewModel: NodeSummaryViewModel,
    template: template
};
