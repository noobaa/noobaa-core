import ko from 'knockout';
import Chart from 'chartjs';

const chartsWeakMap = new WeakMap();

ko.bindingHandlers.chartjs = {
    update: function(element, valueAccessor) {
        const config = ko.unwrap(valueAccessor());

        const chart = chartsWeakMap.get(element);

        if (chart) {
            if (config) {
                chart.data.datasets = config.data.datasets;
                chart.update();
            } else {
                chartsWeakMap.delete(element);
                chart.destroy();
            }
        } else if (config) {
            const newChart = new Chart(element, config);
            chartsWeakMap.set(element, newChart);
        }
    }
};
