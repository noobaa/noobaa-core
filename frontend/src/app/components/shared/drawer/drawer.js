import template from './drawer.html';
import StateAwareViewModel from 'components/state-aware-view-model';
import ko from 'knockout';
import { closeActiveDrawer } from 'dispatchers';
import { runAsync } from 'utils/core-utils';

class DrawerViewModel extends StateAwareViewModel {
    constructor() {
        super();
        this.component = ko.observable();
        this.opened = ko.observable();
    }

    onState(state) {
        if (!this.opened() || state.drawer) {
            this.component(state.drawer);
        }

        // Must be async in oreder to invoke the css transition.
        runAsync(() => this.opened(Boolean(state.drawer)));
    }

    onTransitionEnd() {
        // Destroy the component only after the transition ends.
        if (!this.opened()) {
            this.component(null);
        }
    }

    close() {
        closeActiveDrawer();
    }
}

export default {
    viewModel: DrawerViewModel,
    template: template
};
