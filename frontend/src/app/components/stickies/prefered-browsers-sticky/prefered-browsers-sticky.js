/* Copyright (C) 2016 NooBaa */

import template from './prefered-browsers-sticky.html';
import ko from 'knockout';
import { recognizeBrowser } from 'utils/browser-utils';
import { preferdBrowsers } from 'config';

class PreferedBrowsersStickyViewModel {
    constructor() {
        this.isHidden = ko.observable();
        this.isActive = ko.pureComputed(
            () => Boolean(!preferdBrowsers.includes(recognizeBrowser()) && !this.isHidden())
        );
    }

    onClose() {
        this.isHidden(true);
    }
}

export default {
    viewModel: PreferedBrowsersStickyViewModel,
    template: template
};
