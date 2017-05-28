/* Copyright (C) 2016 NooBaa */

import template from './svg-icon.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';

class SVGIconViewModel extends BaseViewModel {
    constructor({ name, fill, stroke }) {
        super();

        this.href = ko.pureComputed(() => `#${ko.unwrap(name)}-icon`);
        this.fill = fill;
        this.stroke = stroke;
    }
}

export default {
    viewModel: SVGIconViewModel,
    template: template
};
