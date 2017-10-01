/* Copyright (C) 2016 NooBaa */

import template from './slider.html';
import ko from 'knockout';

class SliderViewModel {
    constructor({ current = 1 }) {
        this.current = current;

        this.transform = ko.pureComputed(
            () => `translate(${
                (ko.unwrap(this.current) - 1) * -100
            }%)`
        );
    }

    isCurrent(index) {
        return ko.unwrap(this.current()) === index() + 1;
    }
}

export default {
    viewModel: SliderViewModel,
    template: template
};
