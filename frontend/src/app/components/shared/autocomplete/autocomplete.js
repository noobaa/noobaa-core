import template from './autocomplete.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';

class AutoCompleteViewModel extends BaseViewModel {
    constructor({
        value,
        suggestions = [],
        placeholder = '',
        disabled = false
    }) {
        super();

        this.value = value;
        this.placeholder = placeholder;
        this.disabled = disabled;

        this.suggestions = ko.pureComputed(
            () => ko.unwrap(suggestions).filter(
                suggestion => suggestion.startsWith(ko.unwrap(value) || '')
            )
        );

        this.focused = ko.observable(false);
        this.hasSuggestions = ko.pureComputed(
            () => this.suggestions().length > 0
        );
    }
}

export default {
    viewModel: AutoCompleteViewModel,
    template: template
};
