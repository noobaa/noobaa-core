import template from './func-triggers.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';

class FuncTriggersViewModel extends BaseViewModel {
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
