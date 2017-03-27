import template from './val-message.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';

class ValMessageViewModel extends BaseViewModel {
    constructor({ field }) {
        super();

        this.text = ko.pureComputed(
            () => (field.touched() && field.error()) || ''
        );
    }
}

export default {
    viewModel: ValMessageViewModel,
    template: template
};
