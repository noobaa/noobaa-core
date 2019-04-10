/* Copyright (C) 2016 NooBaa */

import template from './account-usage-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, equalItems, sumBy, createCompareFunc, makeArray } from 'utils/core-utils';
import { getFieldValue, getFormValues } from 'utils/form-utils';
import { toBytes, formatSize, sumSize } from 'utils/size-utils';
import themes from 'themes';
import {
    updateForm,
    fetchAccountUsageHistory,
    dropAccountUsageHistory
} from 'action-creators';

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
        ...makeArray(6 - samples.length, () => placeholderBar)
    ].sort(compareBySize);

    return {
        type: 'bar',
        data: {
            labels: bars.map(bar => bar.account),
            datasets: [
                {

                    backgroundColor: theme.color20,
                    data: bars.map(bar => toBytes(bar.readSize))
                },
                {
                    backgroundColor: theme.color28,
                    data: bars.map(bar => toBytes(bar.writeSize))
                }
            ]
        },
        options: {
            scales: {
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'Aggregated R/W'
                    },
                    stacked: true,
                    ticks: {
                        suggestedMax: 10,
                        // Using space for visual padding.
                        callback: size => `${
                            size && formatSize(size)
                        }${
                            ' '.repeat(5)
                        }`
                    }
                }],
                xAxes: [{
                    stacked: true,
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
        },
        emptyMessage: ''
    };
}

class AccountUsageFormViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    dataReady = ko.observable();
    accountOptions = ko.observableArray();
    durationOptions = durationOptions;
    totalReads = ko.observable();
    totalWrites = ko.observable();
    formFields = {
        initialized: false,
        selectedAccounts: [],
        selectedDuration: durationOptions[0].value
    };
    colors = ko.observableArray();
    chart = {
        type: ko.observable(),
        options: ko.observable(),
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

        if (state.accounts && !getFieldValue(form, 'initialized')) {
            const update = {
                selectedAccounts: Object.keys(state.accounts),
                initialized: true
            };

            this.dispatch(updateForm(this.formName, update, false));
        }
    }

    fetchThroughput(state) {
        const form = state.forms[this.formName];
        if (!form) return;

        const { accounts = [], duration } = state.accountUsageHistory.query || {};
        const { selectedAccounts, selectedDuration } = getFormValues(form);

        if (
            duration !== selectedDuration ||
            !equalItems(accounts, selectedAccounts)
        ) {
            this.dispatch(fetchAccountUsageHistory(selectedAccounts, selectedDuration));
        }
    }

    selectState(state) {
        const { forms, accounts, accountUsageHistory, session } = state;
        return [
            forms[this.formName],
            accounts,
            accountUsageHistory,
            session && themes[session.uiTheme]
        ];
    }

    mapStateToProps(form, accounts, usageHistory, theme) {
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
            const { samples } = usageHistory;
            const totalReads = sumBy(samples, sample => toBytes(sample.readSize));
            const totalWrites = sumBy(samples, sample => toBytes(sample.writeSize));

            ko.assignToProps(this, {
                dataReady: true,
                pathname: location.pathname,
                accountOptions: Object.keys(accounts),
                totalReads: totalReads,
                totalWrites: totalWrites,
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
