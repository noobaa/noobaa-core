import template from './app.html';
import StateListener from 'state-listener';
import ko from 'knockout';
import { uiState, previewMode } from 'model';
// import { restoreSession } from 'dispatchers';

class AppViewModel extends StateListener {
    constructor() {
        super();

        this.layout = ko.pureComputed(() => uiState().layout);
        this.previewMode = ko.pureComputed(previewMode);

        // restoreSession();
    }

    // stateSelector(state) {
    //     return [ state.layout ];
    // }

    // onState(layout) {
    //     this.layout(`${layout.name}-layout`);
    // }
}

export default {
    viewModel: AppViewModel,
    template: template
};
