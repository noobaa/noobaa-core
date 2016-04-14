import template from './toggle-switch.html';
import ko from 'knockout';

class ToggleSwitchViewModel {
    constructor({ 
        value = ko.observable(true),
        onLabel = 'ON',
        offLabel = 'OFF'
    }) {

        this.value = value;
        this.label = ko.pureComputed(
            () => ko.unwrap(value) ? ko.unwrap(onLabel) : ko.unwrap(offLabel)
        )
    }
}

export default {
    viewModel: ToggleSwitchViewModel,
    template: template
}