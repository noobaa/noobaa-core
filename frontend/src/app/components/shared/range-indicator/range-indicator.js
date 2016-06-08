import template from './range-indicator.html';
import ko from 'knockout';

class RangeIndicatorViewModel {
    constructor({ values }) {
        this.values = values;
        this.total = ko.computed(() => values.reduce( (sum, { value }) => {
            return sum + ko.unwrap(value);
        }, 0));

    }

    percentageFor(value) {
        return `${ko.unwrap(value) / this.total() * 100}%`;
    }
}

export default {
    viewModel: RangeIndicatorViewModel,
    template: template
};
