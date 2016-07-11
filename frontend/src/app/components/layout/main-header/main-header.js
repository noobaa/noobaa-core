import template from './main-header.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { uiState } from 'model';

class HeaderViewModel extends Disposable {
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
