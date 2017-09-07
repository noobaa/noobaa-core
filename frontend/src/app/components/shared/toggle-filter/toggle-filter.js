/* Copyright (C) 2016 NooBaa */

import template from './toggle-filter.html';
import ko from 'knockout';
import { randomString } from 'utils/string-utils';

class ToggleFilterViewModel {
    constructor({
            options = [],
            selected = ko.observable(),
            name = randomString(5)
        })
    {
        this.options = ko.pureComputed(
            () => ko.unwrap(options).map(
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
