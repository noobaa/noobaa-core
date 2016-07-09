import template from './object-summary.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { formatSize } from 'utils';

const objectStateMapping = Object.freeze({
    true: { label: 'Available', icon: 'object-available'},
    false: { label: 'Unavailable', icon: 'object-unavailable' }
});

class ObjectSummaryViewModel extends BaseViewModel {
    constructor({ obj }) {
        super();

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
            () => this.state() && this.state().icon
        );

        this.sizeLabel = ko.pureComputed(
            () => obj() && `Size: ${formatSize(obj().size)}`
        );

        this.sizeIcon = ko.pureComputed(
            () => 'object-size'
        );

        this.isPreviewModalVisible = ko.observable(false);
    }
}

export default {
    viewModel: ObjectSummaryViewModel,
    template: template
};
