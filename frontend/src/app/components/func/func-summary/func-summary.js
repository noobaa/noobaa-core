/* Copyright (C) 2016 NooBaa */

import template from './func-summary.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { formatSize } from 'utils/size-utils';
import moment from 'moment';
import { timeShortFormat } from 'config';

class FuncSummaryViewModel extends ConnectableViewModel {
    state = {
        text: 'Deployed',
        css: 'success',
        icon: 'healthy'
    };
    name = ko.observable();
    description = ko.observable();
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
                name: funcName,
                description: '',
                lastModified: '',
                runtime: '',
                codeSize: '',
                memorySize: ''
            });

        } else {
            ko.assignToProps(this, {
                name: funcName,
                description: func.description,
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
