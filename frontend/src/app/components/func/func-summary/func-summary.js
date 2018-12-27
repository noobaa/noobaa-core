/* Copyright (C) 2016 NooBaa */

import template from './func-summary.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { formatSize } from 'utils/size-utils';
import moment from 'moment';
import { timeShortFormat } from 'config';

function _getDescText(description) {
    const descText = description
        .split('\n')[0]
        .slice(0, 30);

    return descText === description ?
        descText :
        `${descText}...`;
}

function _getDescTooltip(description) {
    if (description.length <= 30 && !description.includes('\n')) {
        return '';
    }

    return {
        template: 'preserveWhitespaces',
        text: description
    };
}

class FuncSummaryViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    state = {
        text: 'Deployed',
        css: 'success',
        icon: 'healthy'
    };
    name = ko.observable();
    descText = ko.observable();
    descTooltip = ko.observable();
    lastModified = ko.observable();
    runtime = ko.observable();
    codeSize = ko.observable();
    memorySize = ko.observable();

    selectState(state, params) {
        const { functions } = state;
        const { funcName, funcVersion } = params;
        const id = `${funcName}:${funcVersion}`;
        return [
            funcName,
            functions && functions[id]
        ];
    }

    mapStateToProps(funcName, func) {
        if (!func) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            ko.assignToProps(this, {
                dataReady: true,
                name: funcName,
                descText: _getDescText(func.description),
                descTooltip: _getDescTooltip(func.description),
                lastModified: moment(func.lastModified).format(timeShortFormat),
                runtime: func.runtime,
                codeSize: formatSize(func.codeSize),
                memorySize: `${func.memorySize}MB`
            });
        }
    }
}

export default {
    viewModel: FuncSummaryViewModel,
    template: template
};
