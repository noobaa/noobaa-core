/* Copyright (C) 2016 NooBaa */

import template from './app.html';
import ko from 'knockout';
import BaseViewModel from 'components/base-view-model';
import { uiState, previewMode } from 'model';

class AppViewModel extends BaseViewModel {
    constructor() {
        super();

        this.layout = ko.pureComputed(() => uiState().layout);
        this.previewMode = ko.pureComputed(previewMode);
    }
}

export default {
    viewModel: AppViewModel,
    template: template
};
