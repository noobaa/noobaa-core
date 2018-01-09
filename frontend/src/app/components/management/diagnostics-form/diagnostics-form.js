/* Copyright (C) 2016 NooBaa */

import template from './diagnostics-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo, collectDiagnosticsState } from 'model';
import { downloadSystemDiagnosticPack, setSystemDebugLevel } from 'actions';
import { formatTimeLeftForDebugMode } from 'utils/diagnostic-utils';
import { support, timeTickInterval } from 'config';

class DiagnosticsFormViewModel extends BaseViewModel {
    constructor() {
        super();

        this.contactSupport = [
            {
                label: 'By email',
                value: `<a class="link" href="mailto:${support.email}">${support.email}</a>`
            },
            {
                label: 'Support center',
                value: `<a class="link" href="${support.helpDesk}" target="_blank">${support.helpDesk}</a>`
            }
        ];

        this.debugMode = ko.pureComputed(
            () => Boolean(systemInfo() && systemInfo().debug.level)
        );

        const isTimeLeftDisabled = ko.pureComputed(
            () => !this.debugMode()
        );

        const systemDebugTimeLeft = ko.pureComputed(
            () => systemInfo() && systemInfo().debug.time_left
        );

        this.debugTimeLeft = ko.observable(systemDebugTimeLeft());
        this.addToDisposeList(
            systemDebugTimeLeft.subscribe(time => this.debugTimeLeft(time))
        );

        this.addToDisposeList(
            setInterval(
                () => {
                    if (this.debugMode()) {
                        this.debugTimeLeft(this.debugTimeLeft() - timeTickInterval);
                    }
                },
                timeTickInterval
            ),
            clearInterval
        );

        this.debugModeSheet = [
            {
                label: 'Debug Mode',
                value: ko.pureComputed(
                    () => this.debugMode() ?
                        'On <span class="warning">(May cause system slowdown)</span>' :
                        'Off'
                )
            },
            {
                label: 'Time Left For Debugging',
                value: ko.pureComputed(
                    () => formatTimeLeftForDebugMode(this.debugMode(), this.debugTimeLeft())
                ),
                disabled: isTimeLeftDisabled
            }
        ];

        this.toogleDebugModeButtonText = ko.pureComputed(
            () => `Turn ${this.debugMode() ? 'Off' : 'On' } System Debug Mode`
        );

        this.isCollectingDiagnostics = ko.pureComputed(
            () => Boolean(collectDiagnosticsState()['system'])
        );
    }

    toogleDebugMode() {
        setSystemDebugLevel(this.debugMode() ? 0 : 5);
    }

    downloadDiagnosticPack() {
        downloadSystemDiagnosticPack();
    }
}

export default {
    viewModel: DiagnosticsFormViewModel,
    template: template
};
