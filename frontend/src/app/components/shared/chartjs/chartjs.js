/* Copyright (C) 2016 NooBaa */

import './chartjs-binding';
import template from './chartjs.html';
import ko from 'knockout';

function isEmpty(data) {
    const _data = ko.unwrap(data);
    if (!_data) return true;

    let datasets = ko.unwrap(_data.datasets);
    if (!datasets) return true;

    return datasets.every(dataset => {
        let _dataset = ko.unwrap(dataset);
        if (!_dataset) return true;

        const data = ko.unwrap(_dataset.data);
        if (!data) return true;

        return data.length === 0;
    });
}

class ChartJSViewModel {
    constructor(params) {
        const {
            type = 'line',
            data = {},
            options = {},
            emptyMessage = 'No data to display',
            forceEmptyMessage = false
        } = params;

        this.config = { type, options, data };
        this.emptyMessage = ko.pureComputed(() =>
            (ko.unwrap(forceEmptyMessage) || isEmpty(data)) ?
                ko.unwrap(emptyMessage) :
                ''
        );
    }
}

export default {
    viewModel: ChartJSViewModel,
    template: template
};
