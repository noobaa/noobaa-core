import template from './main-nav.html';
import BaseViewModel from 'components/base-view-model';
import { uiState, uploads } from 'model';
import { deepFreeze } from 'utils/core-utils';
import { sleep } from 'utils/promise-utils';
import ko from 'knockout';
import style from 'style';
import { openFileUploadsModal } from 'dispatchers';

const navItems = deepFreeze([
    /*{
        name: 'name',
        route: 'route', (see routes.js)
        icon: 'icon',
        label: 'label', (display name, optional)
        beta: true/false, (show beta label)
        preview: true/false (hide when browser not in preview mode)
    },*/
    {
        name: 'overview',
        route: 'system',
        icon: 'overview',
        label: 'Overview'
    },
    {
        name: 'resources',
        route: 'pools',
        icon: 'resources',
        label: 'Resources'
    },
    {
        name: 'buckets',
        route: 'buckets',
        icon: 'buckets',
        label: 'Buckets'
    },
    {
        name: 'funcs',
        route: 'funcs',
        icon: 'functions',
        label: 'Functions',
        beta: true
    },
    {
        name: 'cluster',
        route: 'cluster',
        icon: 'cluster',
        label: 'Cluster',
        beta: true
    },
    {
        name: 'management',
        route: 'management',
        icon: 'manage',
        label: 'Management'
    }
]);

class NavMenuViewModel extends BaseViewModel {
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
    }

    onUploads() {
        openFileUploadsModal();
    }

    isSelected(item) {
        return item === this.selectedItem();
    }
}

export default {
    viewModel: NavMenuViewModel,
    template: template
};
