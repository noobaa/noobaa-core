/* Copyright (C) 2016 NooBaa */

import template from './prefered-browsers-sticky.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$, action$ } from 'state';
import { preferdBrowsers } from 'config';
import { get } from 'rx-extensions';
import {
    dismissBrowserSticky
} from 'action-creators';

class PreferedBrowsersStickyViewModel extends Observer {
    constructor() {
        super();

        this.isActive = ko.observable();

        this.observe(
            state$.pipe(get('env')),
            this.onEnv
        );
    }

    onEnv(env) {
        if (!env) return;

        const { browser, isBrowserStickyDismissed } = env;
        const isActive = !preferdBrowsers.includes(browser) && !isBrowserStickyDismissed;

        this.isActive(isActive);
    }

    onClose() {
        action$.next(dismissBrowserSticky());
    }
}

export default {
    viewModel: PreferedBrowsersStickyViewModel,
    template: template
};
