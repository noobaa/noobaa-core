import template from './toggle-filter.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { randomString } from 'utils/string-utils';

class ToggleFilterViewModel extends Disposable {
    constructor({
            options = [],
            selected = ko.observable(),
            name = randomString(5)
        })
    {
        super();

        this.options = ko.pureComputed(
            () => ko.deepUnwrap(options).map(
                opt => {
                    const { value = opt, label = value } = opt;
                    return { value, label };
                }
            )
        );

        this.selected = selected;
        this.group = name;
    }
}

export default {
    viewModel: ToggleFilterViewModel,
    template: template
};
