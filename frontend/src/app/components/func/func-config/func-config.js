import template from './func-config.html';
import Disposable from 'disposable';
import ko from 'knockout';

class FuncConfigViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.func = ko.pureComputed(
            () => func()
        );

    }

}

export default {
    viewModel: FuncConfigViewModel,
    template: template
};
