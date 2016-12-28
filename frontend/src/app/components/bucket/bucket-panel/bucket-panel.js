import template from './bucket-panel.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { uiState, systemInfo, routeContext, bucketObjectList } from 'model';

class BucketPanelViewModel extends BaseViewModel {
    constructor() {
        super();

        this.bucket = ko.pureComputed(
            () => systemInfo() && systemInfo().buckets.find(
                ({ name }) => routeContext().params.bucket === name
            )
        );

        this.objectList = bucketObjectList;

        this.ready = ko.pureComputed(
            () => !!this.bucket()
        );

        this.bucketName = ko.pureComputed(
            () => this.bucket() && this.bucket().name
        );
    }

    tabHref(tab) {
        return {
            route: 'bucket',
            params: { tab }
        };
    }

    tabCss(tab) {
        return {
            selected: uiState().tab === tab
        };
    }

}

export default {
    viewModel: BucketPanelViewModel,
    template: template
};
