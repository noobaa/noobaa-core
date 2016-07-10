import template from './node-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import { formatSize, bitsToNumber } from 'utils';
import style from 'style';

const accessibilityMapping = Object.freeze({
    0: { text: 'No Access', icon: 'node-no-access' },
    1: { text: 'Read Only', icon: 'node-read-only-access' },
    3: { text: 'Read & Write', icon: 'node-full-access' }
});

const activityLabelMapping = Object.freeze({
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

        this.stateText = ko.pureComputed(
            () => node().online ? 'Online' : 'Offline'
        );

        this.stateIcon = ko.pureComputed(
            () => `node-${node().online ? 'online' : 'offline'}`
        );

        this.trustText = ko.pureComputed(
            () => node().trusted ? 'Trusted' : 'Untrusted'
        );

        this.trustIcon = ko.pureComputed(
            () => node().trusted ? 'trusted' : 'untrusted'
        );

        this.accessibility = ko.pureComputed(
            () => node() && accessibilityMapping[
                    bitsToNumber(node().readable, node().writable)
                ]
        );

        this.accessibilityText = ko.pureComputed(
            () => this.accessibility() && this.accessibility().text
        );

        this.accessibilityIcon = ko.pureComputed(
            () => this.accessibility() && this.accessibility().icon
        );

        this.dataActivity = ko.pureComputed(
            () => node().data_activity && mapActivity(node().data_activity)
        );

        this.total = ko.pureComputed(
            () => node().storage.total
        );

        this.totalText = ko.pureComputed(
            () => formatSize(this.total())
        );

        this.used = ko.pureComputed(
            () => node().storage.used
        );

        this.usedText = ko.pureComputed(
            () => formatSize(this.used())
        );

        this.free = ko.pureComputed(
            () => node().storage.free
        );

        this.freeText = ko.pureComputed(
            () => formatSize(this.free())
        );

        this.other = ko.pureComputed(
            () => this.total() - (this.used() + this.free())
        );

        this.otherText = ko.pureComputed(
            () => formatSize(this.other())
        );

        this.gaugeValues = [
            { value: this.used, color: style['text-color6'], emphasize: true },
            { value: this.other, color: style['text-color2'] , emphasize: true },
            { value: this.free, color: style['text-color5'] ,emphasize: false }
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
