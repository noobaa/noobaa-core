import template from './main-header.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { uiState } from 'model';

class HeaderViewModel extends BaseViewModel {
    constructor() {
        super();

        this.crumbs = ko.pureComputed(
            () => uiState().breadcrumbs
        );
    }
}

export default {
    viewModel: HeaderViewModel,
    template: template
};
