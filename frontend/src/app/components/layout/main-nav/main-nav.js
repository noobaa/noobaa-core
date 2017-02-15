import template from './main-nav.html';
import StateAwareViewModel from 'components/state-aware-view-model';
import { uiState } from 'model';
import { deepFreeze, last } from 'utils/core-utils';
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

class NavMenuViewModel extends StateAwareViewModel {
    constructor() {
        super();

        this.items = navItems;

        // REFATOR: need to be refactored after uistate moves to the state.
        this.selectedItem = ko.pureComputed(
            () => uiState().selectedNavItem
        );

        this.uploadCount = ko.observable();
        this.uploadProgress = ko.observable();
        this.recentUploadCounter = ko.observable();

        this.uploadBarValues = [
            {
                value: this.uploadProgress,
                color: style['color8']
            },
            {
                value: ko.pureComputed(() => 1 - this.uploadProgress()),
                color: style['color6']
            }
        ];
    }

    onState({ objectUploads: uploads }, { objectUploads: prevUploads }) {
        if (uploads === prevUploads) {
            return;
        }

        const { stats } = uploads;
        this.uploadCount(stats.uploading);
        this.uploadProgress(stats.batchLoaded / stats.batchSize);
    }

    onUploads() {
        openFileUploadsModal();
    }

    onUploadAniamtionEnd() {
    }

    isSelected(item) {
        return item === this.selectedItem();
    }
}

export default {
    viewModel: NavMenuViewModel,
    template: template
};
