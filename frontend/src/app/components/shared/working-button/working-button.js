/* Copyright (C) 2016 NooBaa */

import template from './working-button.html';

class WorkingBtnViewModel {
    constructor({ working, workingLabel, click, disabled }) {
        this.working = working;
        this.label = workingLabel;
        this.click = click;
        this.disabled = disabled;

    }
}

export default {
    viewModel: WorkingBtnViewModel,
    template: template
};
