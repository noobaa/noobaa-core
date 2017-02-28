import template from './edit-server-time-settings-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import moment from 'moment-timezone';
import { systemInfo, serverTime } from 'model';
import { loadServerTime, updateServerClock, updateServerNTPSettings } from 'actions';

const configTypes =  Object.freeze([
    { label: 'Manual Time', value: 'MANUAL' },
    { label: 'Network Time (NTP)', value: 'NTP' }
]);

class EditServerTimeSettingsModalViewModel extends BaseViewModel {
    constructor({ serverSecret, onClose }) {
        super();

        this.onClose = onClose;
        this.serverSecret = ko.unwrap(serverSecret);

        const server = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.shards[0].servers.find(
                server => server.secret === this.serverSecret
            )
        );

        this.hostname = ko.pureComputed(
            () => server() && server().hostname
        );

        this.configTypes = configTypes;
        this.selectedConfigType = ko.observableWithDefault(
            () => server() && server().ntp_server ? 'NTP' : 'MANUAL'
        );

        this.usingManualTime = ko.pureComputed(
            () => this.selectedConfigType() === 'MANUAL'
        );

        this.usingNTP = ko.pureComputed(
            () => this.selectedConfigType() === 'NTP'
        );

        this.timezone = ko.observableWithDefault(
            () => server() && server().timezone
        );

        this.time = ko.observableWithDefault(
            () => serverTime() && serverTime().server ===  ko.unwrap(serverSecret) ?
                serverTime().time * 1000 :
                0
        );

        this.addToDisposeList(
            setInterval(
                () => this.time() && this.time(this.time() + 1000),
                1000
            ),
            clearInterval
        );

        this.ntpServer = ko.observableWithDefault(
            () => server() && server().ntp_server
        )
            .extend({
                isIPOrDNSName: true,
                required: { message: 'Please enter an NTP server address' }
            });


        this.ntpErrors = ko.validation.group([
            this.ntpServer
        ]);

        this.isValid = ko.pureComputed(
            () => this.usingManualTime() || this.ntpErrors().length === 0
        );

        loadServerTime(this.serverSecret);
    }

    save() {
        this.usingNTP() ? this.setNTPTime() : this.setManualTime();
    }

    setManualTime() {
        let epoch = moment.tz(this.time(), this.timezone()).unix();
        updateServerClock(this.serverSecret, this.hostname(), this.timezone(), epoch);
        this.onClose();
    }

    setNTPTime() {
        if (this.ntpErrors().length > 0) {
            this.ntpErrors.showAllMessages();

        } else {
            updateServerNTPSettings(this.serverSecret, this.hostname(), this.timezone(), this.ntpServer());
            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: EditServerTimeSettingsModalViewModel,
    template: template
};
