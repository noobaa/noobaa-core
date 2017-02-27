import template from './drawer.html';
import StateListener from 'state-listener';
import ko from 'knockout';
import { closeActiveDrawer } from 'dispatchers';
import { runAsync } from 'utils/core-utils';

class DrawerViewModel extends StateListener {
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
