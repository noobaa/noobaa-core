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

        this.eventText = ko.observable()
            .extend({
                validation: {
                    message: 'Not a valid JSON',
                    validator: text => {
                        try {
                            JSON.parse(text);
                            return true;
                        } catch (err) {
                            return false;
                        }
                    }
                }
            });

        this.errors = ko.validation.group([
            this.eventText
        ]);

    }

    invoke() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
            return;
        }

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
