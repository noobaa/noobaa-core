/* Copyright (C) 2016 NooBaa */

import template from './diagnostics-form.html';
import ConnectableViewModel from 'components/connectable';
import { formatTimeLeftForDebugMode } from 'utils/diagnostic-utils';
import { support, timeTickInterval } from 'config';
import ko from 'knockout';
import {
    setSystemDebugLevel,
    collectSystemDiagnostics
} from 'action-creators';

class DiagnosticsFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    ticker = 0;
    inDebugMode = false;
    timeLeft = 0;
    toggleDebugModeButtonText = ko.observable();
    isCollectDiagButtonLocked = ko.observable();
    contactInfoProps = [
        {
            label: 'By email',
            template: 'link',
            value: {
                href: `mailto:${support.email}`,
                text: support.email,
                target: false
            }
        },
        {
            label: 'Support center',
            template: 'link',
            value: {
                href: support.helpDesk,
                text: support.helpDesk,
                target: '_blank'
            }
        }
    ];
    debugSheet = [
        {
            label: 'Debug Mode',
            template: 'stateAndWarning',
            value: {
                stateText: ko.observable(),
                isWarningVisible: ko.observable()
            }
        },
        {
            label: 'Time Left For Debugging',
            value: ko.observable(),
            disabled: ko.observable()
        }

    ];

    constructor(params, inject) {
        super(params, inject);

        this.ticker = setInterval(
            () => this.onTick(),
            timeTickInterval
        );
    }

    selectState(state) {
        const { system } = state;
        return [
            system && system.debug,
            system && system.diagnostics
        ];
    }

    mapStateToProps(debugState, diagnosticsState) {
        if (!debugState || !diagnosticsState) {
            ko.assignToProps(this, {
                dataReady: false,
                toggleDebugModeButtonText: 'Turn On System Debug Mode'
            });

        } else {
            const { level, till } = debugState;
            const inDebugMode = level > 0;
            const timeLeft = Math.max(0, till - Date.now());
            const toggleDebugModeButtonText = `Turn ${inDebugMode ? 'Off' : 'On' } System Debug Mode`;
            const isCollectDiagButtonLocked = diagnosticsState.collecting;

            ko.assignToProps(this, {
                dataReady: true,
                inDebugMode,
                timeLeft,
                toggleDebugModeButtonText,
                isCollectDiagButtonLocked,
                debugSheet: [
                    {
                        value: {
                            stateText: inDebugMode ? 'On' : 'Off',
                            isWarningVisible: inDebugMode
                        }
                    },
                    {
                        value: formatTimeLeftForDebugMode(inDebugMode, timeLeft),
                        disabled: !inDebugMode
                    }
                ]
            });
        }
    }

    onTick() {
        if (this.inDebugMode) {
            const timeLeft = Math.max(0, this.timeLeft - timeTickInterval);
            const formattedTimeLeft = formatTimeLeftForDebugMode(true, timeLeft);

            ko.assignToProps(this, {
                timeLeft,
                debugSheet: {
                    1: { value: formattedTimeLeft }
                }
            });
        }
    }

    onToggleDebugMode() {
        const level = this.inDebugMode ? 0 : 5;
        this.dispatch(setSystemDebugLevel(level));
    }

    onDownloadDiagnosticPack() {
        this.dispatch(collectSystemDiagnostics());
    }

    dispose(){
        clearInterval(this.ticker);
        super.dispose();
    }
}

export default {
    viewModel: DiagnosticsFormViewModel,
    template: template
};
