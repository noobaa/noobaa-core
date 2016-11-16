import template from './lambda-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { lambdaFunction, uiState } from 'model';

class LambdaPanelViewModel extends Disposable {
    constructor() {
        super();

        this.lambda = ko.pureComputed(
            () => lambdaFunction()
        );

        this.selectedTab = ko.pureComputed(
            () => uiState().tab
        );
    }

    isTabSelected(tabName) {
        return this.selectedTab() === tabName;
    }
}

export default {
    viewModel: LambdaPanelViewModel,
    template: template
};
