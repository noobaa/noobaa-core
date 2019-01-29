/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import Chart from 'chartjs';
import { map, distinctUntilChanged } from 'rxjs/operators';
import { deepAssign, deepClone, get } from 'utils/core-utils';
import getThemedSettings from './chartjs-defaults';
import { state$ } from 'state';
import { defaultTheme } from 'config';

// Metrge NooBaa default chartjs global default settings.
const selectedTheme = ko.observable();
state$.pipe(
    map(state => get(state, ['session', 'uiTheme'], defaultTheme)),
    distinctUntilChanged(Object.is)
).subscribe(theme => {
    // Merge custom settings with chartjs settings.
    Chart.defaults = deepAssign(
        Chart.defaults,
        theme && getThemedSettings(theme)
    );

    // Initiate a redraw for all rendered charts.
    selectedTheme(theme);
});

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
        let lastTheme = selectedTheme.peek();
        let chart = createChart(canvas, lastType, lastOptions, lastData);

        const sub = ko.pureComputed(() => [
            type(),
            options(),
            data(),
            selectedTheme()
        ]).extend({
            rateLimit: {
                method: 'notifyWhenChangesStop',
                timeout: 1
            }
        }).subscribe(([type, options, data, theme]) => {
            const shouldDestory =
                (type !== lastType) ||
                (options !== lastOptions) ||
                (theme !== lastTheme);

            if (shouldDestory) {
                if (chart) chart.destroy();
                chart = createChart(canvas, type, options, data);

            } else if (chart) {
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
            lastTheme = theme;
        });


        ko.utils.domNodeDisposal.addDisposeCallback(canvas, () => {
            chart.destroy();
            sub.dispose();
        });
    }
};
