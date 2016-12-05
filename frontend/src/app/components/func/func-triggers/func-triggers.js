import template from './func-triggers.html';
import Disposable from 'disposable';
import ko from 'knockout';

class FuncTriggersViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.func = ko.pureComputed(
            () => func()
        );

    }

}

export default {
    viewModel: FuncTriggersViewModel,
    template: template
};
