import template from './radio-group.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { randomString } from 'utils/string-utils';

class RadioGroupViewModel extends BaseViewModel {
    constructor({
            selected = ko.observable(),
            name = randomString(5),
            options = [],
            multiline = false,
            disabled = false,
            hasFocus = false
    }) {
        super();

        this.name = name;
        this.selected = selected;
        this.disabled = disabled;
        this.hasFocus = hasFocus;
        this.layoutClass = multiline ? 'column' : 'row';

        this.options = ko.pureComputed(
            () => ko.unwrap(options).map(
                opt => {
                    const { value = opt, label = value } = opt;
                    return { value, label };
                }
            )
        );
    }
}

export default {
    viewModel: RadioGroupViewModel,
    template: template
};
