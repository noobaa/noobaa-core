/* Copyright (C) 2016 NooBaa */

import template from './drawer.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { closeDrawer } from 'action-creators';
import { runAsync } from 'utils/core-utils';

class DrawerViewModel extends ConnectableViewModel {
    component = ko.observable();
    params = {
        onClose: this.close.bind(this)
    };
    opened = ko.observable();

    selectState(state) {
        return [
            state.drawer
        ];
    }

    mapStateToProps(drawer) {
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
        this.dispatch(closeDrawer());
    }
}

export default {
    viewModel: DrawerViewModel,
    template: template
};
