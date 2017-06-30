/* Copyright (C) 2016 NooBaa */

import api from 'services/api';
import { CREATE_SYSTEM } from 'action-types';
import { completeCreateSystem, failCreateSystem } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(CREATE_SYSTEM)
        .flatMap(async action => {
            const {
                activationCode,
                ownerEmail,
                password,
                systemName,
                dnsName,
                dnsServers,
                timeConfig
            } = action.payload;

            try {
                const { token } = await api.system.create_system({
                    activation_code: activationCode,
                    name: systemName,
                    email: ownerEmail,
                    password: password,
                    dns_name: dnsName,
                    dns_servers: dnsServers,
                    time_config: timeConfig
                });

                return completeCreateSystem(systemName, ownerEmail, token);

            } catch (error) {
                return failCreateSystem(error);
            }
        });
}
