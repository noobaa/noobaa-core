import template from './main-nav.html';
import BaseViewModel from 'components/base-view-model';
import { uiState } from 'model';
import { deepFreeze } from 'utils/core-utils';
import ko from 'knockout';


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
    }

    isSelected(item) {
        return item === this.selectedItem();
    }
}

export default {
    viewModel: NavMenuViewModel,
    template: template
};
