import template from './toggle-switch.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';

class ToggleSwitchViewModel extends BaseViewModel {
    constructor({
        value = ko.observable(true),
        onLabel = 'on',
        offLabel = 'off',
        disabled = false

    }) {
        super();

        this.value = value;
        this.label = ko.pureComputed(
            () => ko.unwrap(value) ? ko.unwrap(onLabel) : ko.unwrap(offLabel)
        );
        this.disabled = disabled;
    }
}

export default {
    viewModel: ToggleSwitchViewModel,
    template: template
};
