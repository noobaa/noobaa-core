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

        this.eventText = ko.observable();

    }

    invoke() {
        invokeFunc({
            name: this.func().config.name,
            version: this.func().config.version,
            event: this.eventText()
        });
    }

}

export default {
    viewModel: FuncInvokeViewModel,
    template: template
};
