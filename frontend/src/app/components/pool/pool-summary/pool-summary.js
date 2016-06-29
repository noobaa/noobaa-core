import template from './pool-summary.html';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import style from 'style';
import { formatSize } from 'utils';

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

class PoolSummaryViewModel {
    constructor({ pool }) {
        this.dataReady = ko.pureComputed(
            () => !!pool()
        );

        this.total = ko.pureComputed(
            () => pool().storage.total
        );

        this.totalText = ko.pureComputed(
            () => formatSize(this.total())
        );

        this.used = ko.pureComputed(
            () => pool().storage.used
        );

        this.usedText = ko.pureComputed(
            () => formatSize(this.used())
        );

        this.free = ko.pureComputed(
            () => pool().storage.free
        );

        this.freeText = ko.pureComputed(
            () => formatSize(this.free())
        );

        this.gaugeValues = [
            { value: this.used, color: style['text-color6'], emphasize: true },
            { value: this.free, color: style['text-color4'], emphasize: false }
        ];

        this.stateText = ko.pureComputed(
            () => 'Healthy'
        );

        this.stateIcon = ko.pureComputed(
            () => 'pool'
        );

        this.nodeCount = ko.pureComputed(
            () => pool().nodes.count
        );

        let onlineCount = ko.pureComputed(
            () => pool().nodes.online
        );

        this.onlineIcon = ko.pureComputed(
            () => `node-${onlineCount() > 0 ? 'online' : 'online'}`
        );

        this.onlineText = ko.pureComputed(
            () => `${
                onlineCount() > 0 ?  numeral(onlineCount()).format('0,0') : 'No'
            } Online`
        );

        let offlineCount = ko.pureComputed(
            () => pool().nodes.count - pool().nodes.online
        );

        this.offlineIcon = ko.pureComputed(
            () => `node-${onlineCount() > 0 ? 'offline' : 'offline'}`
        );

        this.offlineText = ko.pureComputed(
            () => `${
                offlineCount() > 0 ?  numeral(offlineCount()).format('0,0') : 'No'
            } Offline`
        );

        this.offlineText = ko.pureComputed(
            () => {
                let count = pool().nodes.count - pool().nodes.online;
                return `${count > 0 ? numeral(count).format('0,0') : 'No'} Offline`;
            }
        );

        this.dataActivities = ko.pureComputed(
            () => pool().data_activities && pool().data_activities.map(mapActivity)
        );
    }
}

export default {
    viewModel: PoolSummaryViewModel,
    template: template
};
