/* Copyright (C) 2016 NooBaa */

import template from './prefered-browsers-sticky.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { preferdBrowsers } from 'config';
import { dismissBrowserSticky } from 'action-creators';

class PreferedBrowsersStickyViewModel extends ConnectableViewModel {
    isActive = ko.observable();

    selectState(state) {
        return [
            state.env
        ];
    }

    mapStateToProps(env) {
        if (!env) {
            ko.assignToProps(this, {
                isActive: false
            });

        } else {
            const { browser, isBrowserStickyDismissed } = env;
            const isActive = !preferdBrowsers.includes(browser) && !isBrowserStickyDismissed;

            ko.assignToProps(this, {
                isActive
            });
        }


    }

    onIgnore() {
        this.dispatch(dismissBrowserSticky());
    }
}

export default {
    viewModel: PreferedBrowsersStickyViewModel,
    template: template
};
