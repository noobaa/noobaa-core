import template from './main-nav.html';
import Disposable from 'disposable';
import { uiState } from 'model';
import { deepFreeze } from 'utils';
import ko from 'knockout';

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
        label: 'Cluster'
    }
]);

class NavMenuViewModel extends Disposable{
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
