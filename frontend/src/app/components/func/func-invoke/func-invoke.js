/* Copyright (C) 2016 NooBaa */

import template from './func-invoke.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { invokeFunc } from 'actions';

class FuncInvokeViewModel extends BaseViewModel {
    constructor({ func }) {
        super();

        this.name = ko.pureComputed(
            () => func() ? func().name : ''
        );

        this.version = ko.pureComputed(
            () => func() ? func().version : ''
        );

        this.event = ko.observable()
            .extend({ isJSON: true });

        this.errors = ko.validation.group(this);
    }

    invoke() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
            return;
        }

        invokeFunc(this.name(), this.version(), this.event());
    }

}

export default {
    viewModel: FuncInvokeViewModel,
    template: template
};
