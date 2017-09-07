/* Copyright (C) 2016 NooBaa */

import template from './svg-icon.html';
import ko from 'knockout';

class SVGIconViewModel {
    constructor({ name, fill, stroke }) {
        this.href = ko.pureComputed(() => `#${ko.unwrap(name)}-icon`);
        this.fill = fill;
        this.stroke = stroke;
    }
}

export default {
    viewModel: SVGIconViewModel,
    template: template
};
