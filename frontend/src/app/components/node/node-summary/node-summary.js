import template from './node-summary.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import moment from 'moment';
import { deepFreeze, formatSize, bitsToNumber } from 'utils/all';
import style from 'style';

const stateMapping = deepFreeze({
    online: {
        text: 'Online',
        css: 'success',
        icon: 'healthy'
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
    true: {
        text: 'Trusted',
        css: 'success',
        icon: 'healthy'
    },
    false: {
        text: 'Untrusted',
        css: 'error',
        icon: 'problem'
    }
});

const accessibilityMapping = deepFreeze({
    0: {
        text: 'No Access',
        css: 'error',
        icon: 'problem'
    },
    2: {
        text: 'Read Only',
        css: 'warning',
        icon: 'problem'
    },
    3: {
        text: 'Readable & Writable',
        css: 'success',
        icon: 'healthy'
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
            () => !!node()
        );

        this.name = ko.pureComputed(
            () => node().name
        );

        this.state = ko.pureComputed(
            () => {
                if (!node().online) {
                    return stateMapping.offline;

                } else if (node().decommissioning || node().decommissioned) {
                    return stateMapping.deactivated;

                } else {
                    return stateMapping.online;
                }
            }
        );

        this.trust = ko.pureComputed(
            () => trustMapping[node().trusted]
        );

        this.accessibility = ko.pureComputed(
            () => {
                let index = bitsToNumber(node().readable, node().writable);
                return accessibilityMapping[index];
            }
        );

        let storage = ko.pureComputed(
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
                    () => storage().free
                )
            },
            {
                label: 'Used (NooBaa)',
                color: style['color13'],
                value: ko.pureComputed(
                    () => storage().used
                )
            },
            {
                label: 'Used (Other)',
                color: style['color14'],
                value: ko.pureComputed(
                    () => storage().used_other
                )

            },
            {
                label: 'Reserved',
                color: style['color7'],
                value: ko.pureComputed(
                    () => storage().reserved
                )
            }
        ];

        let dataActivity = ko.pureComputed(
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

                let { stage } = dataActivity();
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
