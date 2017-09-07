/* Copyright (C) 2016 NooBaa */

import './chartjs-binding';
import template from './chartjs.html';

class chartJSViewModel {
    constructor({ type = 'line', data = {}, options = {} }) {
        this.config = { type, options, data };
    }
}

export default {
    viewModel: chartJSViewModel,
    template: template
};
