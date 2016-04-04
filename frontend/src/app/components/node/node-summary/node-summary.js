import template from './node-summary.html';
import ko from 'knockout';
import moment from 'moment';
import { raiseNodeDebugLevel, downloadDiagnosticPack } from 'actions';
import { formatSize } from 'utils';
import style from 'style';

class NodeSummaryViewModel {
    constructor({ node }) {

        this.dataReady = ko.pureComputed(
            () => !!node()
        );

        this.name = ko.pureComputed(
            () => node().name
        );

        this.ip = ko.pureComputed(
            () => node().ip
        );

        this.stateIcon = ko.pureComputed(
            () => `/fe/assets/icons.svg#node-${node().online ? 'online' : 'offline'}`
        )
        let extended_state = '';
        if (node().storage_full) {
            extended_state = '. Not enough free space. Read-Only mode';
        }
        this.state = ko.pureComputed(
            () => node().online ? 'Online' : 'Offline' + extended_state
        );

        this.heartbeat = ko.pureComputed(
            () => moment(node().heartbeat).fromNow()
        );

        this.trustIcon = ko.pureComputed(
            () => `/fe/assets/icons.svg#${node().trusted ? 'trusted' : 'untrusted'}`
        );

        this.trust = ko.pureComputed(
            () => node().trusted ? 'Trusted' : 'Untrusted'
        );

        this.debugLevel = ko.pureComputed(
            () => node().debug_level === 0 ? 'Low' : 'High'
        );

        this.debugLevelCss = ko.pureComputed(
          () => node().debug_level === 0 ? 'dl-low' : 'dl-high'
        );

        this.total = ko.pureComputed(
            () => node().storage.total
        );

        this.totalText = ko.pureComputed(
            () => formatSize(this.total())
        );

        this.used = ko.pureComputed(
            () => node().storage.used
        );

        this.usedText = ko.pureComputed(
            () => formatSize(this.used())
        );

        this.free = ko.pureComputed(
            () => node().storage.free
        );

        this.freeText = ko.pureComputed(
            () => formatSize(this.free())
        );

        this.os = ko.pureComputed(
            () => this.total() - (this.used() + this.free())
        );

        this.osText = ko.pureComputed(
            () => formatSize(this.os())
        );
        this.gaugeValues = [
            { value: this.used(), color: style['text-color6'], emphasize: true },
            { value: this.os(), color: style['text-color2'] ,emphasize: false },
            { value: this.free(), color: style['text-color5'] ,emphasize: false }
        ]

        this.rpcAddress = ko.pureComputed(
            () => !!node() && node().rpc_address
        );

        this.isTestModalVisible = ko.observable(false);
    }

    raiseDebugLevel() {
        raiseNodeDebugLevel(this.name());
    }

    downloadDiagnosticPack() {
        downloadDiagnosticPack(this.name());
    }
}

export default {
    viewModel: NodeSummaryViewModel,
    template: template
}
