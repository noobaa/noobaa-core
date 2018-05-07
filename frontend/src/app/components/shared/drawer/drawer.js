/* Copyright (C) 2016 NooBaa */

import template from './drawer.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { closeDrawer } from 'action-creators';
import { runAsync } from 'utils/core-utils';
import { get } from 'rx-extensions';

class DrawerViewModel extends Observer {
    constructor() {
        super();
        this.component = ko.observable();
        this.params = { onClose: this.close.bind(this) };
        this.opened = ko.observable();

        this.observe(
            state$.pipe(get('drawer')),
            this.onDrawer
        );
    }

    onDrawer(drawer) {
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
        action$.next(closeDrawer());
    }
}

export default {
    viewModel: DrawerViewModel,
    template: template
};
