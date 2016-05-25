import template from './main-layout.html';
import ko from 'knockout';
import { uiState, systemInfo } from 'model';

class MainLayoutViewModel {
    constructor() {
        this.panel = ko.pureComputed(
            () => `${uiState().panel}-panel`
        );

        this.showDebugOutline = ko.pureComputed(
            () => !!systemInfo() && systemInfo().debugLevel > 0
        );
    }
}

export default {
    viewModel: MainLayoutViewModel,
    template: template
}