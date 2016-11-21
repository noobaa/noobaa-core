import ko from 'knockout';
import Chart from 'chart.js';

const chartsWeakMap = new WeakMap();

export default {
    update: function(element, valueAccessor/*, allBindings*/) {
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
