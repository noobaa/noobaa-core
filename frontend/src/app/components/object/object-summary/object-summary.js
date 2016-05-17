import template from './object-summary.html';
import ko from 'knockout';
import { formatSize } from 'utils';

const objectStateMapping = Object.freeze({
    true: { label: 'Available', icon: 'object-healthy'},
    false: { label: 'Unavailable', icon: 'object-problem' }
});

class ObjectSummaryViewModel {
    constructor({ obj }) {
        this.dataReady = ko.pureComputed(
            () => !!obj()
        );

        this.reads = ko.pureComputed(
            () => obj() && obj().stats.reads
        );

        // TODO: change to actual state/availability when available
        this.state = ko.pureComputed(
            () => obj() && objectStateMapping[true]
        );

        this.stateLabel = ko.pureComputed(
            () => this.state() && this.state().label
        );

        this.stateIcon = ko.pureComputed(
            () => this.state() && `/fe/assets/icons.svg#${this.state().icon}`
        );

        this.sizeLabel = ko.pureComputed(
            () => obj() && `Size: ${formatSize(obj().size)}`
        );

        this.sizeIcon = ko.pureComputed(
            () => `/fe/assets/icons.svg#no-entry`
        );

        this.isPreviewModalVisible = ko.observable(false);
    }
}

export default {
    viewModel: ObjectSummaryViewModel,
    template: template
}