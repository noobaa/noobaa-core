import template from './range-indicator.html';
import Disposable from 'disposable';
import ko from 'knockout';

class RangeIndicatorViewModel extends Disposable {
    constructor({ values }) {
        super();

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
