import ko from 'knockout';
import numeral from 'numeral';
import { bitsToNumber } from 'utils';

const accessibilityMapping = Object.freeze({
    0: { text: 'No Access', css: 'error' },
    1: { text: 'Read Only', css: 'warning' },
    3: { text: 'Read & Write' }
});

const activityLabelMapping = Object.freeze({
    EVACUATING: 'Evacuating',
    REBUILDING: 'Rebuilding',
    MIGRATING: 'Migrating'
});

export default class NodeRowViewModel {
    constructor(node) {
        this.isVisible = ko.pureComputed(
            () => !!node()
        );

        this.stateToolTip = ko.pureComputed(
            () => node() && node().online  ? 'online' : 'offline'
        );

        this.stateIcon = ko.pureComputed(
            () => node() && `/fe/assets/icons.svg#node-${
                node().online ? 'online' : 'offline'
            }`
        );

        this.name = ko.pureComputed(
            () => node() && node().name
        );

        this.href = ko.pureComputed(
            () => node() && `/fe/systems/:system/pools/:pool/nodes/${node().name}`
        );

        this.ip = ko.pureComputed(
            () => node() && node().ip
        );

        this.total = ko.pureComputed(
            () => node() && node().storage.total
        );

        this.used = ko.pureComputed(
            () => node() && node().storage.used
        );

        let dataAccess = ko.pureComputed(
            () => node() && accessibilityMapping[
                    bitsToNumber(node().readable, node().writable)
                ]
        );

        this.dataAccessText = ko.pureComputed(
            () => dataAccess() && dataAccess().text
        );

        this.dataAccessClass = ko.pureComputed(
            () => dataAccess() &&  dataAccess().css
        );

        this.trustLevel = ko.pureComputed(
            () => node() && node().trusted ? 'Trusted' : 'Untrusted'
        );

        let dataActivity = ko.pureComputed(
            () => node() && node().data_activity
        );

        this.hasActivity = ko.pureComputed(
            () => !!dataActivity()
        );

        this.activityLabel = ko.pureComputed(
            () => this.hasActivity() ?
                activityLabelMapping[dataActivity().type] :
                'No Activity'
        );

        this.activityCompilation = ko.pureComputed(
            () => {
                if (!dataActivity()) {
                    return;
                }

                let { completed_size, total_size } = dataActivity();
                return numeral(completed_size / total_size).format('0%');
            }
        );
    }
}
