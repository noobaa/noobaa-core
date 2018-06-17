/* Copyright (C) 2016 NooBaa */

import template from './toggle-group.html';
import ko from 'knockout';
import { randomString } from 'utils/string-utils';
import { isObject } from 'utils/core-utils';

class ToggleGroupViewModel {
    constructor({
        options = [],
        selected = ko.observable(),
        name = randomString(5)
    }) {
        this.options = ko.pureComputed(
            () => ko.unwrap(options).map(opt => {
                if (isObject(opt)) {
                    const { value, label = '', icon = '' } = opt;
                    const layoutCss = (label && icon) ? 'row' : 'column';
                    return { value, label, icon, layoutCss };

                } else {
                    const value = String(opt);
                    return { value, label: value, icon: '', layoutCss: 'column' };
                }
            })
        );

        this.selected = selected;
        this.group = name;
    }
}

export default {
    viewModel: ToggleGroupViewModel,
    template: template
};
