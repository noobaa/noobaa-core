import template from './bucket-panel.html';
import ko from 'knockout';
import { uiState, bucketInfo, bucketObjectList } from 'model';

class BucketPanelViewModel {
    constructor() {
        this.bucket = bucketInfo;
        this.objects = bucketObjectList;

        this.ready = ko.pureComputed(
            () => !!bucketInfo()
        );

        this.bucketName = ko.pureComputed(
            () => bucketInfo() && bucketInfo().name
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
