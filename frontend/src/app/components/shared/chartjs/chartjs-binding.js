/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import Chart from 'chartjs';
import { deepAssign, deepClone } from 'utils/core-utils';
import defaultSettings from './chartjs-defaults';

// Metrge NooBaa default chartjs global default settings.
Chart.defaults = deepAssign(
    Chart.defaults,
    defaultSettings
);

function createChart(canvas, type, options, data) {
    return new Chart(canvas, {
        type: type,
        options: deepClone(options),
        data: deepClone(data)
    });
}

ko.bindingHandlers.chartjs = {
    init: function(canvas, valueAccessor) {
        const config = ko.unwrap(valueAccessor());
        const type = ko.pureComputed(() => ko.unwrap(config.type));
        const options = ko.pureComputed(() => ko.deepUnwrap(config.options));
        const data = ko.pureComputed(() => ko.deepUnwrap(config.data));

        let lastType = type.peek();
        let lastOptions = options.peek();
        let lastData = data.peek();
        let chart = createChart(canvas, lastType, lastOptions, lastData);

        const sub = ko.pureComputed(() => [type(), options(), data()])
            .extend({
                rateLimit: {
                    method: 'notifyWhenChangesStop',
                    timeout: 1
                }
            }).subscribe(([type, options, data]) => {
                if (type !== lastType) {
                    if (chart) chart.destroy();
                    chart = createChart(canvas, type, options, data);

                } else if (chart) {
                    if (options !== lastOptions) {
                        //chart.options = deepClone(options);
                        //OHAD: W/A shoudl work wiht options instead
                        if (chart) chart.destroy();
                        chart = createChart(canvas, type, options, data);
                    }

                    if (data !== lastData) {
                        const { datasets, labels } = chart.data;

                        if (Array.isArray(labels) && Array.isArray(data.labels)) {
                            labels.length = data.labels.length;
                            chart.data.labels = Object.assign(labels, data.labels);

                        } else {
                            chart.data.labels = data.labels;
                        }

                        datasets.length = data.datasets.length;
                        for (let i = 0; i < datasets.length; ++i) {
                            datasets[i] = Object.assign(datasets[i] || {}, data.datasets[i]);
                        }
                    }

                    chart.update();
                }

                lastType = type;
                lastOptions = options;
                lastData = data;
            });


        ko.utils.domNodeDisposal.addDisposeCallback(canvas, () => {
            chart.destroy();
            sub.dispose();
        });
    }
};
