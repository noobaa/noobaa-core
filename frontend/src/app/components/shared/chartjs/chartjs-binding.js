/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import Chart from 'chartjs';

const { domData, domNodeDisposal } = ko.utils;
const dataKey = 'chartjs';

ko.bindingHandlers.chartjs = {
    init: function(canvas) {
        domNodeDisposal.addDisposeCallback(
            canvas,
            () => {
                const chart = domData.get(canvas, dataKey);
                if (chart) chart.destroy();
            }
        );
    },

    // This update is not optimal if the only change is in the data.
    // Changes in the type or options must create a new chart from statch.
    // TODO: Update the code to update the  chart without destorying the it
    // on data changes.
    update: function(canvas, valueAccessor) {
        const config = ko.deepUnwrap(valueAccessor());

        const chart = domData.get(canvas, dataKey);
        if (chart) chart.destroy();

        domData.set(canvas, dataKey, new Chart(canvas, config));
    }
};
