import template from './drawer.html';
import StateListener from 'state-listener';
import ko from 'knockout';
import { closeDrawer } from 'dispatchers';
import { runAsync } from 'utils/core-utils';

class DrawerViewModel extends StateListener {
    constructor() {
        super();
        this.component = ko.observable();
        this.opened = ko.observable();
    }

    selectState(state) {
        return [ state.drawer ];
    }

    onState(drawer) {
        if (!this.opened() || drawer) {
            this.component(drawer);
        }

        // Must be async in oreder to invoke the css transition.
        runAsync(() => this.opened(Boolean(drawer)));
    }

    onTransitionEnd() {
        // Destroy the component only after the transition ends.
        if (!this.opened()) {
            this.component(null);
        }
    }

    close() {
        closeDrawer();
    }
}

export default {
    viewModel: DrawerViewModel,
    template: template
};
