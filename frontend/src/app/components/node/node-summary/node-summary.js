import template from './node-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import { deepFreeze, formatSize, bitsToNumber } from 'utils';
import style from 'style';

const stateMapping = deepFreeze({
    true: {
        text: 'Online',
        css: 'success',
        icon: 'healthy'
    },
    false: {
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
        text: 'Readable & Writeable',
        css: 'success',
        icon: 'healthy'
    }
});

const activityLabelMapping = deepFreeze({
    EVACUATING: 'Evacuating',
    REBUILDING: 'Rebuilding',
    MIGRATING: 'Migrating'
});

function mapActivity({ reason, completed_size, total_size, eta }) {
    return {
        row1: `${
            activityLabelMapping[reason]
        } node | Completed ${
            formatSize(completed_size)
        } of ${
            formatSize(total_size)
        }`,

        row2: `(${
            numeral(completed_size / total_size).format('0%')
        } completed, ETA: ${
            moment().to(eta)
        })`
    };
}

class NodeSummaryViewModel extends Disposable {
    constructor({ node }) {

        super();

        this.dataReady = ko.pureComputed(
            () => !!node()
        );

        this.name = ko.pureComputed(
            () => node().name
        );

        this.state = ko.pureComputed(
            () => stateMapping[node().online]
        );

        this.trust = ko.pureComputed(
            () => trustMapping[node().trusted]
        );

        this.accessibility = ko.pureComputed(
            () => {
                let index = bitsToNumber(node().readable, node().writable);
                console.log(index);
                return accessibilityMapping[index];
            }
        );

        this.dataActivity = ko.pureComputed(
            () => node().data_activity && mapActivity(node().data_activity)
        );

        let storage = ko.pureComputed(
            () => node().storage
        );

        this.formattedText = ko.pureComputed(
            () => formatSize(storage().total)
        );

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

        this.rpcAddress = ko.pureComputed(
            () => !!node() && node().rpc_address
        );

        this.isTestModalVisible = ko.observable(false);
    }
}

export default {
    viewModel: NodeSummaryViewModel,
    template: template
};
