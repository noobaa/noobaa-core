import template from './main-header.html';
import ko from 'knockout';
import { uiState } from 'model';

class HeaderViewModel {
    constructor() {
        this.crumbs = ko.pureComputed(
            () => uiState().breadcrumbs
        );
    }
}

export default { 
    viewModel: HeaderViewModel,
    template: template
}
