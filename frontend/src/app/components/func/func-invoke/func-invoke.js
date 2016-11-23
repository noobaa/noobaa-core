import template from './func-invoke.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { invokeFunc } from 'actions';

class FuncInvokeViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.func = ko.pureComputed(
            () => func()
        );

        this.event = ko.observable()
            .extend({
                isJSON: true
            });

        this.errors = ko.validation.group(this);

    }

    invoke() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
            return;
        }

        let { name, version } = this.func().config;
        invokeFunc(name, version, this.event());
    }

}

export default {
    viewModel: FuncInvokeViewModel,
    template: template
};
