/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
// const yaml = require('yaml');
const P = require('../util/promise');
const promise_utils = require('../util/promise_utils');
const agent_functions = require('../test/utils/agent_functions');

class KubernetesFunctions {

    constructor(image_tag) {
        //TODO: use this when we are creating server if needed
        //      edit the noobaa core yaml with the proper image.
        this.image_tag = image_tag;
    }

    async authenticate() {
        console.log('authenticating with kubernetes');
        const current_context = await promise_utils.exec(`kubectl config current-context`, { return_stdout: true });
        console.log(current_context);
        //TODO: authenticate.
    }

    async readYaml(file) {
        //     const file_content = fs.readFileSync(file).toString();
        //     const file_json = await yaml.parse(doc_str);
    }

    async editYaml(file) {
        //     await fs.writeFileSync(file_json, doc_str);
    }

    async run_with_namespace(namespace) {
        let run_with_namespace;
        if ((namespace)) {
            run_with_namespace = `--namespace ${namespace}`;
        } else {
            run_with_namespace = '';
        }
        return run_with_namespace;
    }

    async check_if_namespace_exists(namespace) {
        const namespace_json = JSON.parse(await promise_utils.exec(`kubectl get namespace -o json`, { return_stdout: true }));
        const namespaces = namespace_json.items.map(item => item.metadata.name);
        if ((namespaces.includes(namespace))) {
            return true;
        }
        return false;
    }

    async create_namespace_if_not_exist(params) {
        const { namespace } = params;
        if ((await this.check_if_namespace_exists(namespace))) {
            console.log(`namespace ${namespace} already exists`);
        } else {
            console.log(`Creating kubernetes namespace ${namespace}`);
            await promise_utils.exec(`kubectl create namespace ${namespace}`);
            //TODO: verify that the namespace was created.
        }
    }

    async create_server(params) {
        const {
            yaml_path,
            namespace
        } = params;
        await this.create_namespace_if_not_exist({ namespace });
        const run_with_namespace = await this.run_with_namespace(namespace);
        console.log(`Creating server in kubernetes`);
        //TODO: get your desired image 
        //TODO: create the server with system
        await promise_utils.exec(`kubectl apply -f ${yaml_path} ${run_with_namespace}`);
        const kubectl_get_all = await promise_utils.exec(`kubectl get all ${run_with_namespace}`, { return_stdout: true });
        console.log(kubectl_get_all);
        await this.check_pod_is_running({ namespace, pod_name: "noobaa-server-0" });
    }

    async create_server_pod() {
        // TODO: create only the server pod
        // Do we need this? 
        // if we do it is for upgrade
    }

    async server_pod() {
        // TODO: create only the server pod
        // Do we need this? 
        // if we do it is for upgrade
    }

    async check_pod_is_running(params) {
        const {
            namespace,
            pod_name = "",
        } = params;
        const run_with_namespace = await this.run_with_namespace(namespace);
        if (!pod_name) throw new Error(`pod_name is a mandatory param`);
        let pod = JSON.parse(await promise_utils.exec(`kubectl get pod ${pod_name} ${
            run_with_namespace} -o json`, { return_stdout: true }));
        const TIMEOUT = 5 * 60000; // Wait up to 5 minutes for pod to be in Running status
        const start = Date.now();
        while (pod.status.phase !== "Running") {
            pod = JSON.parse(await promise_utils.exec(`kubectl get pod ${pod_name} ${
                run_with_namespace} -o json`, { return_stdout: true }));
            if (pod.status.phase === "Running") {
                console.log(`Current pod ${pod_name} status is ${pod.status.phase}`);
            } else {
                const wait_time = 10;
                console.log(`Current pod ${pod_name} status is ${pod.status.phase}, waiting ${wait_time} sec`);
                await P.delay(wait_time * 1000);
            }
            if (Date.now() - start > TIMEOUT) {
                throw new Error(`Pod ${pod_name} did not reach Running status after ${TIMEOUT} minutes`);
            }
        }
    }

    async get_services_json(params) {
        const {
            namespace,
            service = "",
        } = params;
        const run_with_namespace = await this.run_with_namespace(namespace);
        const services = JSON.parse(await promise_utils.exec(`kubectl get service ${service} ${
            run_with_namespace} -o json`, { return_stdout: true }));
        return services;
    }

    async get_service_ip(params) {
        const {
            namespace,
            service = "",
            external
        } = params;
        const services = await this.get_services_json({ namespace, service });
        if (services.items) { // Handling more then one service
            for (const desired_service of services.items.map(item => item.metadata.name)) {
                //TODO: as we are not returning anything for now we will 
                //      handle only internal ip (we should add this if needed)
                if (external) {
                    console.log(`currently we are not supporting getting external-IP of multiple services`);
                    return;
                }
                const single_service = await this.get_services_json({ namespace, service: desired_service });
                const clusterIP = single_service.spec.clusterIP;
                console.log(`service ${single_service} cluster-IP is ${clusterIP}`);
                //TODO: currently we are jest printing, if we will need we can return the values.
            }
        } else {
            let ip;
            if (external) {
                let externalIP = services.spec.externalIP;
                if ((!services.spec.clusterIP)) {
                    externalIP = services.status.loadBalancer.ingress.map(ingres => ingres.ip);
                }
                console.log(`service ${service} external-IP is ${externalIP}`);
                ip = externalIP;
            } else {
                const clusterIP = services.spec.clusterIP;
                console.log(`service ${service} cluster-IP is ${clusterIP}`);
                ip = clusterIP;
            }
            return ip;
        }
    }

    async get_agent_yaml_from_server(params) {
        const {
            namespace,
            yaml_path = "./agent.yaml"
        } = params;
        //TODO: do it with internal ip, the reason we are not currently do it with internal ip is that 
        //
        //When we do new_rpc the port is 8080 but the internal port is mapped differently:
        //NAME          TYPE           CLUSTER-IP     EXTERNAL-IP      PORT(S)                                                                                                AGE
        //noobaa-mgmt   LoadBalancer   10.0.104.153   -                8080:32450/TCP,8443:32737/TCP,8444:30825/TCP,8445:30829/TCP,8446:31364/TCP,80:32376/TCP,443:30292/TCP  2h
        //
        // Even if we change the port in the new_rpc it tries to do:
        // ROUTER { default: 'wss://10.0.104.153:32737', md: 'wss://10.0.104.153:32738', bg: 'wss://10.0.104.153:32739', hosted_agents: 'wss://10.0.104.153:32740', master: 'wss://10.0.104.153:32737' }
        // which are ported differently.
        const server_ip = await this.get_service_ip({ namespace, service: 'noobaa-mgmt', external: true });
        console.log(`Connecting to the server to get the agent yaml`);
        const agent_yaml = await agent_functions.getAgentConfInstallString(server_ip, 'Kubernetes');
        console.log(`Writing the agent yaml into ${yaml_path}`);
        await fs.writeFileSync(yaml_path, agent_yaml);
        console.log(`Agent yaml was written into ${yaml_path}`);
    }

    async create_agent(params) {
        const {
            namespace,
            num_agents,
            yaml_path = "./agent.yaml"
        } = params;
        const run_with_namespace = await this.run_with_namespace(namespace);
        console.log(`Creating agent in kubernetes`);
        await this.get_agent_yaml_from_server({ namespace, yaml_path });
        //TODO: edit the yaml if needed 
        //TODO: Fix the yaml for the correct image if needed.
        //await this.edit_number_of_agents(...);
        console.log(`Applying the agent yaml ${yaml_path}`);
        await promise_utils.exec(`kubectl apply -f ${yaml_path} ${run_with_namespace}`);
    }

    async edit_image_in_yaml(params) {
        const {
            yaml,
            num_agents
        } = params;
        const file_content = fs.readFileSync(yaml);
        console.log(file_content);
    }

    async edit_number_of_agents(params) {
        const {
            agent_yaml,
            num_agents
        } = params;
        await this.editYaml(agent_yaml);
    }

    async delete_pvc(params) {
        const {
            namespace
        } = params;
        if ((!namespace)) {
            throw new Error('In order to protect other namespaces, namespace param is mandatory');
        }
        const run_with_namespace = await this.run_with_namespace(namespace);
        console.log(await promise_utils.exec(`kubectl delete pvc --all ${run_with_namespace}`, { return_stdout: true }));
    }

    async delete_namespace(params) {
        const {
            namespace
        } = params;
        if ((!namespace)) {
            throw new Error('In order to protect other namespaces, namespace param is mandatory');
        }
        if ((await this.check_if_namespace_exists(namespace))) {
            console.log(`Deleting the namespace ${namespace} pvc`);
            await this.delete_pvc({ namespace });
            console.log(`Deleting the namespace: ${namespace}`);
            await promise_utils.exec(`kubectl delete namespace ${namespace}`);
        } else {
            console.log(`Skipping delete namespace ${namespace}, namespace does not exists`);
        }
        //TODO: check and print when it delete
    }

    async upgrade_server() {
        //TODO::
        // delete server Container
        // create new server container
    }

}

module.exports = KubernetesFunctions;
