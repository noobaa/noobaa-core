import template from './bucket-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { uiState, systemInfo, routeContext, bucketObjectList } from 'model';

class BucketPanelViewModel extends Disposable {
    constructor() {
        super();

        this.bucket = ko.pureComputed(
            () => systemInfo() && systemInfo().buckets.find(
                ({ name }) => routeContext().params.bucket === name
            )
        );

        this.objects = bucketObjectList;

        this.ready = ko.pureComputed(
            () => !!this.bucket()
        );

        this.bucketName = ko.pureComputed(
            () => this.bucket() && this.bucket().name
        );

        this.selectedTab = ko.pureComputed(
            () => uiState().tab
        );
    }

    isTabSelected(tabName) {
        return this.selectedTab() === tabName;
    }
}

export default {
    viewModel: BucketPanelViewModel,
    template: template
};
