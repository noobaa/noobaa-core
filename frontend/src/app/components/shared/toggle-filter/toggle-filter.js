/* Copyright (C) 2016 NooBaa */

import template from './toggle-filter.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { randomString } from 'utils/string-utils';

class ToggleFilterViewModel extends BaseViewModel {
    constructor({
            options = [],
            selected = ko.observable(),
            name = randomString(5)
        })
    {
        super();

        this.options = ko.pureComputed(
            () => ko.unwrap(options).map(
                    opt => {
                        const { value = opt, label = value, preview } = opt;
                        return { value, label, preview };
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
