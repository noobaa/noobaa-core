import template from './main-nav.html';
import Disposable from 'disposable';
import { uiState, uploads } from 'model';
import { deepFreeze, sleep } from 'utils';
import ko from 'knockout';
import style from 'style';

const navItems = deepFreeze([
    {
        name: 'overview',
        route: 'system',
        icon: 'overview',
        label: 'Overview'
    },
    {
        name: 'buckets',
        route: 'buckets',
        icon: 'buckets',
        label: 'Buckets'
    },
    {
        name: 'resources',
        route: 'pools',
        icon: 'resources',
        label: 'Resources'
    },
    {
        name: 'management',
        route: 'management',
        icon: 'manage',
        label: 'Management'
    },
    {
        name: 'cluster',
        route: 'cluster',
        icon: 'cluster',
        label: 'Cluster',
        preview: true
    }
]);

class NavMenuViewModel extends Disposable{
    constructor() {
        super();

        this.items = navItems;
        this.selectedItem = ko.pureComputed(
            () => uiState().selectedNavItem
        );

        this.uploadsCount = ko.pureComputed(
            () => uploads.stats().uploading
        );

        this.animateUploadCount = ko.observable(false);
        this.lastUploadCount = uploads.lastRequestFileCount;
        this.addToDisposeList(
            this.lastUploadCount.subscribe(
                () => {
                    this.animateUploadCount(false);
                    sleep(100, true).then(this.animateUploadCount);
                }
            )
        );

        let uploadProgress = ko.pureComputed(
            () => {
                let { size, progress } = uploads.stats().batch;
                return progress / size;
            }
        );

        this.uploadStateValues = [
            {
                value: uploadProgress,
                color: style['color8']
            },
            {
                value: ko.pureComputed(
                    () => 1 - uploadProgress()
                ),
                color: style['color6']
            }
        ];

        this.isUploadsModalVisible = ko.observable(false);
    }

    isSelected(item) {
        return item === this.selectedItem();
    }

    showUploadsModal() {
        this.isUploadsModalVisible(true);
    }

    hideUploadsModal() {
        this.isUploadsModalVisible(false);
    }
}

export default {
    viewModel: NavMenuViewModel,
    template: template
};
