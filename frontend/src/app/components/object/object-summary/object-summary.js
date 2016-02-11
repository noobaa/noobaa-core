import template from './object-summary.html';
import ko from 'knockout';
import { formatSize } from 'utils';

class ObjectSummaryViewModel {
    constructor({ object }) {
        this.dataReady = ko.pureComputed(
            () => !!object()
        );

        this.s3Url = ko.pureComputed(
            () => object().s3Url
        );

        this.reads = ko.pureComputed(
            () => object().info.stats.reads
        );

        this.size = ko.pureComputed(
            () => `Size: ${formatSize(object().info.size)}`
        );

        this.partsCount = ko.pureComputed(
            () => `Parts Count: ${object().info.total_parts_count || 'N/A'}`
        );

        this.isPreviewModalVisible = ko.observable(false);
    }
}

export default {
    viewModel: ObjectSummaryViewModel,
    template: template
}