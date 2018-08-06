/* Copyright (C) 2016 NooBaa */

import template from './p2p-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { updateP2PTcpPorts } from 'actions';

const portOptions = [
    { label: 'Single Port', value: 'single' },
    { label: 'Port Range', value: 'range' }
];

class P2PFormViewModel extends BaseViewModel {
    constructor({ isCollapsed }) {
        super();

        this.isCollapsed = isCollapsed;
        this.portOptions = portOptions;

        const ports = ko.pureComputed(
            () => systemInfo() && systemInfo().n2n_config.tcp_permanent_passive
        );

        this.portType = ko.observableWithDefault(
            () => ports() && (ports().port ? 'single' : 'range')
        );

        this.rangeMin = ko.observableWithDefault(
            () => ports() && (ports().min || ports().port)
        )
            .extend({
                required: {
                    message: 'Please enter a valid port number'
                },
                min: 1
            });

        const validateRangeMax = ko.pureComputed(
            () => this.portType() === 'range' && this.rangeMin.isValid()
        );

        this.rangeMax = ko.observableWithDefault(
            () => ports() && (ports().max || ports().port)
        )
            .extend({
                required: {
                    onlyIf: () => validateRangeMax(),
                    message: 'Please enter a valid port number'
                },
                min: {
                    onlyIf: () => validateRangeMax(),
                    params: ko.pureComputed(
                        () => Number(this.rangeMin()) + 1
                    )
                },
                max: {
                    onlyIf: () => validateRangeMax(),
                    params: 65535
                }
            });

        this.summaryLabel = ko.pureComputed(
            () => this.portType() === 'single' ? 'Port Number:' : 'Port Range:'
        );

        this.summaryValue = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return '';
                } else if (this.portType() === 'single') {
                    return this.rangeMin();
                } else {
                    return `${this.rangeMin()}-${this.rangeMax()}`;
                }
            }
        );

        this.errors = ko.validation.group([
            this.rangeMin,
            this.rangeMax
        ]);

        this.errorMessage = ko.pureComputed(
            () => this.errors()[0]
        );
    }

    update() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            const min = Number(this.rangeMin());
            const max = Number(this.portType() === 'single' ? this.rangeMin() : this.rangeMax());

            updateP2PTcpPorts(min, max);
        }
    }
}

export default {
    viewModel: P2PFormViewModel,
    template: template
};
