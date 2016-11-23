import ko from 'knockout';
import Chart from 'chartjs';

const { domData, domNodeDisposal } = ko.utils;
const dataKey = 'chartjs';

ko.bindingHandlers.chartjs = {
    init: function(element, valueAccessor) {
        let  config = ko.unwrap(valueAccessor());
        let  chart = new Chart(element, config);
        domData.set(element, dataKey, chart);

        domNodeDisposal.addDisposeCallback(
            element,
            () => chart.destory()
        );
    },

    update: function(element, valueAccessor) {
        let config = ko.unwrap(valueAccessor());
        let chart = domData.get(element, dataKey);

        Object.assign(chart.data, config.data);
        chart.update();
    }
};
