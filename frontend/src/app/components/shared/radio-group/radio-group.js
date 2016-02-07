import template from './radio-group.html';
import { randomString } from 'utils';

class RadioGroupViewModel {
    constructor({ selected, name = randomString(5), options, seperateLines = false }) {
        this.name = name;
        this.selected = selected;
        this.options = options;
        this.layoutClass = !!seperateLines ? 'block' : 'inline';
    }
}

export default {
    viewModel: RadioGroupViewModel,
    template: template
}