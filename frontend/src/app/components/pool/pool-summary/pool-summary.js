import template from './pool-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import style from 'style';
import { deepFreeze, formatSize } from 'utils';

const stateMapping = deepFreeze({
    true: {
        text: 'Healthy',
        css: 'success',
        icon: 'healthy'
    },
    false: {
        text: 'Not enough online nodes',
        css: 'error',
        icon: 'problem'
    }
});

const activityLabelMapping = Object.freeze({
    EVACUATING: 'Evacuating',
    REBUILDING: 'Rebuilding',
    MIGRATING: 'Migrating'
});

function mapActivity({ reason, node_count, completed_size, total_size, eta }) {
    return {
        row1: `${
            activityLabelMapping[reason]
        } ${
            node_count
        } nodes | Completed ${
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

class PoolSummaryViewModel extends Disposable {
    constructor({ pool }) {
        super();

        this.dataReady = ko.pureComputed(
            () => !!pool()
        );

        this.state = ko.pureComputed(
            () => stateMapping[pool().nodes.online >= 3]
        );

        this.nodeCount = ko.pureComputed(
            () => numeral(pool().nodes.count).format('0,0')
        );

        this.onlineCount = ko.pureComputed(
            () => numeral().format('0,0')
        );

        this.offlineCount = ko.pureComputed(
            () => numeral(pool().nodes.count - pool().nodes.online).format('0,0')
        );


        let storage = ko.pureComputed(
            () => pool().storage
        );

        this.formattedTotal = ko.pureComputed(
            () => formatSize(storage().total)
        );

        this.pieValues = [
            {
                label: 'Avaliable',
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
            },
            {
                label: 'Unavailable',
                color: style['color15'],
                value: ko.pureComputed(
                    () => storage().unavailable_free
                )
            }
        ];

        this.dataActivities = ko.pureComputed(
            () => pool().data_activities && pool().data_activities.map(mapActivity)
        );
    }
}

export default {
    viewModel: PoolSummaryViewModel,
    template: template
};
