import template from './toggle-switch.html';
import Disposable from 'disposable';
import ko from 'knockout';

class ToggleSwitchViewModel extends Disposable {
    constructor({ value = ko.observable(true), onLabel = 'on', offLabel = 'off' }) {
        super();

        this.value = value;
        this.label = ko.pureComputed(
            () => ko.unwrap(value) ? ko.unwrap(onLabel) : ko.unwrap(offLabel)
        );
    }
}

export default {
    viewModel: ToggleSwitchViewModel,
    template: template
};
