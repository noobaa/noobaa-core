/* Copyright (C) 2016 NooBaa */

import template from './func-config-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { stringifyAmount } from 'utils/string-utils';
import { openEditFuncConfigModal } from 'action-creators';

class FuncConfigFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    funcName = ko.observable();
    funcVersion = '';
    funcConfig = [
        {
            label: 'Runtime',
            value: ko.observable()
        },
        {
            label: 'Handler',
            value: ko.observable()
        },
        {
            label: 'Memory Size',
            value: ko.observable()
        },
        {
            label: 'Timeout',
            value: ko.observable()
        },
        {
            label: 'Description',
            template: 'desc',
            value: ko.observable()
        }
    ];

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
                dataReady: false,
                funcName
            });

        } else {
            ko.assignToProps(this, {
                dataReady: true,
                funcName,
                funcVersion: func.version,
                funcConfig: [
                    { value: func.runtime },
                    { value: func.handler },
                    { value: `${func.memorySize}MB` },
                    { value: stringifyAmount('second', func.timeout) },
                    { value: func.description }
                ]
            });
        }
    }

    onEditConfiguration() {
        this.dispatch(openEditFuncConfigModal(
            this.funcName(),
            this.funcVersion
        ));
    }
}

export default {
    viewModel: FuncConfigFormViewModel,
    template: template
};
