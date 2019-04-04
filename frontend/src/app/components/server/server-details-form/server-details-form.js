/* Copyright (C) 2016 NooBaa */

import template from './server-details-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import { formatSize, toBytes, isSizeZero } from 'utils/size-utils';
import { getServerDisplayName } from 'utils/cluster-utils';
import { openEditServerDetailsModal, openChangeClusterConnectivityIpModal } from 'action-creators';

class ServerDetailsFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    isConnected = ko.observable();
    details = [
        {
            label: 'Cluster Connectivity IP',
            value: ko.observable()
        },
        {
            label: 'Additional IPs',
            value: ko.observable()
        },
        {
            label: 'Hostname',
            value: ko.observable()
        },
        {
            label: 'Server Name',
            value: ko.observable()
        },
        {
            label: 'Location Tag',
            value: ko.observable()
        },
        {
            label: 'Is Master',
            value: ko.observable()
        },
        {
            label: 'Total Memory',
            template: 'valueWithMinReq',
            value: {
                text: ko.observable(),
                minReqMessage: ko.observable()
            }
        },
        {
            label: 'Total Disk Size',
            template: 'valueWithMinReq',
            value: {
                text: ko.observable(),
                minReqMessage: ko.observable()
            }
        },
        {
            label: 'Number of CPUs',
            template: 'valueWithMinReq',
            value: {
                text: ko.observable(),
                minReqMessage: ko.observable()
            }
        },
        {
            label: 'Internal Storage Usage',
            visible: ko.observable(),
            value: ko.observable()
        }
    ];

    selectState(state, params) {
        const { topology = {}, system } = state;
        const { servers, serverMinRequirements } = topology;
        return [
            servers && servers[params.serverSecret],
            system && system.internalStorage.used,
            serverMinRequirements
        ];
    }

    mapStateToProps(server, usedInteralStorage, minRequirements) {
        if (!server && !usedInteralStorage) {
            ko.assignToProps(this, {
                dataReady: false
            });
        } else {
            const {
                addresses = [],
                hostname,
                location = 'Not set',
                isMaster,
                memory,
                storage,
                cpus
            } = server;

            const [connectivityIp = '', ...additionalIps] = addresses.map(addr => addr.ip);
            const totalMemory = {
                text: formatSize(memory.total),
                minReqMessage: memory.total < minRequirements.memory ?
                    formatSize(minRequirements.memory) :
                    ''
            };
            const totalDiskSize = {
                text: formatSize(storage.total),
                minReqMessage: toBytes(storage.total) < minRequirements.storage ?
                    formatSize(minRequirements.storage) :
                    ''
            };
            const cpuCount = {
                text: numeral(cpus.count).format(','),
                minReqMessage: cpus.count < minRequirements.cpus ?
                    numeral(minRequirements.cpus).format(',') :
                    ''
            };

            ko.assignToProps(this, {
                dataReady: true,
                isConnected: server.mode === 'CONNECTED',
                details: [
                    { value: connectivityIp },
                    { value: additionalIps.join() || 'None' },
                    { value: hostname },
                    { value: getServerDisplayName(server)},
                    { value: location },
                    { value: isMaster ? 'Yes' : 'No' },
                    { value: totalMemory },
                    { value: totalDiskSize },
                    { value: cpuCount },
                    {
                        value: formatSize(usedInteralStorage),
                        visible: !isSizeZero(usedInteralStorage)
                    }
                ]

            });
        }
    }

    onChangeClusterConnectivityIp() {
        this.dispatch(openChangeClusterConnectivityIpModal(this.secret()));
    }

    onEditServerDetails() {
        this.dispatch(openEditServerDetailsModal(this.secret()));
    }

}

export default {
    viewModel: ServerDetailsFormViewModel,
    template: template
};
