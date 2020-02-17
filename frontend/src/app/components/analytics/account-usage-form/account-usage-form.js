/* Copyright (C) 2016 NooBaa */

import template from './account-usage-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, equalItems, createCompareFunc, makeArray } from 'utils/core-utils';
import { getFieldValue, getFormValues } from 'utils/form-utils';
import { toBytes, formatSize, sumSize, unitsInBytes } from 'utils/size-utils';
import themes from 'themes';
import moment from 'moment';
import {
    updateForm,
    fetchAccountUsageHistory,
    dropAccountUsageHistory
} from 'action-creators';

const FETCH_THRESHOLD = moment
    .duration(10, 'minute')
    .asMilliseconds();

const placeholderBar = {
    account: '',
    readSize: 0,
    writeSize: 0
};

const durations = deepFreeze({
    DAY: {
        label: 'Last 24 Hours',
        timespan: 24,
        stepSize: 1,
        stepUnit: 'hour',
        tickFormat: 'HH:mm'
    },
    WEEK: {
        label: 'Last 7 Days',
        timespan: 7,
        stepSize: 1,
        stepUnit: 'day',
        tickFormat: 'D MMM'
    },
    MONTH: {
        label: 'Last 4 Weeks',
        timespan: 28,
        stepSize: 7,
        stepUnit: 'day',
        tickFormat: 'D MMM'
    }
});

const chartOptions =  {
    scales: {
        yAxes: [{
            scaleLabel: {
                display: true,
                labelString: 'Aggregated R/W'
            },
            ticks: {
                suggestedMax: unitsInBytes.MB,
                // Using space for visual padding.
                callback: size => `${
                    size && formatSize(size)
                }${
                    ' '.repeat(5)
                }`
            }
        }],
        xAxes: [{
            categoryPercentage: .4
        }]
    },
    tooltips: {
        position: 'nearest',
        mode: 'x',
        custom: tooltip => {
            if (!tooltip.title || tooltip.title.length === 0) {
                tooltip.opacity = 0;
            }
        },
        callbacks: {
            title: items => items[0].xLabel,
            label: item => `Total ${
                item.datasetIndex === 0 ? 'reads' : 'writes'
            }: ${
                formatSize(item.yLabel)
            }`
        }
    }
};

const durationOptions = deepFreeze(
    Object.entries(durations).map(pair => ({
        value: pair[0],
        label: pair[1].label
    }))
);

const compareBySize = createCompareFunc(
    sample => toBytes(sumSize(sample.readSize, sample.writeSize)),
    -1
);

function _perpareChartParams(samples, theme) {
    const bars = [
        ...samples,
        ...makeArray(10 - samples.length, () => placeholderBar)
    ];

    return {
        data: {
            labels: bars.map(bar => bar.account),
            datasets: [
                {

                    backgroundColor: theme.color20,
                    data: bars.map(bar => toBytes(bar.readSize))
                },
                {
                    backgroundColor: theme.color14,
                    data: bars.map(bar => toBytes(bar.writeSize))
                }
            ]
        },
        emptyMessage: samples.length === 0 ?
            'No data to display' :
            ''
    };
}

class AccountUsageFormViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    dataReady = ko.observable();
    endpointGroupOptions = ko.observableArray();
    durationOptions = durationOptions;
    formFields = {
        initialized: false,
        selectedEndpointGroups: [],
        selectedDuration: durationOptions[0].value
    };
    colors = ko.observableArray();
    chart = {
        type: 'bar',
        options: chartOptions,
        data: ko.observable(),
        emptyMessage: ko.observable()
    };

    onState(state, params){
        super.onState(state, params);
        this.initializeForm(state);
        this.fetchThroughput(state);
    }

    initializeForm(state) {
        const form = state.forms[this.formName];
        if (!form) return;

        if (
            state.accounts &&
            state.endpointGroups &&
            !getFieldValue(form, 'initialized')
        ) {
            const update = {
                selectedEndpointGroups: Object.keys(state.endpointGroups),
                initialized: true
            };

            this.dispatch(updateForm(this.formName, update, false));
        }
    }

    fetchThroughput(state) {
        const form = state.forms[this.formName];
        if (!form) return;

        const { query } = state.accountUsageHistory;
        const { selectedEndpointGroups, selectedDuration } = getFormValues(form);

        if (
            !query ||
            (Date.now() - query.timestamp > FETCH_THRESHOLD) ||
            query.duration !== selectedDuration ||
            !equalItems(query.endpointGroups, selectedEndpointGroups)
        ) {
            this.dispatch(fetchAccountUsageHistory(
                selectedDuration,
                selectedEndpointGroups
            ));
        }
    }

    selectState(state) {
        const { forms, accounts, endpointGroups, accountUsageHistory, session } = state;
        return [
            forms[this.formName],
            accounts,
            endpointGroups,
            accountUsageHistory,
            session && themes[session.uiTheme]
        ];
    }

    mapStateToProps(form, accounts, endpointGroups, usageHistory, theme) {
        if (!accounts || !usageHistory.samples || !theme || !getFieldValue(form, 'initialized')) {
            ko.assignToProps(this, {
                dataReady: false,
                pathname: location.pathname,
                colors: ['', ''],
                chart: {
                    emptyMessage: 'Loading data...'
                }
            });

        } else {
            // Take the top 10 samples
            const samples = [...usageHistory.samples]
                .sort(compareBySize)
                .slice(0, 10);

            ko.assignToProps(this, {
                dataReady: true,
                pathname: location.pathname,
                endpointGroupOptions: Object.keys(endpointGroups),
                chart: _perpareChartParams(samples, theme)
            });
        }
    }

    dispose() {
        this.dispatch(dropAccountUsageHistory());
        super.dispose();
    }
}

export default {
    viewModel: AccountUsageFormViewModel,
    template: template
};
