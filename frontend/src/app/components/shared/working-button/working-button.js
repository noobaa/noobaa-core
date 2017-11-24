/* Copyright (C) 2016 NooBaa */

import template from './working-button.html';
import { isFunction } from 'utils/core-utils';
import ko from 'knockout';

class WorkingBtnViewModel {
    constructor({ working, workingLabel, click, disabled }) {
        this.working = working;
        this.label = workingLabel;
        this.clickHandler = click;
        this.disabled = disabled;
    }

    onClick(parentViewModel) {
        const { working, clickHandler } = this;
        if (isFunction(clickHandler) && !ko.unwrap(working)) {
            clickHandler.call(parentViewModel);
        }
    }
}

export default {
    viewModel: WorkingBtnViewModel,
    template: template
};
