/* Copyright (C) 2016 NooBaa */

import template from './node-summary.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import moment from 'moment';
import { deepFreeze } from 'utils/core-utils';
import { formatSize, toBytes } from 'utils/size-utils';
import style from 'style';
import { nodeInfo } from 'model';

const stateMapping = deepFreeze({
    OFFLINE: {
        icon: 'problem',
        css: 'error',
        text: 'Offline'
    },
    UNTRUSTED: {
        icon: 'healthy',
        css: 'success',
        text: 'Online'
    },
    INITALIZING: {
        icon: 'working',
        css: 'warning',
        text: 'Initializing'
    },
    DELETING: {
        icon: 'working',
        css: 'warning',
        text: 'Deleting'
    },
    DELETED: {
        icon: 'problem',
        css: 'error',
        text: 'Deleted'
    },
    DECOMMISSIONING: {
        icon: 'working',
        css: 'warning',
        text: 'Deactivating'
    },
    DECOMMISSIONED: {
        icon: 'problem',
        css: 'warning',
        text: 'Deactivated'
    },
    MIGRATING: {
        icon: 'working',
        css: 'warning',
        text: 'Migrating'
    },
    N2N_ERRORS: {
        icon: 'healthy',
        css: 'success',
        text: 'Online'
    },
    GATEWAY_ERRORS: {
        icon: 'healthy',
        css: 'success',
        text: 'Online'
    },
    IO_ERRORS: {
        icon: 'healthy',
        css: 'success',
        text: 'Online'
    },
    STORAGE_NOT_EXIST: {
        icon: 'problem',
        css: 'error',
        text: 'Unmounted'
    },
    LOW_CAPACITY: {
        icon: 'problem',
        css: 'warning',
        text: 'Available capacity is low'
    },
    NO_CAPACITY: {
        icon: 'problem',
        css: 'warning',
        text: 'No available capacity'
    },
    OPTIMAL: {
        icon: 'healthy',
        css: 'success',
        text: 'Online'
    }
});

const trustMapping = deepFreeze({
    TRUSTED: {
        text: 'Trusted',
        css: 'success',
        icon: 'healthy'
    },
    UNTRUSTED: {
        text: 'Untrusted',
        css: 'error',
        icon: 'problem'
    }
});

const accessibilityMapping = deepFreeze({
    OFFLINE: {
        icon: 'problem',
        css: 'error',
        access: 'No access',
        reason: ''
    },
    UNTRUSTED: {
        icon: 'problem',
        css: 'error',
        access: 'No access',
        reason: ''
    },
    INITALIZING: {
        icon: 'problem',
        css: 'error',
        access: 'No access',
        reason: ''
    },
    DELETING: {
        icon: 'problem',
        css: 'warning',
        access: 'Read Only:',
        reason: 'Moving data'
    },
    DELETED: {
        icon: 'problem',
        css: 'error',
        access: 'No access',
        reason: ''
    },
    DECOMMISSIONING: {
        icon: 'problem',
        css: 'warning',
        access: 'Read only:',
        reason: 'Moving data'
    },
    DECOMMISSIONED: {
        icon: 'problem',
        css: 'error',
        access: 'No access',
        reason: ''
    },
    MIGRATING: {
        icon: 'problem',
        css: 'warning',
        access: 'Read only:',
        reason: 'Moving data'
    },
    N2N_ERRORS: {
        icon: 'problem',
        css: 'error',
        access: 'No access:',
        reason: 'Inter-Node connectivity problems'
    },
    GATEWAY_ERRORS: {
        icon: 'problem',
        css: 'error',
        access: 'No access:',
        reason: 'Server connectivity problems'
    },
    IO_ERRORS: {
        icon: 'problem',
        css: 'error',
        access: 'No Access:',
        reason: 'Read/Write problems'
    },
    STORAGE_NOT_EXIST: {
        icon: 'problem',
        css: 'error',
        access: 'No Access:',
        reason: 'Unmounted'
    },
    LOW_CAPACITY: {
        icon: 'healthy',
        css: 'success',
        access: 'Readable & Writable',
        reason: ''
    },
    NO_CAPACITY: {
        icon: 'healthy',
        css: 'success',
        access: 'Readable & Writable',
        reason: ''
    },
    OPTIMAL: {
        icon: 'healthy',
        css: 'success',
        access: 'Readable & Writable',
        reason: ''
    }
});

const activityNameMapping = deepFreeze({
    RESTORING: 'Restoring Node',
    MIGRATING: 'Migrating Node',
    DECOMMISSIONING: 'Deactivating Node',
    DELETING: 'Deleting Node'
});

const trustTooltip = `A reliability check that verifies that this node has no disk
    corruption or malicious activity`;

class NodeSummaryViewModel extends BaseViewModel {
    constructor() {
        super();

        const node = nodeInfo;

        this.dataReady = ko.pureComputed(
            () => Boolean(node())
        );

        this.name = ko.pureComputed(
            () => node().name
        );

        this.state = ko.pureComputed(
            () => stateMapping[node().mode]
        );

        this.trust = ko.pureComputed(
            () => trustMapping[node().trusted ? 'TRUSTED' : 'UNTRUSTED']
        );

        this.trustTooltip = trustTooltip;

        this.accessibility = ko.pureComputed(
            () => accessibilityMapping[node().mode]
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
                    const { online, decommissioned, trusted } = node();
                    if (!online) {
                        return 'Node offline';

                    } else if (decommissioned) {
                        return 'Node deactivated';

                    } else if(!trusted) {
                        return 'Untrusted node';

                    } else {
                        return 'Node is in optimal condition';
                    }
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
